import { EventEmitter } from 'node:events';
import type { IngestEvent } from '../domain/types.js';

export class EventBus {
  private readonly emitter = new EventEmitter();
  private readonly events: IngestEvent[] = [];

  constructor(private readonly limit: number) {}

  publish(event: IngestEvent) {
    this.events.push(event);
    if (this.events.length > this.limit) this.events.splice(0, this.events.length - this.limit);
    this.emitter.emit('event', event);
  }

  subscribe(listener: (event: IngestEvent) => void) {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  latest(limit = this.limit) {
    return this.events.slice(-limit);
  }
}
