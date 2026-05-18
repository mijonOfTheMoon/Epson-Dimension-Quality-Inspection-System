import { config } from './config/env.js';
import { createStore } from './storage/index.js';

if (config.STORAGE_DRIVER !== 'postgres') {
  console.log('Database migration skipped because STORAGE_DRIVER is not postgres');
  process.exit(0);
}

const store = createStore(config);

try {
  await store.init();
  console.log('Database migration completed');
} finally {
  await store.close?.();
}
