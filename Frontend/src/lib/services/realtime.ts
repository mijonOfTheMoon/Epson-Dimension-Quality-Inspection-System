import type { RealtimeEvent } from '$lib/types/api';
import { appendAuthToken } from './api';
import { wsUrl } from './ws-url';

type RealtimeListener = (event: RealtimeEvent) => void;

const WS_URL = wsUrl('/ws');
const SNAPSHOT_BUFFER = 200;

class RealtimeClient {
  private socket: WebSocket | null = null;
  private readonly listeners = new Set<RealtimeListener>();
  private readonly snapshot: RealtimeEvent[] = [];
  private retryMs = 1000;
  private timer: number | undefined;
  private closed = false;
  private connecting = false;

  subscribe(listener: RealtimeListener): () => void {
    this.listeners.add(listener);
    for (const event of this.snapshot) listener(event);
    this.ensureConnection();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.disconnect();
    };
  }

  private ensureConnection() {
    if (typeof WebSocket === 'undefined') return;
    this.closed = false;
    if (this.timer !== undefined) {
      window.clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.socket || this.connecting) return;
    this.connect();
  }

  private connect() {
    if (this.closed || this.listeners.size === 0) return;
    this.connecting = true;
    const socket = new WebSocket(appendAuthToken(WS_URL));
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) {
        try { socket.close(); } catch { /* ignore */ }
        return;
      }
      this.retryMs = 1000;
      this.connecting = false;
    };
    socket.onmessage = (message) => {
      try {
        const payload = JSON.parse(message.data);
        if (payload.type === 'snapshot' && Array.isArray(payload.events)) {
          for (const event of payload.events as RealtimeEvent[]) this.dispatch(event);
        } else if (payload.type === 'event' && payload.event) {
          this.dispatch(payload.event as RealtimeEvent);
        }
      } catch { /* ignore */ }
    };
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      this.connecting = false;
      if (this.closed || this.listeners.size === 0) return;
      this.timer = window.setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 15000);
    };
    socket.onerror = () => {
      try { socket.close(); } catch { /* ignore */ }
    };
  }

  private disconnect() {
    this.closed = true;
    this.connecting = false;
    if (this.timer !== undefined) {
      window.clearTimeout(this.timer);
      this.timer = undefined;
    }
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try { socket.close(); } catch { /* ignore */ }
    }
  }

  private dispatch(event: RealtimeEvent) {
    this.snapshot.push(event);
    if (this.snapshot.length > SNAPSHOT_BUFFER) this.snapshot.shift();
    for (const listener of this.listeners) listener(event);
  }
}

const realtimeClient = new RealtimeClient();

export function subscribeRealtime(listener: RealtimeListener) {
  return realtimeClient.subscribe(listener);
}
