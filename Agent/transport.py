import json
from typing import Any

from paho.mqtt import client as mqtt

from config import AgentConfig


class MqttPublisher:
    def __init__(self, config: AgentConfig) -> None:
        self.config = config
        self.client = mqtt.Client(client_id=f"{config.station_id}-{config.camera_id}")
        if config.mqtt_username:
            self.client.username_pw_set(config.mqtt_username, config.mqtt_password)
        self.client.connect(config.mqtt_host, config.mqtt_port, keepalive=30)
        self.client.loop_start()

    def publish(self, event: dict[str, Any]) -> bool:
        suffix = {
            "inspection.created": "inspection",
            "station.status": "status",
            "quality.alert": "alert",
        }.get(event.get("eventType"), "event")
        topic = f"{self.config.mqtt_topic_prefix}/{self.config.station_id}/{suffix}"
        payload = json.dumps(event, separators=(",", ":"))
        info = self.client.publish(topic, payload, qos=self.config.mqtt_qos)
        info.wait_for_publish(timeout=3)
        return info.rc == mqtt.MQTT_ERR_SUCCESS

    def close(self) -> None:
        self.client.loop_stop()
        self.client.disconnect()


def create_publisher(config: AgentConfig) -> MqttPublisher:
    return MqttPublisher(config)
