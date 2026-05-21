import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import fastify from 'fastify';
import { ZodError } from 'zod';
import type { AppConfig } from '../config/env.js';
import { AgentRegistry } from '../realtime/agent-registry.js';
import { EventBus } from '../realtime/event-bus.js';
import { FrameBus } from '../realtime/frame-bus.js';
import { registerAgentWs } from '../realtime/agent-ws.js';
import { registerFrameWs } from '../realtime/frame-ws.js';
import { registerRealtime } from '../realtime/websocket.js';
import { AuthService, extractBearerToken, type SafeUser } from '../services/auth-service.js';
import { IngestionService } from '../services/ingestion-service.js';
import type { DataStore } from '../storage/store.js';
import { registerRoutes } from './routes.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: SafeUser;
  }
}

export async function createServer(config: AppConfig, store: DataStore) {
  const app = fastify({ logger: { level: config.LOG_LEVEL } });
  const eventBus = new EventBus(config.EVENT_REPLAY_LIMIT);
  const ingestion = new IngestionService(store, eventBus);
  const auth = new AuthService(config, store);
  const frameBus = new FrameBus();
  const agentRegistry = new AgentRegistry();

  await app.register(cors, {
    origin: config.CORS_ORIGIN === '*' ? true : config.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
  });
  await app.register(websocket);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        message: 'Invalid request',
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    return reply.send(error);
  });

  app.addHook('onRequest', async (request) => {
    const token = extractBearerToken(request.headers.authorization);
    if (!token) return;
    const user = await auth.resolveUser(token);
    if (user) request.auth = user;
  });

  await registerRoutes(app, { store, ingestion, auth, agentRegistry });
  await registerRealtime(app, eventBus, auth);
  await registerFrameWs(app, frameBus, auth);
  await registerAgentWs(app, config, agentRegistry, frameBus, ingestion);

  return { app, ingestion, frameBus, agentRegistry, auth };
}
