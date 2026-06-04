import json
import logging
import queue
import threading
from time import monotonic
from typing import Any

import requests

from config import AgentConfig

logger = logging.getLogger(__name__)


class BackendHttpClient:
    def __init__(self, config: AgentConfig) -> None:
        self.config = config
        self.base_url = config.backend_http_url.rstrip("/")
        self.headers = {"Authorization": f"Bearer {config.agent_token}"}
        self._status_queue: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=1)
        self._stop = threading.Event()
        self._status_failed = False
        self._status_failure_count = 0
        self._next_status_warning_at = 0.0
        self._worker = threading.Thread(
            target=self._status_worker,
            name="agent-status-http",
            daemon=True,
        )
        self._worker.start()

    def send_status(self, event: dict[str, Any]) -> bool:
        if self._stop.is_set():
            return False
        payload = dict(event)
        try:
            self._status_queue.put_nowait(payload)
        except queue.Full:
            try:
                self._status_queue.get_nowait()
                self._status_queue.task_done()
            except queue.Empty:
                pass
            try:
                self._status_queue.put_nowait(payload)
            except queue.Full:
                return False
        return True

    def send_inspection(self, event: dict[str, Any], snapshot_jpeg: bytes | None) -> bool:
        url = f"{self.base_url}/api/agent/inspections"
        try:
            if snapshot_jpeg:
                files = {
                    "snapshot": ("snapshot.jpg", snapshot_jpeg, "image/jpeg"),
                }
                data = {"inspection": json.dumps(event, separators=(",", ":"))}
                response = requests.post(
                    url,
                    headers=self.headers,
                    data=data,
                    files=files,
                    timeout=10,
                )
            else:
                data = {"inspection": json.dumps(event, separators=(",", ":"))}
                response = requests.post(url, headers=self.headers, data=data, timeout=10)
            response.raise_for_status()
            return True
        except requests.RequestException as exc:
            logger.warning("Inspection ingest failed: %s", exc)
            return False

    def close(self, timeout: float = 2.0) -> None:
        self._stop.set()
        self._worker.join(timeout=timeout)

    def _status_worker(self) -> None:
        session = requests.Session()
        try:
            while not self._stop.is_set() or not self._status_queue.empty():
                try:
                    payload = self._status_queue.get(timeout=0.2)
                except queue.Empty:
                    continue
                try:
                    self._post_status(session, payload)
                finally:
                    self._status_queue.task_done()
        finally:
            session.close()

    def _post_status(self, session: requests.Session, payload: dict[str, Any]) -> None:
        try:
            response = session.post(
                f"{self.base_url}/api/agent/status",
                headers={**self.headers, "Content-Type": "application/json"},
                json=payload,
                timeout=10,
            )
            response.raise_for_status()
            if self._status_failed:
                logger.info("Status ingest recovered")
            self._status_failed = False
            self._status_failure_count = 0
            self._next_status_warning_at = 0.0
        except requests.RequestException as exc:
            self._status_failed = True
            self._status_failure_count += 1
            now = monotonic()
            if now >= self._next_status_warning_at:
                suppressed = max(0, self._status_failure_count - 1)
                if suppressed:
                    logger.warning("Status ingest failed: %s (suppressed %s repeat failures)", exc, suppressed)
                else:
                    logger.warning("Status ingest failed: %s", exc)
                self._next_status_warning_at = now + 30.0
