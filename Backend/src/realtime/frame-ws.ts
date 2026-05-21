import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { encodeFramePacket, type FrameBus } from './frame-bus.js';

interface FrameQuery {
  stationId?: string;
}

export async function registerFrameWs(app: FastifyInstance, frameBus: FrameBus) {
  app.get('/ws/frames', { websocket: true }, (socket: WebSocket, request: FastifyRequest) => {
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
