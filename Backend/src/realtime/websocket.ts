import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { extractBearerToken, extractQueryToken, type AuthService } from '../services/auth-service.js';
import type { EventBus } from './event-bus.js';

export async function registerRealtime(app: FastifyInstance, eventBus: EventBus, auth: AuthService) {
  app.get('/ws', { websocket: true }, async (socket: WebSocket, request: FastifyRequest) => {
    const user = await auth.resolveUser(extractBearerToken(request.headers.authorization) ?? extractQueryToken(request.query));
    if (!user) {
      try { socket.close(4003, 'unauthorized'); } catch { /* ignore */ }
      return;
    }

    socket.send(JSON.stringify({ type: 'snapshot', events: eventBus.latest() }));
    const unsubscribe = eventBus.subscribe((event) => {
      if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'event', event }));
    });
    socket.on('close', unsubscribe);
  });
}
