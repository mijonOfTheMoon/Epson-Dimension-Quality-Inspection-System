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

    def send_inspection(self, event: dict[str, Any], snapshot_jpeg: bytes | None) -> bool:
        url = f"{self.base_url}/api/agent/inspections"
        data = {"inspection": json.dumps(event, separators=(",", ":"))}
        try:
            if snapshot_jpeg:
                files = {"snapshot": ("snapshot.jpg", snapshot_jpeg, "image/jpeg")}
                response = requests.post(
                    url, headers=self.headers, data=data, files=files, timeout=10
                )
            else:
                response = requests.post(url, headers=self.headers, data=data, timeout=10)
            response.raise_for_status()
            return True
        except requests.RequestException as exc:
            logger.warning("Inspection ingest failed: %s", exc)
            return False

    def close(self) -> None:
        pass
