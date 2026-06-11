import os
from dataclasses import dataclass

from dotenv import load_dotenv


load_dotenv()


def _int_env(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, ""))
    except (TypeError, ValueError):
        return default
    return value if value > 0 else default


FRAME_FPS = _int_env("FRAME_FPS", 30)
FRAME_QUALITY = _int_env("FRAME_QUALITY", 62)
CAMERA_WIDTH = _int_env("CAMERA_WIDTH", 0)
CAMERA_HEIGHT = _int_env("CAMERA_HEIGHT", 0)
CAMERA_FPS = _int_env("CAMERA_FPS", 0)


@dataclass(frozen=True)
class AgentConfig:
    agent_log_level: str
    station_id: str
    camera_index: int
    backend_http_url: str
    agent_token: str
    video_transport: str
    mqtt_host: str
    mqtt_port: int
    mqtt_username: str
    mqtt_password: str
    mqtt_topic_prefix: str
    mqtt_use_tls: bool
    cloudflare_realtime_enabled: bool
    cloudflare_realtime_app_id: str
    cloudflare_realtime_app_secret: str
    cloudflare_realtime_api_base_url: str


def load_config() -> AgentConfig:
    return AgentConfig(
        agent_log_level=os.getenv("AGENT_LOG_LEVEL", "INFO").strip() or "INFO",
        station_id=os.getenv("STATION_ID", "Station 1"),
        camera_index=int(os.getenv("CAMERA_INDEX", "0")),
        backend_http_url=os.getenv("BACKEND_HTTP_URL", "http://localhost:4000"),
        agent_token=os.getenv("AGENT_TOKEN", "change-me-agent-shared-token"),
        video_transport=os.getenv("VIDEO_TRANSPORT", "ws").strip().lower() or "ws",
        mqtt_host=os.getenv("MQTT_HOST", ""),
        mqtt_port=int(os.getenv("MQTT_PORT", "8883")),
        mqtt_username=os.getenv("MQTT_USERNAME", ""),
        mqtt_password=os.getenv("MQTT_PASSWORD", ""),
        mqtt_topic_prefix=os.getenv("MQTT_TOPIC_PREFIX", "diminspect/development").strip("/"),
        mqtt_use_tls=os.getenv("MQTT_USE_TLS", "true").lower() in {"1", "true", "yes"},
        cloudflare_realtime_enabled=os.getenv("CLOUDFLARE_REALTIME_ENABLED", "false").lower()
        in {"1", "true", "yes"},
        cloudflare_realtime_app_id=os.getenv("CLOUDFLARE_REALTIME_APP_ID", ""),
        cloudflare_realtime_app_secret=os.getenv("CLOUDFLARE_REALTIME_APP_SECRET", ""),
        cloudflare_realtime_api_base_url=os.getenv(
            "CLOUDFLARE_REALTIME_API_BASE_URL",
            "https://rtc.live.cloudflare.com/v1",
        ).rstrip("/"),
    )
