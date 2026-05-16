import type { FastifyInstance } from 'fastify';
import type { EventBus } from './event-bus.js';

export async function registerRealtime(app: FastifyInstance, eventBus: EventBus) {
  app.get('/ws', { websocket: true }, (socket: any) => {
    socket.send(JSON.stringify({ type: 'snapshot', events: eventBus.latest() }));
    const unsubscribe = eventBus.subscribe((event) => {
      if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'event', event }));
    });
    socket.on('close', unsubscribe);
  });
}
