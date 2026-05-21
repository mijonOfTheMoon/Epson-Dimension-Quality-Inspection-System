import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { dimensionSpecSchema, inspectionCreatedSchema, loginSchema, statusUpdateSchema } from '../domain/schemas.js';
import type { DimensionSpec, PartType, RequestStatus, UserRole } from '../domain/types.js';
import type { AgentRegistry, AgentCommand } from '../realtime/agent-registry.js';
import type { AuthService, SafeUser } from '../services/auth-service.js';
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
  inspectionView: z.enum(['top', 'side']).optional(),
  shift: z.enum(['A', 'B', 'C']).optional(),
  batchNo: z.string().min(1).optional(),
});

const partInputSchema = z.object({
  partName: z.string().min(1),
  partCode: z.string().min(1),
  vendor: z.string().min(1),
  dimensions: z.array(dimensionSpecSchema).min(1),
});

const userRoleSchema = z.enum(['operator', 'qc', 'supervisor', 'engineering', 'admin', 'vendor']);

const userCreateSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(4),
  name: z.string().min(1),
  role: userRoleSchema,
  avatar: z.string().optional(),
});

const userUpdateSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(4).optional().or(z.literal('')),
  name: z.string().min(1),
  role: userRoleSchema,
  avatar: z.string().optional(),
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

const APP_ROLES: UserRole[] = ['operator', 'qc', 'supervisor', 'engineering', 'admin'];
const SETTINGS_ROLES: UserRole[] = ['qc', 'supervisor', 'engineering', 'admin'];
const PART_MANAGER_ROLES: UserRole[] = ['engineering', 'admin'];
const USER_MANAGER_ROLES: UserRole[] = ['admin'];

const QUALITY_STATUS_ROLES: Record<RequestStatus, UserRole[]> = {
  not_requested: ['admin'],
  requested: ['engineering', 'admin'],
  in_progress: ['vendor', 'admin'],
  shipped: ['vendor', 'admin'],
  received: ['engineering', 'admin'],
};

const QUALITY_STATUS_TRANSITIONS: Partial<Record<RequestStatus, RequestStatus[]>> = {
  not_requested: ['requested'],
  requested: ['in_progress'],
  in_progress: ['shipped'],
  shipped: ['received'],
};

function requireAuth(request: FastifyRequest, reply: FastifyReply): SafeUser | null {
  if (!request.auth) {
    reply.code(401).send({ message: 'Unauthorized' });
    return null;
  }
  return request.auth;
}

function requireRole(request: FastifyRequest, reply: FastifyReply, roles: UserRole[]): SafeUser | null {
  const user = requireAuth(request, reply);
  if (!user) return null;
  if (!roles.includes(user.role)) {
    reply.code(403).send({ message: 'Forbidden' });
    return null;
  }
  return user;
}

function canTransitionQualityStatus(current: RequestStatus, next: RequestStatus) {
  return QUALITY_STATUS_TRANSITIONS[current]?.includes(next) ?? false;
}

function normalizePartInput(input: z.infer<typeof partInputSchema>): Omit<PartType, 'id'> {
  const dimensions: DimensionSpec[] = input.dimensions.map((dimension) => ({
    ...dimension,
    id: dimension.id?.trim() || randomUUID(),
  }));
  return { ...input, dimensions };
}

