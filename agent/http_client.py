import json
import logging
import queue
import threading
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
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
        self._status_backoff_until = 0.0
        self._status_backoff_seconds = 1.0
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
                    self._wait_for_status_backoff()
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
            self._status_backoff_until = 0.0
            self._status_backoff_seconds = 1.0
        except requests.RequestException as exc:
            self._status_failed = True
            self._status_failure_count += 1
            self._apply_status_backoff(exc)
            now = monotonic()
            if now >= self._next_status_warning_at:
                suppressed = max(0, self._status_failure_count - 1)
                if suppressed:
                    logger.warning("Status ingest failed: %s (suppressed %s repeat failures)", exc, suppressed)
                else:
                    logger.warning("Status ingest failed: %s", exc)
                self._next_status_warning_at = now + 30.0

    def _wait_for_status_backoff(self) -> None:
        delay = self._status_backoff_until - monotonic()
        if delay > 0:
            self._stop.wait(delay)

    def _apply_status_backoff(self, exc: requests.RequestException) -> None:
        response = getattr(exc, "response", None)
        status_code = response.status_code if response is not None else None
        retry_after = _retry_after_seconds(response.headers.get("Retry-After")) if response is not None else None
        should_backoff = (
            status_code == 429
            or (status_code is not None and status_code >= 500)
            or isinstance(exc, (requests.ConnectionError, requests.Timeout))
        )
        if not should_backoff:
            return
        delay = retry_after if retry_after is not None else self._status_backoff_seconds
        self._status_backoff_until = monotonic() + min(delay, 60.0)
        self._status_backoff_seconds = min(self._status_backoff_seconds * 2.0, 60.0)


def _retry_after_seconds(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        pass
    try:
        retry_at = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    if retry_at.tzinfo is None:
        retry_at = retry_at.replace(tzinfo=timezone.utc)
    return max(0.0, (retry_at - datetime.now(timezone.utc)).total_seconds())
