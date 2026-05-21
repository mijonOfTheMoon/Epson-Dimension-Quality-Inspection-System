import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { inspectionCreatedSchema, loginSchema, statusUpdateSchema } from '../domain/schemas.js';
import type { AgentRegistry, AgentCommand } from '../realtime/agent-registry.js';
import type { AuthService } from '../services/auth-service.js';
import type { IngestionService } from '../services/ingestion-service.js';
import type { DataStore } from '../storage/store.js';

const inspectionQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(1000).optional(),
  status: z.enum(['OK', 'NG']).optional(),
  partCode: z.string().optional(),
});

const agentCommandSchema = z.object({
  command: z.enum(['start', 'stop', 'capture', 'recalibrate']),
  partCode: z.string().min(1).optional(),
  shift: z.enum(['A', 'B', 'C']).optional(),
  batchNo: z.string().min(1).optional(),
});

const shiftUpdateSchema = z.object({
  label: z.string().min(1),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  active: z.boolean(),
});

const batchCreateSchema = z.object({
  batchNo: z.string().min(1),
  partCode: z.string().min(1),
  shift: z.enum(['A', 'B', 'C']),
  targetQty: z.coerce.number().int().nonnegative(),
});

export interface RouteDeps {
  store: DataStore;
  ingestion: IngestionService;
  auth: AuthService;
  agentRegistry: AgentRegistry;
}

function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  if (!request.auth) {
    reply.code(401).send({ message: 'Unauthorized' });
    return false;
  }
  return true;
}

export async function registerRoutes(app: FastifyInstance, deps: RouteDeps) {
  const { store, ingestion, auth, agentRegistry } = deps;

  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  app.post('/api/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const result = await auth.login(body.username, body.password);
    if (!result) return reply.code(401).send({ message: 'Invalid credentials' });
    return result;
  });

  app.get('/api/auth/me', async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ message: 'Unauthorized' });
    return request.auth;
  });

  app.post('/api/auth/logout', async (_request, reply) => reply.code(204).send());

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

  app.get('/api/parts', async () => store.listParts());

  app.get('/api/users', async () => store.listUsers());

  app.get('/api/shift-schedules', async () => store.listShiftSchedules());

  app.patch('/api/shift-schedules/:id', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = shiftUpdateSchema.parse(request.body);
    const shift = await store.updateShiftSchedule(params.id, body);
    if (!shift) return reply.code(404).send({ message: 'Shift tidak ditemukan' });
    return shift;
  });

  app.get('/api/batches', async () => store.listBatches());

  app.post('/api/batches', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const body = batchCreateSchema.parse(request.body);
    try {
      const batch = await store.openBatch(body);
      return reply.code(201).send(batch);
    } catch (error) {
      if (error instanceof Error) return reply.code(400).send({ message: error.message });
      return reply.code(400).send({ message: 'Batch gagal dibuat' });
    }
  });

  app.patch('/api/batches/:id/close', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const batch = await store.closeBatch(params.id);
    if (!batch) return reply.code(404).send({ message: 'Batch tidak ditemukan' });
    return batch;
  });

  app.get('/api/agents', async () => agentRegistry.list());

  app.post('/api/agents/:stationId/command', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const authUser = request.auth;
    if (!authUser) return;
    const params = z.object({ stationId: z.string().min(1) }).parse(request.params);
    const body = agentCommandSchema.parse(request.body);

    const command: AgentCommand = { type: body.command };
    if (body.command === 'start') {
      if (!body.partCode) return reply.code(400).send({ message: 'partCode wajib diisi saat start' });
      const part = await store.findPart(body.partCode);
      if (!part) return reply.code(404).send({ message: `Part ${body.partCode} tidak ditemukan` });
      command.part = {
        partId: part.id,
        partCode: part.partCode,
        partName: part.partName,
        vendor: part.vendor,
        dimensions: part.dimensions,
      };
      command.operator = { id: authUser.id, name: authUser.name };
      command.shift = body.shift;
      command.batchNo = body.batchNo;
    }

    const delivered = agentRegistry.send(params.stationId, command);
    if (!delivered) return reply.code(404).send({ message: 'Agent offline' });
    return { stationId: params.stationId, command: body.command, delivered: true };
  });

  app.get('/api/quality-records', async () => store.listQualityRecords());

  app.patch('/api/quality-records/:id/status', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = statusUpdateSchema.parse(request.body);
    const record = await store.updateQualityRecordStatus(params.id, body.status, body.changedBy);
    if (!record) return reply.code(404).send({ message: 'Record not found' });
    return record;
  });
}
