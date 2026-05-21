import queue
import signal
import threading
from datetime import datetime
from time import monotonic, sleep
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo

import cv2

from agent_link import AgentLink
from config import FRAME_FPS, FRAME_QUALITY, AgentConfig, load_config
from vision import (
    InspectionPayload,
    PartSpec,
    annotate_status,
    calibrate_background,
    compute_foreground_mask,
    get_camera,
    inspect_frame,
)

STATUS_INTERVAL = 5.0
CALIBRATION_FRAMES = 30
FOREGROUND_AREA_THRESHOLD = 4000
STABILITY_FRAMES = 5
CLEAR_FRAMES = 10

Phase = str  # 'idle' | 'calibrating' | 'ready' | 'stabilizing' | 'locked'


def now_iso() -> str:
    return datetime.now(ZoneInfo("Asia/Jakarta")).isoformat()


def build_inspection_event(config: AgentConfig, payload: InspectionPayload, trigger: str) -> dict[str, Any]:
    return {
        "eventId": str(uuid4()),
        "eventType": "inspection.created",
        "stationId": config.station_id,
        "timestamp": now_iso(),
        "operatorId": "agent",
        "operatorName": "Vision Agent",
        "shift": "A",
        "trigger": trigger,
        **payload.to_dict(),
    }


def build_station_status(
    config: AgentConfig,
    *,
    running: bool,
    phase: Phase = "idle",
    fps: float = 0.0,
    active_part_code: str | None = None,
) -> dict[str, Any]:
    event: dict[str, Any] = {
        "eventId": str(uuid4()),
        "eventType": "station.status",
        "stationId": config.station_id,
        "timestamp": now_iso(),
        "state": "online",
        "fps": round(fps, 2),
        "running": running,
        "phase": phase,
    }
    if active_part_code:
        event["activePartCode"] = active_part_code
    return event


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
        self._frame_interval = 1.0 / FRAME_FPS
        self.link = AgentLink(config, self._enqueue_command)

    def start(self) -> None:
        self.link.start()
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
            self._running.set()
        elif kind == "stop":
            self._running.clear()
        elif kind in ("capture", "recalibrate"):
            if kind == "capture":
                view = str(command.get("inspectionView", self._inspection_view))
                self._inspection_view = view if view in {"top", "side"} else self._inspection_view
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
        last_status = 0.0
        while not self._stop.is_set():
            now = monotonic()
            if now - last_status >= STATUS_INTERVAL:
                self.link.send_event(build_station_status(self.config, running=False, phase="idle"))
                last_status = now
            if self._running.is_set():
                self._run_inspection_session()
                last_status = 0.0
            else:
                sleep(0.5)

    def _send_status(self, *, phase: Phase, running: bool, fps: float = 0.0) -> None:
        active = self._part.part_code if self._part else None
        self.link.send_event(build_station_status(
            self.config, running=running, phase=phase, fps=fps, active_part_code=active,
        ))

    def _send_frame(self, frame: cv2.Mat, encode_params: list[int]) -> None:
        ok, buffer = cv2.imencode(".jpg", frame, encode_params)
        if ok:
            self.link.send_frame(buffer.tobytes())

    def _capture_calibration(self, cap: cv2.VideoCapture, encode_params: list[int]) -> list[cv2.Mat]:
        frames: list[cv2.Mat] = []
        last_send = 0.0
        while len(frames) < CALIBRATION_FRAMES and not self._stop.is_set() and self._running.is_set():
            ret, frame = cap.read()
            if not ret:
                sleep(self._frame_interval)
                continue
            frames.append(frame)
            now = monotonic()
            if now - last_send >= self._frame_interval:
                annotated = annotate_status(frame, "calibrating", self._part)
                self._send_frame(annotated, encode_params)
                last_send = now
        return frames

    def _run_inspection_session(self) -> None:
        if self._part is None:
            self._running.clear()
            self._send_status(phase="idle", running=False)
            return

        try:
            cap = get_camera(self.config.camera_index)
        except RuntimeError:
            self._running.clear()
            self._send_status(phase="idle", running=False)
            return

        encode_params = [cv2.IMWRITE_JPEG_QUALITY, FRAME_QUALITY]
        phase: Phase = "calibrating"
        background = None
        stable_count = 0
        clear_count = 0
        last_status = 0.0
        last_frame_sent = 0.0
        last_frame_ts = monotonic()
        fps = 0.0

        try:
            while not self._stop.is_set() and self._running.is_set():
                if phase == "calibrating":
                    self._send_status(phase="calibrating", running=True)
                    frames = self._capture_calibration(cap, encode_params)
                    if len(frames) < CALIBRATION_FRAMES // 2:
                        sleep(0.5)
                        continue
                    background = calibrate_background(frames)
                    phase = "ready"
                    stable_count = 0
                    clear_count = 0
                    self._send_status(phase=phase, running=True)
                    self._drain_command("recalibrate")
                    continue

                ret, frame = cap.read()
                if not ret:
                    break

                now = monotonic()
                elapsed = now - last_frame_ts
                last_frame_ts = now
                if elapsed > 0:
                    instantaneous = 1.0 / elapsed
                    fps = instantaneous if fps == 0.0 else (fps * 0.9) + (instantaneous * 0.1)

                if self._drain_command("recalibrate"):
                    phase = "calibrating"
                    continue

                mask = compute_foreground_mask(frame, background)
                result = inspect_frame(frame, mask, self._part, self._inspection_view)

                manual_capture = self._drain_command("capture")

                if manual_capture and result.inspection is not None:
                    event = build_inspection_event(self.config, result.inspection, "manual")
                    event["operatorId"] = self._operator_id
                    event["operatorName"] = self._operator_name
                    event["shift"] = self._shift
                    if self._batch_no:
                        event["batchNo"] = self._batch_no
                    self.link.send_event(event)
                    phase = "locked"
                    clear_count = 0
                    stable_count = 0
                    self._send_status(phase=phase, running=True, fps=fps)

                elif phase == "ready":
                    if result.inspection is not None and result.foreground_area >= FOREGROUND_AREA_THRESHOLD:
                        stable_count += 1
                        if stable_count >= STABILITY_FRAMES:
                            phase = "locked"
                            clear_count = 0
                            stable_count = 0
                            self._send_status(phase=phase, running=True, fps=fps)
                    else:
                        stable_count = 0

                elif phase == "locked":
                    if result.foreground_area < FOREGROUND_AREA_THRESHOLD:
                        clear_count += 1
                        if clear_count >= CLEAR_FRAMES:
                            phase = "ready"
                            clear_count = 0
                            self._send_status(phase=phase, running=True, fps=fps)
                    else:
                        clear_count = 0

                display = result.frame if result.inspection is not None else annotate_status(frame, phase, self._part)

                if now - last_frame_sent >= self._frame_interval:
                    self._send_frame(display, encode_params)
                    last_frame_sent = now

                if now - last_status >= STATUS_INTERVAL:
                    self._send_status(phase=phase, running=True, fps=fps)
                    last_status = now

        finally:
            cap.release()
            self._send_status(phase="idle", running=False)


def main() -> None:
    config = load_config()
    runner = InspectionRunner(config)
    signal.signal(signal.SIGINT, runner.shutdown)
    try:
        runner.start()
    finally:
        runner.shutdown()
        runner.link.stop()


if __name__ == "__main__":
    main()
