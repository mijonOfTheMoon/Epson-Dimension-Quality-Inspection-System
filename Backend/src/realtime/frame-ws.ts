import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { extractBearerToken, extractQueryToken, type AuthService } from '../services/auth-service.js';
import { encodeFramePacket, type FrameBus } from './frame-bus.js';

interface FrameQuery {
  stationId?: string;
}

export async function registerFrameWs(app: FastifyInstance, frameBus: FrameBus, auth: AuthService) {
  app.get('/ws/frames', { websocket: true }, async (socket: WebSocket, request: FastifyRequest) => {
    const user = await auth.resolveUser(extractBearerToken(request.headers.authorization) ?? extractQueryToken(request.query));
    if (!user) {
      try { socket.close(4003, 'unauthorized'); } catch { /* ignore */ }
      return;
    }

    const query = (request.query ?? {}) as FrameQuery;
    const requestedStation = query.stationId?.trim();
    const unsubscribe = frameBus.subscribe((stationId, frame) => {
      if (requestedStation && requestedStation !== stationId) return;
      if (socket.readyState !== 1) return;
      try {
        socket.send(encodeFramePacket(stationId, frame));
      } catch (error) {
        app.log.debug({ err: error }, 'frame ws send failed');
      }
    }, requestedStation);

    socket.on('close', unsubscribe);
    socket.on('error', unsubscribe);
  });
}
