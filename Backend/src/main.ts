import { config } from './config/env.js';
import { createServer } from './http/server.js';
import { MqttIngestion } from './mqtt/mqtt-ingestion.js';
import { createStore } from './storage/index.js';

const store = createStore(config);
await store.init();

const { app, ingestion } = await createServer(config, store);
const mqttIngestion = new MqttIngestion(config, ingestion);
mqttIngestion.start();

const shutdown = async () => {
  await mqttIngestion.stop();
  await app.close();
  await store.close?.();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: config.HOST, port: config.PORT });
