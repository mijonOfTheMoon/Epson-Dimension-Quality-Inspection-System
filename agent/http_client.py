import json
import logging
from typing import Any

import requests

from config import AgentConfig

logger = logging.getLogger(__name__)


class BackendHttpClient:
    def __init__(self, config: AgentConfig) -> None:
        self.config = config
        self.base_url = config.backend_http_url.rstrip("/")
        self.headers = {"Authorization": f"Bearer {config.agent_token}"}

    def send_inspection_event(self, event: dict[str, Any]) -> bool:
        url = f"{self.base_url}/api/agent/inspections"
        files = {"inspection": (None, json.dumps(event, separators=(",", ":")))}
        try:
            response = requests.post(url, headers=self.headers, files=files, timeout=10)
            response.raise_for_status()
            return True
        except requests.RequestException as exc:
            logger.warning("Inspection ingest failed: %s", exc)
            return False

    def upload_frame(
        self,
        parent_event_id: str,
        station_id: str,
        captured_at: str,
        snapshot_jpeg: bytes,
    ) -> bool:
        url = f"{self.base_url}/api/agent/inspections/frame"
        data = {
            "parentEventId": parent_event_id,
            "stationId": station_id,
            "capturedAt": captured_at,
        }
        files = {"snapshot": ("snapshot.jpg", snapshot_jpeg, "image/jpeg")}
        try:
            response = requests.post(
                url, headers=self.headers, data=data, files=files, timeout=15
            )
            response.raise_for_status()
            return True
        except requests.RequestException as exc:
            logger.warning("Frame upload failed: %s", exc)
            return False

    def close(self) -> None:
        pass
