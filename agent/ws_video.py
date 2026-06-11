from __future__ import annotations

import logging
import threading
from typing import Any, Callable
from urllib.parse import quote

import cv2

from config import FRAME_QUALITY, AgentConfig

try:
    import websocket
except ImportError:
    websocket = None

VideoReadyHandler = Callable[[str, str], None]
logger = logging.getLogger(__name__)

SEND_WAIT_TIMEOUT = 1.0
CONNECT_TIMEOUT = 5.0


class WsVideoPublisher:
    def __init__(self, config: AgentConfig, fps: int) -> None:
        self.config = config
        self.fps = fps
        self._encode_params = [cv2.IMWRITE_JPEG_QUALITY, FRAME_QUALITY]
        self._lock = threading.Lock()
        self._condition = threading.Condition(self._lock)
        self._latest: Any = None
        self._ws: Any = None
        self._thread: threading.Thread | None = None
        self._active = False

    def start(self, track_name: str | None, on_ready: VideoReadyHandler | None) -> None:
        if websocket is None:
            logger.warning("websocket-client is not installed; WS video publishing disabled")
            return
        with self._lock:
            if self._active:
                return
            self._active = True
            self._latest = None
        thread = threading.Thread(target=self._run, name="ws-video-publisher", daemon=True)
        self._thread = thread
        thread.start()

    def stop(self) -> None:
        with self._condition:
            if not self._active:
                return
            self._active = False
            self._condition.notify_all()
        thread = self._thread
        if thread is not None and thread is not threading.current_thread():
            thread.join(timeout=2.0)
        self._thread = None

    def submit_frame(self, frame: cv2.Mat, meta: str | None = None) -> None:
        with self._condition:
            if not self._active:
                return
            self._latest = (frame.copy(), meta)
            self._condition.notify()

    def _build_url(self) -> str:
        base = self.config.backend_http_url.strip()
        if base.startswith("https://"):
            ws_base = "wss://" + base[len("https://"):]
        elif base.startswith("http://"):
            ws_base = "ws://" + base[len("http://"):]
        else:
            ws_base = "ws://" + base
        ws_base = ws_base.rstrip("/")
        station = quote(self.config.station_id, safe="")
        token = quote(self.config.agent_token, safe="")
        return f"{ws_base}/api/video/stations/{station}/publish?token={token}"

    def _run(self) -> None:
        try:
            connection = websocket.create_connection(self._build_url(), timeout=CONNECT_TIMEOUT)
        except Exception as exc:
            logger.warning("WS video connect failed: %s", exc)
            with self._lock:
                self._active = False
            return
        with self._lock:
            self._ws = connection
        try:
            self._pump(connection)
        finally:
            with self._lock:
                self._ws = None
            try:
                connection.close()
            except Exception:
                pass

    def _pump(self, connection: Any) -> None:
        while True:
            with self._condition:
                while self._active and self._latest is None:
                    self._condition.wait(timeout=SEND_WAIT_TIMEOUT)
                if not self._active:
                    return
                payload = self._latest
                self._latest = None
            if payload is None:
                continue
            frame, meta = payload
            ok, buffer = cv2.imencode(".jpg", frame, self._encode_params)
            if not ok:
                continue
            meta_bytes = meta.encode("utf-8") if meta else b""
            message = len(meta_bytes).to_bytes(4, "big") + meta_bytes + buffer.tobytes()
            try:
                connection.send_binary(message)
            except Exception as exc:
                logger.warning("WS video send failed: %s", exc)
                with self._lock:
                    self._active = False
                return
