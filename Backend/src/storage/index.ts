import type { AppConfig } from '../config/env.js';
import { JsonStore } from './json-store.js';
import { MemoryStore } from './memory-store.js';
import { PostgresStore } from './postgres-store.js';
import type { DataStore } from './store.js';

export function createStore(config: AppConfig): DataStore {
  if (config.STORAGE_DRIVER === 'memory') return new MemoryStore();
  if (config.STORAGE_DRIVER === 'postgres') return new PostgresStore(config);
  return new JsonStore(config.DATA_FILE);
}
