from __future__ import annotations

import json
import logging
import threading
from datetime import datetime
from typing import Any, Callable
from uuid import uuid4
from zoneinfo import ZoneInfo

import paho.mqtt.client as mqtt

from config import AgentConfig

CommandHandler = Callable[[dict[str, Any]], None]
logger = logging.getLogger(__name__)


def _safe_topic_segment(value: str) -> str:
    return "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in value)


def _now_iso() -> str:
    return datetime.now(ZoneInfo("Asia/Jakarta")).isoformat()


class MqttLink:
    def __init__(self, config: AgentConfig, on_command: CommandHandler) -> None:
        self.config = config
        self.on_command = on_command
        self._lock = threading.Lock()
        self._connected_at = _now_iso()
        station_segment = _safe_topic_segment(config.station_id)
        prefix = config.mqtt_topic_prefix.rstrip("/")
        self.presence_topic = f"{prefix}/stations/{station_segment}/presence"
        self.commands_topic = f"{prefix}/stations/{station_segment}/commands"
        self._client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=f"diminspect-agent-{station_segment}-{uuid4()}",
            clean_session=True,
        )
        if config.mqtt_username:
            self._client.username_pw_set(config.mqtt_username, config.mqtt_password)
        if config.mqtt_use_tls:
            self._client.tls_set()
        self._client.will_set(
            self.presence_topic,
            payload=json.dumps(self._offline_payload(), separators=(",", ":")),
            qos=1,
            retain=True,
        )
        self._client.on_connect = self._on_connect
        self._client.on_disconnect = self._on_disconnect
        self._client.on_message = self._on_message

    def start(self) -> None:
        if not self.config.mqtt_host:
            raise RuntimeError("MQTT_HOST is required for standby agent mode")
        self._client.connect_async(self.config.mqtt_host, self.config.mqtt_port, keepalive=30)
        self._client.loop_start()

    def stop(self) -> None:
        try:
            self.publish_offline(wait=True)
        finally:
            self._client.disconnect()
            self._client.loop_stop()

    def publish_presence(
        self,
        *,
        online: bool,
        running: bool,
        phase: str,
        fps: float | None = None,
        active_part_code: str | None = None,
        video_session_id: str | None = None,
        video_track_name: str | None = None,
        detections: list[dict[str, Any]] | None = None,
    ) -> None:
        payload: dict[str, Any] = {
            "stationId": self.config.station_id,
            "online": online,
            "running": running,
            "phase": phase,
            "updatedAt": _now_iso(),
        }
        if online:
            payload["connectedAt"] = self._connected_at
        if fps is not None:
            payload["fps"] = round(fps, 2)
        if active_part_code:
            payload["activePartCode"] = active_part_code
        if video_session_id:
            payload["videoSessionId"] = video_session_id
        if video_track_name:
            payload["videoTrackName"] = video_track_name
        if detections is not None:
            payload["detections"] = detections
        with self._lock:
            self._client.publish(
                self.presence_topic,
                payload=json.dumps(payload, separators=(",", ":")),
                qos=1,
                retain=True,
            )

    def publish_offline(self, *, wait: bool = False) -> None:
        with self._lock:
            info = self._client.publish(
                self.presence_topic,
                payload=json.dumps(self._offline_payload(), separators=(",", ":")),
                qos=1,
                retain=True,
            )
        if wait:
            info.wait_for_publish(timeout=2)

    def _offline_payload(self) -> dict[str, Any]:
        return {
            "stationId": self.config.station_id,
            "online": False,
            "running": False,
            "phase": "idle",
            "updatedAt": _now_iso(),
        }

    def _on_connect(
        self,
        client: mqtt.Client,
        _userdata: Any,
        _flags: mqtt.ConnectFlags,
        reason_code: mqtt.ReasonCode,
        _properties: mqtt.Properties | None,
    ) -> None:
        if reason_code.is_failure:
            logger.warning("MQTT connect failed: %s", reason_code)
            return
        client.subscribe(self.commands_topic, qos=1)
        self.publish_presence(online=True, running=False, phase="idle")

    def _on_disconnect(
        self,
        _client: mqtt.Client,
        _userdata: Any,
        _disconnect_flags: mqtt.DisconnectFlags,
        reason_code: mqtt.ReasonCode,
        _properties: mqtt.Properties | None,
    ) -> None:
        if reason_code.is_failure:
            logger.warning("MQTT disconnected: %s", reason_code)

    def _on_message(self, _client: mqtt.Client, _userdata: Any, message: mqtt.MQTTMessage) -> None:
        try:
            payload = json.loads(message.payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return
        if isinstance(payload, dict):
            self.on_command(payload)
