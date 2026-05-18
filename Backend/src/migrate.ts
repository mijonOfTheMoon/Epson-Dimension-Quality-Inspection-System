import { config } from './config/env.js';
import { createStore } from './storage/index.js';

const store = createStore(config);

try {
  await store.init();
  console.log('Database migration completed');
} finally {
  await store.close?.();
}
