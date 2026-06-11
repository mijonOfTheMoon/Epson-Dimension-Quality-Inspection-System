import logging
import queue
import signal
import threading
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from time import monotonic, sleep
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo

import cv2

from config import FRAME_FPS, FRAME_QUALITY, CAMERA_WIDTH, CAMERA_HEIGHT, CAMERA_FPS, AgentConfig, load_config
from http_client import BackendHttpClient
from mqtt_link import MqttLink
from webrtc_publisher import WebRTCPublisher
from ws_video import WsVideoPublisher
from vision import (
    InspectionPayload,
    PartSpec,
    compute_object_mask,
    get_camera,
    inspect_frame,
    calibrate_aruco_ratio,
    annotate_calibration,
    payload_from_detections,
    render_overlay,
    reset_tracker,
    save_persisted_ratio,
)

STATUS_INTERVAL = 5.0
CLAIM_WINDOW_SECONDS = 2.5
CALIBRATION_FRAMES = 30
RESOURCE_RELEASE_TIMEOUT_SECONDS = 5.0

logger = logging.getLogger(__name__)

Phase = str


class CameraStream:
    def __init__(self, index: int, fps: int, width: int, height: int) -> None:
        self._cap = get_camera(index, fps, width, height)
        self._latest: cv2.Mat | None = None
        self._seq = 0
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="camera-capture", daemon=True)
        self._thread.start()

    def _run(self) -> None:
        while not self._stop.is_set():
            ok, frame = self._cap.read()
            if not ok:
                sleep(0.005)
                continue
            with self._lock:
                self._latest = frame
                self._seq += 1

    def read(self) -> tuple[int, cv2.Mat | None]:
        with self._lock:
            return self._seq, self._latest

    def release(self) -> None:
        self._stop.set()
        self._thread.join(timeout=2.0)
        try:
            self._cap.release()
        except Exception:
            pass


def configure_logging(level_name: str) -> None:
    normalized = level_name.upper()
    level = logging.getLevelName(normalized)
    if not isinstance(level, int):
        normalized = "INFO"
        level = logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )
    for logger_name in ("main", "http_client", "mqtt_link", "webrtc_publisher"):
        logging.getLogger(logger_name).setLevel(level)
    for noisy_logger in ("aioice", "aiortc"):
        logging.getLogger(noisy_logger).setLevel(logging.WARNING)
    if normalized != level_name.upper():
        logging.getLogger(__name__).warning("Invalid AGENT_LOG_LEVEL=%s; using INFO", level_name)


def now_iso() -> str:
    return datetime.now(ZoneInfo("Asia/Jakarta")).isoformat()


def build_inspection_event(config: AgentConfig, payload: InspectionPayload) -> dict[str, Any]:
    return {
        "eventId": str(uuid4()),
        "eventType": "inspection.created",
        "stationId": config.station_id,
        "timestamp": now_iso(),
        "operatorId": "agent",
        "operatorName": "Vision Agent",
        "shift": "A",
        **payload.to_dict(),
    }


