import type { EventBus } from '../realtime/event-bus.js';
import type { IngestEvent, InspectionCreatedEvent } from '../domain/types.js';
import { ingestEventSchema } from '../domain/schemas.js';
import type { DataStore } from '../storage/store.js';

export class IngestionService {
  constructor(
    private readonly store: DataStore,
    private readonly eventBus: EventBus,
  ) {}

  async ingest(input: unknown) {
    const event = ingestEventSchema.parse(input) as IngestEvent;
    const events = event.eventType === 'inspection.created' ? splitInspectionObjects(event) : [event];
    let firstSaved: IngestEvent | null = null;
    for (const item of events) {
      const saved = await this.store.ingest(item);
      if (!saved) continue;
      firstSaved ??= saved;
      this.eventBus.publish(saved);
    }
    return firstSaved;
  }
}

function splitInspectionObjects(event: InspectionCreatedEvent): InspectionCreatedEvent[] {
  if (event.detections.length <= 1) return [event];
  return event.detections.map((detection) => ({
    ...event,
    eventId: `${event.eventId}-${detection.id}`,
    status: detection.status,
    confidenceScore: detection.confidenceScore,
    measurements: detection.measurements,
    detections: [detection],
  }));
}
