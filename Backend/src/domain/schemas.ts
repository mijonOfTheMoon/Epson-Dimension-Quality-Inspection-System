import { z } from 'zod';

const statusSchema = z.enum(['OK', 'NG']);
export const measurementStatusSchema = z.enum(['OK', 'NG', 'UNREADABLE']);
export const dimensionKindSchema = z.enum(['width', 'length', 'diameter', 'outer_diameter', 'inner_diameter', 'hole_diameter']);
export const dimensionViewSchema = z.enum(['top', 'side']);

export const dimensionSpecSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  kind: dimensionKindSchema,
  view: dimensionViewSchema.default('top'),
  nominal: z.coerce.number().finite(),
  upperLimit: z.coerce.number().finite(),
  lowerLimit: z.coerce.number().finite(),
  unit: z.string().min(1).default('mm'),
}).refine((value) => value.lowerLimit <= value.nominal && value.nominal <= value.upperLimit, {
  message: 'nominal harus berada di antara lowerLimit dan upperLimit',
  path: ['nominal'],
});

export const measurementSchema = z.object({
  dimensionName: z.string().min(1),
  measured: z.number().finite(),
  nominal: z.number().finite(),
  upperLimit: z.number().finite(),
  lowerLimit: z.number().finite(),
  unit: z.string().min(1),
  status: measurementStatusSchema,
});

export const boundingBoxSchema = z.object({
  x: z.number().finite().nonnegative(),
  y: z.number().finite().nonnegative(),
  width: z.number().finite().positive().max(100),
  height: z.number().finite().positive().max(100),
});

export const objectDetectionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  bbox: boundingBoxSchema,
  status: statusSchema,
  confidenceScore: z.number().min(0).max(100),
  measurements: z.array(measurementSchema),
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
  confidenceScore: z.number().min(0).max(100),
  measurements: z.array(measurementSchema),
  detections: z.array(objectDetectionSchema).default([]),
  trigger: z.literal('manual').optional(),
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
  isActive: z.boolean().optional(),
});

export const ingestEventSchema = z.discriminatedUnion('eventType', [
  inspectionCreatedSchema,
  stationStatusSchema,
]);

export const statusUpdateSchema = z.object({
  status: z.enum(['not_requested', 'requested', 'in_progress', 'shipped', 'received']),
});

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
