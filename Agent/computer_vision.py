import signal
import threading
from datetime import datetime
from time import monotonic, sleep
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo

import cv2

from agent_link import AgentLink
from config import AgentConfig, load_config
from vision import get_camera, process_inspection

STATUS_INTERVAL = 5.0
INSPECTION_INTERVAL = 1.0


def now_iso() -> str:
    return datetime.now(ZoneInfo("Asia/Jakarta")).isoformat()


def build_inspection_event(config: AgentConfig, inspection: dict) -> dict:
    return {
        "eventId": str(uuid4()),
        "eventType": "inspection.created",
        "stationId": config.station_id,
        "cameraId": config.camera_id,
        "timestamp": now_iso(),
        "batchNo": datetime.now().strftime("B%Y%m%d"),
        "vendor": "Internal",
        "operatorId": "agent",
        "operatorName": "Vision Agent",
        "shift": "A",
        "line": config.station_id,
        "modelVersion": config.model_version,
        **inspection,
    }


def build_station_status(config: AgentConfig, *, running: bool, fps: float = 0.0) -> dict:
    return {
        "eventId": str(uuid4()),
        "eventType": "station.status",
        "stationId": config.station_id,
        "cameraId": config.camera_id,
        "timestamp": now_iso(),
        "state": "online",
        "fps": round(fps, 2),
        "running": running,
        "modelVersion": config.model_version,
    }


class InspectionRunner:
    def __init__(self, config: AgentConfig) -> None:
        self.config = config
        self._stop = threading.Event()
        self._running = threading.Event()
        self._frame_interval = 1.0 / max(1, config.frame_fps)
        self.link = AgentLink(config, self._handle_command)

    def start(self) -> None:
        self.link.start()
        self._main_loop()

    def shutdown(self, *_: Any) -> None:
        self._stop.set()
        self._running.clear()

    def _handle_command(self, command: dict[str, Any]) -> None:
        kind = command.get("type")
        if kind == "start":
            self._running.set()
        elif kind == "stop":
            self._running.clear()

    def _main_loop(self) -> None:
        last_status = 0.0
        while not self._stop.is_set():
            now = monotonic()
            if now - last_status >= STATUS_INTERVAL:
                self.link.send_event(build_station_status(self.config, running=self._running.is_set()))
                last_status = now
            if self._running.is_set():
                self._run_inspection_session()
                last_status = 0.0
            else:
                sleep(0.5)

    def _run_inspection_session(self) -> None:
        try:
            cap = get_camera(self.config.camera_index)
        except RuntimeError:
            self._running.clear()
            self.link.send_event(build_station_status(self.config, running=False))
            return

        last_publish = 0.0
        last_status = 0.0
        last_frame_sent = 0.0
        last_frame_ts = monotonic()
        fps = 0.0
        encode_params = [cv2.IMWRITE_JPEG_QUALITY, self.config.frame_quality]

        try:
            while not self._stop.is_set() and self._running.is_set():
                ret, frame = cap.read()
                if not ret:
                    break

                current = monotonic()
                elapsed = current - last_frame_ts
                last_frame_ts = current
                if elapsed > 0:
                    instantaneous = 1.0 / elapsed
                    fps = instantaneous if fps == 0.0 else (fps * 0.9) + (instantaneous * 0.1)

                result = process_inspection(frame)

                if current - last_frame_sent >= self._frame_interval:
                    ok, buffer = cv2.imencode(".jpg", result.frame, encode_params)
                    if ok:
                        self.link.send_frame(buffer.tobytes())
                        last_frame_sent = current

                if result.inspection and current - last_publish >= INSPECTION_INTERVAL:
                    self.link.send_event(build_inspection_event(self.config, result.inspection.to_dict()))
                    last_publish = current

                if current - last_status >= STATUS_INTERVAL:
                    self.link.send_event(build_station_status(self.config, running=True, fps=fps))
                    last_status = current

                if self.config.show_preview:
                    cv2.imshow("Kamera Inspeksi", result.frame)
                    if cv2.waitKey(1) & 0xFF == ord("q"):
                        self._stop.set()
                        break
        finally:
            cap.release()
            if self.config.show_preview:
                cv2.destroyAllWindows()
            self.link.send_event(build_station_status(self.config, running=False))


def main() -> None:
    config = load_config()
    runner = InspectionRunner(config)
    signal.signal(signal.SIGINT, runner.shutdown)
    signal.signal(signal.SIGTERM, runner.shutdown)
    try:
        runner.start()
    finally:
        runner.link.stop()


if __name__ == "__main__":
    main()
