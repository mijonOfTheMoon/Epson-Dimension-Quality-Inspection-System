import os
from dataclasses import dataclass

from dotenv import load_dotenv


load_dotenv()

FRAME_FPS = 8
FRAME_QUALITY = 62


@dataclass(frozen=True)
class AgentConfig:
    station_id: str
    camera_index: int
    backend_ws_url: str
    agent_token: str


def load_config() -> AgentConfig:
    return AgentConfig(
        station_id=os.getenv("STATION_ID", "Station 1"),
        camera_index=int(os.getenv("CAMERA_INDEX", "0")),
        backend_ws_url=os.getenv("BACKEND_WS_URL", "ws://localhost/ws/agent"),
        agent_token=os.getenv("AGENT_TOKEN", "change-me-agent-shared-token"),
    )
