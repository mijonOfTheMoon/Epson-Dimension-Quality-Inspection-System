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
    mqtt_enabled: bool
    mqtt_host: str
    mqtt_port: int
    mqtt_username: str | None
    mqtt_password: str | None
    mqtt_topic_prefix: str
    mqtt_qos: int
    http_fallback_url: str | None
    buffer_file: str


def load_config() -> AgentConfig:
    return AgentConfig(
        station_id=os.getenv("STATION_ID", "station-1"),
        camera_id=os.getenv("CAMERA_ID", "camera-1"),
        camera_index=int(os.getenv("CAMERA_INDEX", "0")),
        model_version=os.getenv("MODEL_VERSION", "vision-v1"),
        mqtt_enabled=_bool(os.getenv("MQTT_ENABLED"), False),
        mqtt_host=os.getenv("MQTT_HOST", "localhost"),
        mqtt_port=int(os.getenv("MQTT_PORT", "1883")),
        mqtt_username=os.getenv("MQTT_USERNAME") or None,
        mqtt_password=os.getenv("MQTT_PASSWORD") or None,
        mqtt_topic_prefix=os.getenv("MQTT_TOPIC_PREFIX", "diminspect"),
        mqtt_qos=int(os.getenv("MQTT_QOS", "1")),
        http_fallback_url=os.getenv("HTTP_FALLBACK_URL") or None,
        buffer_file=os.getenv("BUFFER_FILE", "agent_buffer.jsonl"),
    )
