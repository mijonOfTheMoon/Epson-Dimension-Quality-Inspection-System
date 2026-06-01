import json
from typing import Any

import requests

from config import AgentConfig


class BackendHttpClient:
    def __init__(self, config: AgentConfig) -> None:
        self.config = config
        self.base_url = config.backend_http_url.rstrip("/")
        self.headers = {"Authorization": f"Bearer {config.agent_token}"}

    def send_status(self, event: dict[str, Any]) -> bool:
        return self._post_json("/api/agent/status", event)

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
            print(f"[agent-http] inspection ingest failed: {exc}")
            return False

    def _post_json(self, path: str, payload: dict[str, Any]) -> bool:
        try:
            response = requests.post(
                f"{self.base_url}{path}",
                headers={**self.headers, "Content-Type": "application/json"},
                json=payload,
                timeout=5,
            )
            response.raise_for_status()
            return True
        except requests.RequestException as exc:
            print(f"[agent-http] status ingest failed: {exc}")
            return False
