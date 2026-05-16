import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import fastify from 'fastify';
import type { AppConfig } from '../config/env.js';
import { EventBus } from '../realtime/event-bus.js';
import { registerRealtime } from '../realtime/websocket.js';
import { IngestionService } from '../services/ingestion-service.js';
import type { DataStore } from '../storage/store.js';
import { registerRoutes } from './routes.js';

export async function createServer(config: AppConfig, store: DataStore) {
  const app = fastify({ logger: { level: config.LOG_LEVEL } });
  const eventBus = new EventBus(config.EVENT_REPLAY_LIMIT);
  const ingestion = new IngestionService(store, eventBus);

  await app.register(cors, {
    origin: config.CORS_ORIGIN === '*' ? true : config.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
  });
  await app.register(websocket);
  await registerRoutes(app, store, ingestion);
  await registerRealtime(app, eventBus);

  return { app, ingestion };
}
