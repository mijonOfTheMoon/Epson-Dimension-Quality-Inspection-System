import json
import queue
import threading
import time
from typing import Any, Callable
from urllib.parse import urlencode

import websocket

from config import AgentConfig

CommandHandler = Callable[[dict[str, Any]], None]


class AgentLink:
    def __init__(self, config: AgentConfig, on_command: CommandHandler) -> None:
        self.config = config
        self.on_command = on_command
        self._outbox: queue.Queue[tuple[int, bytes | str]] = queue.Queue(maxsize=128)
        self._stop = threading.Event()
        self._ready = threading.Event()
        self._ws: websocket.WebSocketApp | None = None
        self._thread = threading.Thread(target=self._run, name="agent-link", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._ws is not None:
            try:
                self._ws.close()
            except Exception:
                pass
        self._thread.join(timeout=3)

    def is_connected(self) -> bool:
        return self._ready.is_set()

    def send_event(self, event: dict[str, Any]) -> None:
        payload = json.dumps(event, separators=(",", ":"))
        self._enqueue(websocket.ABNF.OPCODE_TEXT, payload)

    def send_frame(self, frame_bytes: bytes) -> None:
        self._enqueue(websocket.ABNF.OPCODE_BINARY, frame_bytes, drop_when_full=True)

    def _enqueue(self, opcode: int, data: bytes | str, drop_when_full: bool = False) -> None:
        try:
            self._outbox.put_nowait((opcode, data))
        except queue.Full:
            if drop_when_full:
                return
            try:
                self._outbox.get_nowait()
                self._outbox.put_nowait((opcode, data))
            except queue.Empty:
                pass

    def _run(self) -> None:
        backoff = 1.0
        query = urlencode({"stationId": self.config.station_id, "token": self.config.agent_token})
        url = f"{self.config.backend_ws_url}?{query}"

        while not self._stop.is_set():
            self._ready.clear()
            self._ws = websocket.WebSocketApp(
                url,
                on_open=self._on_open,
                on_message=self._on_message,
                on_close=self._on_close,
                on_error=self._on_error,
            )
            sender = threading.Thread(target=self._sender_loop, daemon=True)
            sender.start()
            try:
                self._ws.run_forever(ping_interval=20, ping_timeout=10)
            except Exception:
                pass
            self._ready.clear()
            if self._stop.is_set():
                break
            time.sleep(backoff)
            backoff = min(backoff * 2, 30.0)
        self._ready.clear()

    def _sender_loop(self) -> None:
        while self._ws is not None and not self._stop.is_set():
            if not self._ready.wait(timeout=0.5):
                if self._stop.is_set():
                    return
                continue
            try:
                opcode, data = self._outbox.get(timeout=0.5)
            except queue.Empty:
                continue
            try:
                self._ws.send(data, opcode=opcode)
            except Exception:
                self._ready.clear()
                return

    def _on_open(self, _ws: Any) -> None:
        self._ready.set()

    def _on_message(self, _ws: Any, message: str | bytes) -> None:
        if isinstance(message, bytes):
            return
        try:
            payload = json.loads(message)
        except json.JSONDecodeError:
            return
        if isinstance(payload, dict):
            self.on_command(payload)

    def _on_close(self, _ws: Any, _code: int | None, _reason: str | None) -> None:
        self._ready.clear()

    def _on_error(self, _ws: Any, _error: Any) -> None:
        self._ready.clear()
