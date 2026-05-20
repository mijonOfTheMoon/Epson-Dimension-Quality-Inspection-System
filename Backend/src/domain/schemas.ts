import { z } from 'zod';

const statusSchema = z.enum(['OK', 'NG']);

export const measurementSchema = z.object({
  dimensionName: z.string().min(1),
  measured: z.number().finite(),
  nominal: z.number().finite(),
  upperLimit: z.number().finite(),
  lowerLimit: z.number().finite(),
  unit: z.string().min(1),
  status: statusSchema,
});

export const inspectionCreatedSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.literal('inspection.created'),
  stationId: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
  partId: z.string().optional(),
  partName: z.string().min(1),
  partCode: z.string().min(1),
  batchNo: z.string().optional(),
  vendor: z.string().optional(),
  operatorId: z.string().optional(),
  operatorName: z.string().optional(),
  status: statusSchema,
  shift: z.enum(['A', 'B', 'C']).optional(),
  line: z.string().optional(),
  confidenceScore: z.number().min(0).max(100),
  measurements: z.array(measurementSchema),
  modelVersion: z.string().optional(),
  trigger: z.enum(['auto', 'manual']).optional(),
});

export const stationStatusSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.literal('station.status'),
  stationId: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
  state: z.enum(['online', 'offline']),
  fps: z.number().nonnegative().optional(),
  running: z.boolean().optional(),
  phase: z.enum(['idle', 'calibrating', 'ready', 'stabilizing', 'locked']).optional(),
  activePartCode: z.string().optional(),
  modelVersion: z.string().optional(),
});

export const ingestEventSchema = z.discriminatedUnion('eventType', [
  inspectionCreatedSchema,
  stationStatusSchema,
]);

export const statusUpdateSchema = z.object({
  status: z.enum(['not_requested', 'requested', 'in_progress', 'shipped', 'received']),
  changedBy: z.string().min(1),
});

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
