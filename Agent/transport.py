import json
from typing import Any, Protocol

import requests
from paho.mqtt import client as mqtt

from config import AgentConfig
from event_buffer import EventBuffer


class Publisher(Protocol):
    def publish(self, event: dict[str, Any]) -> bool: ...
    def close(self) -> None: ...


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


class HttpPublisher:
    def __init__(self, url: str) -> None:
        self.url = url

    def publish(self, event: dict[str, Any]) -> bool:
        response = requests.post(self.url, json=event, timeout=3)
        return 200 <= response.status_code < 300

    def close(self) -> None:
        return None


class ReliablePublisher:
    def __init__(self, publishers: list[Publisher], buffer: EventBuffer) -> None:
        self.publishers = publishers
        self.buffer = buffer

    def publish(self, event: dict[str, Any]) -> bool:
        queued = self.buffer.read_all()
        if queued:
            remaining: list[dict[str, Any]] = []
            for item in queued:
                if not self._send(item):
                    remaining.append(item)
            if remaining:
                remaining.append(event)
                self.buffer.replace(remaining)
                return False
            self.buffer.clear()

        if self._send(event):
            return True

        self.buffer.append(event)
        return False

    def close(self) -> None:
        for publisher in self.publishers:
            publisher.close()

    def _send(self, event: dict[str, Any]) -> bool:
        for publisher in self.publishers:
            try:
                if publisher.publish(event):
                    return True
            except Exception:
                continue
        return False


def create_publisher(config: AgentConfig) -> ReliablePublisher:
    publishers: list[Publisher] = []
    if config.mqtt_enabled:
        publishers.append(MqttPublisher(config))
    if config.http_fallback_url:
        publishers.append(HttpPublisher(config.http_fallback_url))
    return ReliablePublisher(publishers, EventBuffer(config.buffer_file))
