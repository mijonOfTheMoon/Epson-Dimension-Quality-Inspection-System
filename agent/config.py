import os
from dataclasses import dataclass

from dotenv import load_dotenv


load_dotenv()

FRAME_FPS = 8
FRAME_QUALITY = 62


@dataclass(frozen=True)
class AgentConfig:
    agent_log_level: str
    station_id: str
    camera_index: int
    http_status_interval_seconds: float
    backend_http_url: str
    agent_token: str
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
        http_status_interval_seconds=float(os.getenv("HTTP_STATUS_INTERVAL_SECONDS", "30")),
        backend_http_url=os.getenv("BACKEND_HTTP_URL", "http://localhost:4000"),
        agent_token=os.getenv("AGENT_TOKEN", "change-me-agent-shared-token"),
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
