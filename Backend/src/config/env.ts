import 'dotenv/config';
import { z } from 'zod';

const booleanSchema = z.union([z.boolean(), z.string()]).transform((value: boolean | string) => {
  if (typeof value === 'boolean') return value;
  return value.toLowerCase() === 'true' || value === '1';
});

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGIN: z.string().default('*'),
  STORAGE_DRIVER: z.enum(['memory', 'json', 'postgres']).default('postgres'),
  DATA_FILE: z.string().default('./data/diminspect.json'),
  DATABASE_URL: z.string().optional(),
  DATABASE_SSL: booleanSchema.default(false),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  MQTT_ENABLED: booleanSchema.default(false),
  MQTT_URL: z.string().default('mqtt://localhost:1883'),
  MQTT_USERNAME: z.string().optional(),
  MQTT_PASSWORD: z.string().optional(),
  MQTT_CLIENT_ID: z.string().default('diminspect-backend'),
  MQTT_TOPIC_PREFIX: z.string().default('diminspect'),
  MQTT_QOS: z.coerce.number().int().min(0).max(2).default(1),
  EVENT_REPLAY_LIMIT: z.coerce.number().int().positive().default(100),
});

export const config = envSchema.parse(process.env);
export type AppConfig = typeof config;
