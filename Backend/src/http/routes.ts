import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { inspectionCreatedSchema, loginSchema, statusUpdateSchema } from '../domain/schemas.js';
import type { IngestionService } from '../services/ingestion-service.js';
import type { DataStore } from '../storage/store.js';

const inspectionQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(1000).optional(),
  status: z.enum(['OK', 'NG']).optional(),
  partCode: z.string().optional(),
});

const alertQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
});

export async function registerRoutes(app: FastifyInstance, store: DataStore, ingestion: IngestionService) {
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  app.get('/api/dashboard/summary', async () => store.getDashboardSummary());

  app.get('/api/inspections', async (request) => {
    const query = inspectionQuerySchema.parse(request.query);
    return store.listInspections(query);
  });

  app.post('/api/inspections', async (request, reply) => {
    const event = inspectionCreatedSchema.parse(request.body);
    const saved = await ingestion.ingest(event);
    if (!saved) return reply.code(202).send({ duplicated: true });
    return reply.code(201).send(saved);
  });

  app.get('/api/stations', async () => store.listStations());

  app.get('/api/alerts', async (request) => {
    const query = alertQuerySchema.parse(request.query);
    return store.listAlerts(query.limit ?? 100);
  });

  app.get('/api/parts', async () => store.listParts());

  // Password is excluded at the store level — safe to return directly
  app.get('/api/users', async () => store.listUsers());

  app.post('/api/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const user = await store.login(body.username, body.password);
    if (!user) return reply.code(401).send({ message: 'Invalid credentials' });
    // Strip password before sending to client
    const { password: _, ...safeUser } = user;
    return safeUser;
  });

  app.get('/api/quality-records', async () => store.listQualityRecords());

  app.patch('/api/quality-records/:id/status', async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = statusUpdateSchema.parse(request.body);
    const record = await store.updateQualityRecordStatus(params.id, body.status, body.changedBy);
    if (!record) return reply.code(404).send({ message: 'Record not found' });
    return record;
  });
}
