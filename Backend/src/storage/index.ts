import type { AppConfig } from '../config/env.js';
import { PostgresStore } from './postgres-store.js';
import type { DataStore } from './store.js';

export function createStore(config: AppConfig): DataStore {
  return new PostgresStore(config);
}