export async function registerRoutes(app: FastifyInstance, deps: RouteDeps) {
  const { store, ingestion, auth, agentRegistry } = deps;

  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));
  app.get('/api/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  app.post('/api/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const result = await auth.login(body.username, body.password);
    if (!result) return reply.code(401).send({ message: 'Invalid credentials' });
    return result;
  });

  app.get('/api/auth/me', async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;
    return user;
  });

  app.post('/api/auth/logout', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    return reply.code(204).send();
  });

  app.get('/api/dashboard/summary', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    return store.getDashboardSummary();
  });

  app.get('/api/inspections', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const query = inspectionQuerySchema.parse(request.query);
    return store.listInspections(query);
  });

  app.post('/api/inspections', async (request, reply) => {
    if (!requireRole(request, reply, APP_ROLES)) return;
    const event = inspectionCreatedSchema.parse(request.body);
    const saved = await ingestion.ingest(event);
    if (!saved) return reply.code(202).send({ duplicated: true });
    return reply.code(201).send(saved);
  });

  app.get('/api/stations', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    return store.listStations();
  });

  app.delete('/api/stations/:stationId', async (request, reply) => {
    if (!requireRole(request, reply, SETTINGS_ROLES)) return;
    const params = z.object({ stationId: z.string().min(1) }).parse(request.params);
    agentRegistry.send(params.stationId, { type: 'stop' });
    const station = await store.deactivateStation(params.stationId);
    if (!station) return reply.code(404).send({ message: 'Station tidak ditemukan' });
    const deactivated = await ingestion.ingest({
      eventId: `station-deactivated-${params.stationId}-${randomUUID()}`,
      eventType: 'station.status',
      stationId: params.stationId,
      timestamp: new Date().toISOString(),
      state: 'offline',
      running: false,
      phase: 'idle',
      isActive: false,
    });
    return deactivated ?? station;
  });

  app.get('/api/parts', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    return store.listParts();
  });

  app.post('/api/parts', async (request, reply) => {
    if (!requireRole(request, reply, PART_MANAGER_ROLES)) return;
    const body = partInputSchema.parse(request.body);
    try {
      const part = await store.createPart(normalizePartInput(body));
      return reply.code(201).send(part);
    } catch (error) {
      if (error instanceof Error) return reply.code(400).send({ message: error.message });
      return reply.code(400).send({ message: 'Part gagal dibuat' });
    }
  });

  app.patch('/api/parts/:id', async (request, reply) => {
    if (!requireRole(request, reply, PART_MANAGER_ROLES)) return;
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = partInputSchema.parse(request.body);
    try {
      const part = await store.updatePart(params.id, normalizePartInput(body));
      if (!part) return reply.code(404).send({ message: 'Part tidak ditemukan' });
      return part;
    } catch (error) {
      if (error instanceof Error) return reply.code(400).send({ message: error.message });
      return reply.code(400).send({ message: 'Part gagal diperbarui' });
    }
  });

  app.delete('/api/parts/:id', async (request, reply) => {
    if (!requireRole(request, reply, PART_MANAGER_ROLES)) return;
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    try {
      const deleted = await store.deletePart(params.id);
      if (!deleted) return reply.code(404).send({ message: 'Part tidak ditemukan' });
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof Error) return reply.code(400).send({ message: error.message });
      return reply.code(400).send({ message: 'Part gagal dihapus' });
    }
  });

  app.get('/api/users', async (request, reply) => {
    if (!requireRole(request, reply, USER_MANAGER_ROLES)) return;
    return store.listUsers();
  });

  app.post('/api/users', async (request, reply) => {
    if (!requireRole(request, reply, USER_MANAGER_ROLES)) return;
    const body = userCreateSchema.parse(request.body);
    try {
      const user = await store.createUser(body);
      return reply.code(201).send(user);
    } catch (error) {
      if (error instanceof Error) return reply.code(400).send({ message: error.message });
      return reply.code(400).send({ message: 'User gagal dibuat' });
    }
  });

  app.patch('/api/users/:id', async (request, reply) => {
    const authUser = requireRole(request, reply, USER_MANAGER_ROLES);
    if (!authUser) return;
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = userUpdateSchema.parse(request.body);
    const existing = await store.findUserById(params.id);
    if (!existing) return reply.code(404).send({ message: 'User tidak ditemukan' });
    if (authUser.id === params.id && body.role !== 'admin') {
      return reply.code(400).send({ message: 'Tidak boleh mencabut role admin dari diri sendiri' });
    }
    if (existing.role === 'admin' && body.role !== 'admin' && await store.countUsersByRole('admin') <= 1) {
      return reply.code(400).send({ message: 'Admin terakhir tidak boleh diubah rolenya' });
    }
    const password = body.password ? body.password : undefined;
    try {
      const user = await store.updateUser(params.id, { ...body, password });
      if (!user) return reply.code(404).send({ message: 'User tidak ditemukan' });
      return user;
    } catch (error) {
      if (error instanceof Error) return reply.code(400).send({ message: error.message });
      return reply.code(400).send({ message: 'User gagal diperbarui' });
    }
  });

  app.delete('/api/users/:id', async (request, reply) => {
    const authUser = requireRole(request, reply, USER_MANAGER_ROLES);
    if (!authUser) return;
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    if (authUser.id === params.id) return reply.code(400).send({ message: 'Tidak boleh menghapus user sendiri' });
    const existing = await store.findUserById(params.id);
    if (!existing) return reply.code(404).send({ message: 'User tidak ditemukan' });
    if (existing.role === 'admin' && await store.countUsersByRole('admin') <= 1) {
      return reply.code(400).send({ message: 'Admin terakhir tidak boleh dihapus' });
    }
    const deleted = await store.deleteUser(params.id);
    if (!deleted) return reply.code(404).send({ message: 'User tidak ditemukan' });
    return reply.code(204).send();
  });

  app.get('/api/shift-schedules', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    return store.listShiftSchedules();
  });

  app.patch('/api/shift-schedules/:id', async (request, reply) => {
    if (!requireRole(request, reply, SETTINGS_ROLES)) return;
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = shiftUpdateSchema.parse(request.body);
    const shift = await store.updateShiftSchedule(params.id, body);
    if (!shift) return reply.code(404).send({ message: 'Shift tidak ditemukan' });
    return shift;
  });

  app.get('/api/batches', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    return store.listBatches();
  });

  app.post('/api/batches', async (request, reply) => {
    if (!requireRole(request, reply, SETTINGS_ROLES)) return;
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
    if (!requireRole(request, reply, SETTINGS_ROLES)) return;
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const batch = await store.closeBatch(params.id);
    if (!batch) return reply.code(404).send({ message: 'Batch tidak ditemukan' });
    return batch;
  });

  app.get('/api/agents', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const activeStationIds = new Set((await store.listStations()).map((station) => station.stationId));
    return agentRegistry.list().filter((agent) => activeStationIds.has(agent.stationId));
  });

  app.post('/api/agents/:stationId/command', async (request, reply) => {
    const authUser = requireRole(request, reply, APP_ROLES);
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
      command.inspectionView = body.inspectionView ?? 'top';
      command.shift = body.shift;
      command.batchNo = body.batchNo;
    } else if (body.command === 'capture' && body.inspectionView) {
      command.inspectionView = body.inspectionView;
    }

    const delivered = agentRegistry.send(params.stationId, command);
    if (!delivered) return reply.code(404).send({ message: 'Agent offline' });
    return { stationId: params.stationId, command: body.command, delivered: true };
  });

  app.get('/api/quality-records', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    return store.listQualityRecords();
  });

  app.patch('/api/quality-records/:id/status', async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = statusUpdateSchema.parse(request.body);
    const allowedRoles = QUALITY_STATUS_ROLES[body.status];
    if (!allowedRoles.includes(user.role)) return reply.code(403).send({ message: 'Forbidden' });

    const currentRecord = (await store.listQualityRecords()).find((record) => record.id === params.id);
    if (!currentRecord) return reply.code(404).send({ message: 'Record not found' });
    if (!canTransitionQualityStatus(currentRecord.requestStatus, body.status)) {
      return reply.code(400).send({ message: 'Transisi status tidak valid' });
    }

    const record = await store.updateQualityRecordStatus(params.id, body.status, user.name);
    if (!record) return reply.code(404).send({ message: 'Record not found' });
    return record;
  });
}
