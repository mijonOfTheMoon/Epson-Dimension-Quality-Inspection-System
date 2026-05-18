import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { encodeFramePacket, type FrameBus } from './frame-bus.js';

export async function registerFrameWs(app: FastifyInstance, frameBus: FrameBus) {
  app.get('/ws/frames', { websocket: true }, (socket: WebSocket) => {
    for (const [stationId, frame] of frameBus.snapshot()) {
      if (socket.readyState !== 1) break;
      socket.send(encodeFramePacket(stationId, frame));
    }

    const unsubscribe = frameBus.subscribe((stationId, frame) => {
      if (socket.readyState !== 1) return;
      try {
        socket.send(encodeFramePacket(stationId, frame));
      } catch (error) {
        app.log.debug({ err: error }, 'frame ws send failed');
      }
    });

    socket.on('close', unsubscribe);
    socket.on('error', unsubscribe);
  });
}
