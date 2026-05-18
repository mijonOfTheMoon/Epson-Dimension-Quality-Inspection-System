import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import type { AppConfig } from '../config/env.js';
import type { IngestionService } from '../services/ingestion-service.js';
import type { AgentRegistry } from './agent-registry.js';
import type { FrameBus } from './frame-bus.js';

interface AgentQuery {
  stationId?: string;
  token?: string;
}

export async function registerAgentWs(
  app: FastifyInstance,
  config: AppConfig,
  registry: AgentRegistry,
  frameBus: FrameBus,
  ingestion: IngestionService,
) {
  app.get('/ws/agent', { websocket: true }, (socket: WebSocket, request: FastifyRequest) => {
    const query = (request.query ?? {}) as AgentQuery;
    const stationId = query.stationId?.trim();
    const token = query.token?.trim();

    if (!stationId || token !== config.AGENT_TOKEN) {
      try { socket.close(4003, 'unauthorized'); } catch { /* ignore */ }
      return;
    }

    const connection = registry.register(stationId, socket);
    app.log.info({ stationId }, 'agent connected');

    socket.on('message', async (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        frameBus.publish(stationId, data);
        return;
      }
      try {
        const event = JSON.parse(data.toString('utf8'));
        if (event && typeof event === 'object' && event.eventType === 'station.status') {
          registry.setRunning(stationId, Boolean(event.running));
        }
        await ingestion.ingest(event);
      } catch (error) {
        app.log.warn({ err: error, stationId }, 'agent message ingest failed');
      }
    });

    const cleanup = async () => {
      registry.unregister(stationId, socket);
      frameBus.forget(stationId);
      try {
        await ingestion.ingest({
          eventId: `agent-offline-${stationId}-${Date.now()}`,
          eventType: 'station.status',
          stationId,
          timestamp: new Date().toISOString(),
          state: 'offline',
          running: false,
        });
      } catch (error) {
        app.log.debug({ err: error, stationId }, 'failed to record agent offline');
      }
    };

    socket.on('close', () => {
      app.log.info({ stationId }, 'agent disconnected');
      void cleanup();
    });

    socket.on('error', (error: Error) => {
      app.log.warn({ err: error, stationId }, 'agent socket error');
    });

    void ingestion.ingest({
      eventId: `agent-online-${stationId}-${Date.now()}`,
      eventType: 'station.status',
      stationId,
      timestamp: connection.connectedAt,
      state: 'online',
      running: false,
    });
  });
}
