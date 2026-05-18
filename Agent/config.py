import os
from dataclasses import dataclass

from dotenv import load_dotenv


load_dotenv()


def _bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class AgentConfig:
    station_id: str
    camera_id: str
    camera_index: int
    model_version: str
    backend_ws_url: str
    agent_token: str
    frame_fps: int
    frame_quality: int
    show_preview: bool


def load_config() -> AgentConfig:
    return AgentConfig(
        station_id=os.getenv("STATION_ID", "station-1"),
        camera_id=os.getenv("CAMERA_ID", "camera-1"),
        camera_index=int(os.getenv("CAMERA_INDEX", "0")),
        model_version=os.getenv("MODEL_VERSION", "vision-v1"),
        backend_ws_url=os.getenv("BACKEND_WS_URL", "ws://localhost:4000/ws/agent"),
        agent_token=os.getenv("AGENT_TOKEN", "change-me-agent-shared-token"),
        frame_fps=int(os.getenv("FRAME_FPS", "10")),
        frame_quality=int(os.getenv("FRAME_QUALITY", "70")),
        show_preview=_bool(os.getenv("SHOW_PREVIEW"), default=False),
    )
