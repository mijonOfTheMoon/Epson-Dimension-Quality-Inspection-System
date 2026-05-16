import mqtt, { type IClientOptions, type MqttClient } from 'mqtt';
import type { AppConfig } from '../config/env.js';
import type { IngestionService } from '../services/ingestion-service.js';

export class MqttIngestion {
  private client?: MqttClient;

  constructor(
    private readonly config: AppConfig,
    private readonly ingestion: IngestionService,
  ) {}

  start() {
    if (!this.config.MQTT_ENABLED) return;

    const options: IClientOptions = {
      clientId: this.config.MQTT_CLIENT_ID,
      clean: false,
      reconnectPeriod: 2000,
      username: this.config.MQTT_USERNAME || undefined,
      password: this.config.MQTT_PASSWORD || undefined,
    };

    this.client = mqtt.connect(this.config.MQTT_URL, options);
    this.client.on('connect', () => {
      const prefix = this.config.MQTT_TOPIC_PREFIX;
      this.client?.subscribe([
        `${prefix}/+/inspection`,
        `${prefix}/+/status`,
        `${prefix}/+/alert`,
      ], { qos: this.config.MQTT_QOS as 0 | 1 | 2 });
    });

    this.client.on('message', async (_topic, payload) => {
      try {
        await this.ingestion.ingest(JSON.parse(payload.toString('utf8')));
      } catch {}
    });
  }

  async stop() {
    if (!this.client) return;
    await this.client.endAsync();
  }
}