class InspectionRunner:
    def __init__(self, config: AgentConfig) -> None:
        self.config = config
        self._stop = threading.Event()
        self._running = threading.Event()
        self._commands: queue.Queue[dict[str, Any]] = queue.Queue()
        self._part: PartSpec | None = None
        self._operator_id = "agent"
        self._operator_name = "Vision Agent"
        self._shift = "A"
        self._batch_no: str | None = None
        self._inspection_view = "top"
        self._video_command: dict[str, Any] | None = None
        self._video_session_id: str | None = None
        self._video_track_name: str | None = None
        self._live_detections: list[dict[str, Any]] = []
        self._live_overlay: list[dict[str, Any]] = []
        self._offline_sent = threading.Event()
        self._delete_requested = False
        self._frame_interval = 1.0 / FRAME_FPS
        self._presence_interval = 0.1
        self._calibrating = threading.Event()
        self._video_meta_enabled = config.video_transport == "ws"
        self.http = BackendHttpClient(config)
        self.mqtt = MqttLink(config, self._enqueue_command)
        self.video = (
            WsVideoPublisher(config, FRAME_FPS)
            if config.video_transport == "ws"
            else WebRTCPublisher(config, FRAME_FPS)
        )
        self._upload_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="upload")

    def start(self) -> None:
        self.mqtt.start()
        self.mqtt.publish_claim()
        sleep(CLAIM_WINDOW_SECONDS)
        if self.mqtt.should_yield():
            logger.error(
                "Station '%s' sudah aktif di agent lain; agent ini berhenti.",
                self.config.station_id,
            )
            self.mqtt.stop(mode="silent")
            return
        self._main_loop()

    def shutdown(self, *_: Any) -> None:
        self._stop.set()
        self._running.clear()

    def _enqueue_command(self, command: dict[str, Any]) -> None:
        kind = command.get("type")
        if kind == "start":
            part_raw = command.get("part")
            if isinstance(part_raw, dict):
                self._part = PartSpec.from_dict(part_raw)
            operator = command.get("operator")
            if isinstance(operator, dict):
                self._operator_id = str(operator.get("id", "agent"))
                self._operator_name = str(operator.get("name", "Vision Agent"))
            self._shift = str(command.get("shift", "A"))
            batch_no = command.get("batchNo")
            self._batch_no = str(batch_no) if batch_no else None
            view = str(command.get("inspectionView", "top"))
            self._inspection_view = view if view in {"top", "side"} else "top"
            video = command.get("video")
            self._video_command = video if isinstance(video, dict) else None
            self._running.set()
        elif kind == "stop":
            self._running.clear()
        elif kind == "shutdown":
            self._delete_requested = True
            self.shutdown()
        elif kind == "recalibrate":
            try:
                self._commands.put_nowait(command)
            except queue.Full:
                pass

    def _drain_command(self, kind: str) -> bool:
        drained = False
        leftover: list[dict[str, Any]] = []
        while True:
            try:
                cmd = self._commands.get_nowait()
            except queue.Empty:
                break
            if cmd.get("type") == kind:
                drained = True
            else:
                leftover.append(cmd)
        for cmd in leftover:
            try:
                self._commands.put_nowait(cmd)
            except queue.Full:
                pass
        return drained

    def _main_loop(self) -> None:
        self._send_status(phase="idle", running=False)
        last_idle_status = monotonic()
        while not self._stop.is_set():
            if self._running.is_set():
                self._run_inspection_session()
                last_idle_status = monotonic()
            else:
                now = monotonic()
                if now - last_idle_status >= STATUS_INTERVAL:
                    self._send_status(phase="idle", running=False)
                    last_idle_status = now
                sleep(0.5)

    def _send_status(
        self,
        *,
        phase: Phase,
        running: bool,
        fps: float = 0.0,
    ) -> None:
        active = self._part.part_code if self._part else None
        detections = None if self._video_meta_enabled else (self._live_detections if running else [])
        self.mqtt.publish_presence(
            online=True,
            running=running,
            phase=phase,
            fps=fps,
            active_part_code=active,
            video_session_id=self._video_session_id,
            video_track_name=self._video_track_name,
            detections=detections,
        )

    def _send_offline_status(self) -> None:
        if self._offline_sent.is_set():
            return
        self._offline_sent.set()
        self.mqtt.publish_offline()

    def _send_frame(self, frame: cv2.Mat) -> None:
        self.video.submit_frame(frame)

    def _encode_jpeg(self, frame: cv2.Mat, encode_params: list[int]) -> bytes | None:
        ok, buffer = cv2.imencode(".jpg", frame, encode_params)
        return buffer.tobytes() if ok else None

    def _upload_inspection(self, event: dict[str, Any], frame: cv2.Mat, encode_params: list[int]) -> None:
        snapshot = self._encode_jpeg(frame, encode_params)
        if snapshot is None:
            logger.error("Clean frame unavailable for capture; sending inspection without snapshot")
        try:
            self.http.send_inspection(event, snapshot)
        except Exception as exc:
            logger.error("Inspection upload failed: %s", exc)

    def _on_video_ready(self, session_id: str, track_name: str) -> None:
        self._video_session_id = session_id
        self._video_track_name = track_name
        phase = "ready" if self._running.is_set() else "idle"
        active = self._part.part_code if self._part else None
        self.mqtt.publish_presence(
            online=True,
            running=self._running.is_set(),
            phase=phase,
            active_part_code=active,
            video_session_id=session_id,
            video_track_name=track_name,
        )

    def _capture_calibration(self, cam: "CameraStream") -> list[cv2.Mat]:
        frames: list[cv2.Mat] = []
        aruco_seen = False
        last_send = 0.0
        last_presence = 0.0
        last_seq = -1
        while len(frames) < CALIBRATION_FRAMES and not self._stop.is_set() and self._running.is_set():
            seq, frame = cam.read()
            if frame is None or seq == last_seq:
                sleep(0.005)
                continue
            last_seq = seq
            frames.append(frame)
            if calibrate_aruco_ratio(frame):
                aruco_seen = True
            now = monotonic()
            if now - last_send >= self._frame_interval:
                annotated = annotate_calibration(frame, self._part, len(frames), CALIBRATION_FRAMES, aruco_seen)
                self._send_frame(annotated)
                last_send = now
            if now - last_presence >= 2.0:
                self._send_status(phase="calibrating", running=True)
                last_presence = now
        if aruco_seen:
            save_persisted_ratio()
        return frames

    def _stream_loop(self, cam: "CameraStream", stop: threading.Event) -> None:
        interval = 1.0 / max(FRAME_FPS, 1)
        last_sent = 0.0
        last_seq = -1
        while not stop.is_set() and not self._stop.is_set():
            if self._calibrating.is_set():
                sleep(0.01)
                continue
            now = monotonic()
            if now - last_sent < interval:
                sleep(0.001)
                continue
            seq, frame = cam.read()
            if frame is None or seq == last_seq:
                sleep(0.001)
                continue
            last_seq = seq
            annotated = render_overlay(frame, self._live_overlay)
            if self._video_meta_enabled:
                meta = json.dumps({"detections": self._live_detections}, separators=(",", ":"))
                self.video.submit_frame(annotated, meta)
            else:
                self.video.submit_frame(annotated)
            last_sent = now

    def _run_inspection_session(self) -> None:
        if self._part is None:
            self._running.clear()
            self._send_status(phase="idle", running=False)
            return

        try:
            cam = CameraStream(self.config.camera_index, CAMERA_FPS, CAMERA_WIDTH, CAMERA_HEIGHT)
        except RuntimeError:
            self._running.clear()
            self._send_status(phase="idle", running=False)
            return

        encode_params = [cv2.IMWRITE_JPEG_QUALITY, FRAME_QUALITY]
        video_track_name = None
        if self._video_command and self._video_command.get("enabled", False):
            video_track_name = str(self._video_command.get("trackName", "") or "")
        self._video_session_id = None
        self._video_track_name = None
        self.video.start(video_track_name, self._on_video_ready)
        phase: Phase = "calibrating"
        last_status = 0.0
        last_presence = 0.0
        last_seq = -1
        last_frame_ts = monotonic()
        fps = 0.0
        self._live_detections = []
        self._live_overlay = []
        stream_stop = threading.Event()
        stream_thread: threading.Thread | None = None

        try:
            while not self._stop.is_set() and self._running.is_set():
                if phase == "calibrating":
                    self._calibrating.set()
                    self._live_detections = []
                    self._send_status(phase="calibrating", running=True)
                    frames = self._capture_calibration(cam)
                    if len(frames) < CALIBRATION_FRAMES // 2:
                        sleep(0.5)
                        continue
                    reset_tracker()
                    phase = "ready"
                    self._calibrating.clear()
                    self._send_status(phase=phase, running=True)
                    self._drain_command("recalibrate")
                    if stream_thread is None:
                        stream_thread = threading.Thread(
                            target=self._stream_loop,
                            args=(cam, stream_stop),
                            name="video-stream",
                            daemon=True,
                        )
                        stream_thread.start()
                    continue

                seq, frame = cam.read()
                if frame is None or seq == last_seq:
                    sleep(0.002)
                    continue
                last_seq = seq

                now = monotonic()
                elapsed = now - last_frame_ts
                last_frame_ts = now
                if elapsed > 0:
                    instantaneous = 1.0 / elapsed
                    fps = instantaneous if fps == 0.0 else (fps * 0.9) + (instantaneous * 0.1)

                if self._drain_command("recalibrate"):
                    phase = "calibrating"
                    continue

                mask = compute_object_mask(frame)
                result = inspect_frame(frame, mask, self._part, self._inspection_view)
                self._live_detections = (
                    [detection.to_dict() for detection in result.inspection.detections]
                    if result.inspection is not None
                    else []
                )
                self._live_overlay = result.overlay

                if result.triggered:
                    payload = payload_from_detections(self._part, result.triggered)
                    event = build_inspection_event(self.config, payload)
                    event["operatorId"] = self._operator_id
                    event["operatorName"] = self._operator_name
                    event["shift"] = self._shift
                    if self._batch_no:
                        event["batchNo"] = self._batch_no
                    self._upload_executor.submit(self._upload_inspection, event, frame.copy(), encode_params)

                if now - last_presence >= self._presence_interval:
                    last_presence = now
                    self.mqtt.publish_presence(
                        online=True,
                        running=True,
                        phase=phase,
                        fps=fps,
                        active_part_code=(self._part.part_code if self._part else None),
                        video_session_id=self._video_session_id,
                        video_track_name=self._video_track_name,
                        detections=None if self._video_meta_enabled else self._live_detections,
                    )

                if now - last_status >= STATUS_INTERVAL:
                    self._send_status(phase=phase, running=True, fps=fps)
                    last_status = now

        finally:
            self._calibrating.clear()
            stream_stop.set()
            if stream_thread is not None:
                stream_thread.join(timeout=2.0)
            camera_reserve = min(1.0, RESOURCE_RELEASE_TIMEOUT_SECONDS)
            video_timeout = max(0.0, RESOURCE_RELEASE_TIMEOUT_SECONDS - camera_reserve)
            release_deadline = monotonic() + RESOURCE_RELEASE_TIMEOUT_SECONDS
            self._release_with_timeout("video pipeline", self.video.stop, video_timeout)
            self._video_session_id = None
            self._video_track_name = None
            camera_timeout = max(camera_reserve, release_deadline - monotonic())
            self._release_with_timeout("camera", cam.release, camera_timeout)
            if self._stop.is_set():
                self._send_offline_status()
            else:
                self._send_status(phase="idle", running=False)

    def _release_with_timeout(self, name: str, release: Any, timeout: float) -> None:
        error: list[BaseException] = []

        def _run() -> None:
            try:
                release()
            except BaseException as exc:
                error.append(exc)

        worker = threading.Thread(target=_run, name=f"release-{name}", daemon=True)
        worker.start()
        worker.join(timeout)
        if worker.is_alive():
            logger.error("Releasing %s exceeded %.1fs timeout; continuing shutdown", name, timeout)
        elif error:
            logger.error("Releasing %s failed: %s", name, error[0])

    def close(self) -> None:
        self.shutdown()
        self._upload_executor.shutdown(wait=False)
        self.video.stop()
        self.mqtt.stop(mode="clear" if self._delete_requested else "offline")
        self.http.close()

def main() -> None:
    config = load_config()
    configure_logging(config.agent_log_level)
    runner = InspectionRunner(config)
    signal.signal(signal.SIGINT, runner.shutdown)
    try:
        runner.start()
    finally:
        runner.close()

if __name__ == "__main__":
    main()