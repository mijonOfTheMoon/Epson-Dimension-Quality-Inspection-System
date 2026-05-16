import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { StoreState } from '../domain/types.js';
import { MemoryStore } from './memory-store.js';
import { seedState } from './seed.js';

export class JsonStore extends MemoryStore {
  private readonly filePath: string;
  private writeQueue = Promise.resolve();

  constructor(filePath: string) {
    super();
    this.filePath = resolve(filePath);
  }

  async init() {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      this.loadState({ ...structuredClone(seedState), ...JSON.parse(raw) } as StoreState);
    } catch {
      this.loadState(structuredClone(seedState));
      await this.persist();
    }
  }

  protected async persist() {
    const state = await this.snapshot();
    const payload = JSON.stringify(state);
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, payload, 'utf8');
    });
    await this.writeQueue;
  }
}
