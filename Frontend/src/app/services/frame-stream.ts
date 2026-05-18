import { resolveWsUrl } from './api';

export type FrameListener = (stationId: string, frame: Blob) => void;

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
const FRAME_WS_URL = resolveWsUrl(env?.VITE_FRAME_WS_URL, '/ws/frames');

class FrameStreamClient {
  private socket: WebSocket | null = null;
  private readonly listeners = new Set<FrameListener>();
  private retryMs = 1000;
  private connecting = false;

  subscribe(listener: FrameListener) {
    this.listeners.add(listener);
    this.ensureConnection();
    return () => {
      this.listeners.delete(listener);
    };
  }

  private ensureConnection() {
    if (typeof WebSocket === 'undefined') return;
    if (this.socket || this.connecting) return;
    this.connect();
  }

  private connect() {
    this.connecting = true;
    const socket = new WebSocket(FRAME_WS_URL);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    socket.onopen = () => {
      this.retryMs = 1000;
      this.connecting = false;
    };
    socket.onmessage = (message) => {
      if (!(message.data instanceof ArrayBuffer)) return;
      this.handlePacket(message.data);
    };
    socket.onclose = () => {
      this.socket = null;
      this.connecting = false;
      if (this.listeners.size === 0) return;
      window.setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 15000);
    };
    socket.onerror = () => {
      try { socket.close(); } catch { /* ignore */ }
    };
  }

  private handlePacket(buffer: ArrayBuffer) {
    if (buffer.byteLength < 2) return;
    const view = new DataView(buffer);
    const idLength = view.getUint16(0, false);
    if (buffer.byteLength < 2 + idLength) return;
    const idBytes = new Uint8Array(buffer, 2, idLength);
    const stationId = new TextDecoder('utf-8').decode(idBytes);
    const frameBytes = buffer.slice(2 + idLength);
    const blob = new Blob([frameBytes], { type: 'image/jpeg' });
    for (const listener of this.listeners) listener(stationId, blob);
  }
}

const frameStreamClient = new FrameStreamClient();

export function subscribeFrames(listener: FrameListener) {
  return frameStreamClient.subscribe(listener);
}
