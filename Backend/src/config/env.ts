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
  DATABASE_URL: z.string().optional(),
  DATABASE_SSL: booleanSchema.default(false),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  JWT_SECRET: z.string().min(16).default('change-me-in-production-please-use-long-secret'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
  AGENT_TOKEN: z.string().min(8).default('change-me-agent-shared-token'),
  EVENT_REPLAY_LIMIT: z.coerce.number().int().positive().default(100),
});

export const config = envSchema.parse(process.env);
export type AppConfig = typeof config;
