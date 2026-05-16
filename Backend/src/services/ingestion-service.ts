import type { EventBus } from '../realtime/event-bus.js';
import type { IngestEvent } from '../domain/types.js';
import { ingestEventSchema } from '../domain/schemas.js';
import type { DataStore } from '../storage/store.js';

export class IngestionService {
  constructor(
    private readonly store: DataStore,
    private readonly eventBus: EventBus,
  ) {}

  async ingest(input: unknown) {
    const event = ingestEventSchema.parse(input) as IngestEvent;
    const saved = await this.store.ingest(event);
    if (saved) this.eventBus.publish(saved);
    return saved;
  }
}
