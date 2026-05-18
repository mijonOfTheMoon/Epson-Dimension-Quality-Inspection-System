import type { RealtimeEvent } from '../types/api';
import { API_BASE_URL } from './api';

type RealtimeListener = (event: RealtimeEvent) => void;

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
const defaultWsUrl = API_BASE_URL.replace(/^http/, 'ws') + '/ws';
const WS_URL = env?.VITE_WS_URL ?? defaultWsUrl;

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
    };
  }

  private ensureConnection() {
    if (typeof WebSocket === 'undefined') return;
    if (this.socket || this.connecting) return;
    this.closed = false;
    this.connect();
  }

  private connect() {
    this.connecting = true;
    const socket = new WebSocket(WS_URL);
    this.socket = socket;

    socket.onopen = () => {
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
      this.socket = null;
      this.connecting = false;
      if (this.closed || this.listeners.size === 0) return;
      this.timer = window.setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 15000);
    };
    socket.onerror = () => {
      try { socket.close(); } catch { /* ignore */ }
    };
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
