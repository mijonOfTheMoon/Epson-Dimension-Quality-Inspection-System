import { appendAuthToken } from './api';
import { wsUrl } from './ws-url';

export type FrameListener = (stationId: string, frame: Blob) => void;

const FRAME_WS_URL = wsUrl('/ws/frames');

class FrameStreamClient {
  private readonly sockets = new Map<string, WebSocket>();
  private readonly listeners = new Map<string, Set<FrameListener>>();
  private readonly retryMs = new Map<string, number>();
  private readonly connecting = new Set<string>();
  private readonly timers = new Map<string, number>();

  subscribe(stationId: string, listener: FrameListener) {
    const listeners = this.listeners.get(stationId) ?? new Set<FrameListener>();
    listeners.add(listener);
    this.listeners.set(stationId, listeners);
    this.ensureConnection(stationId);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listeners.delete(stationId);
        this.clearRetry(stationId);
        const socket = this.sockets.get(stationId);
        this.sockets.delete(stationId);
        this.connecting.delete(stationId);
        socket?.close();
      }
    };
  }

  private ensureConnection(stationId: string) {
    if (typeof WebSocket === 'undefined') return;
    if (this.sockets.has(stationId) || this.connecting.has(stationId)) return;
    this.connect(stationId);
  }

  private connect(stationId: string) {
    if (!this.listeners.has(stationId)) return;
    this.connecting.add(stationId);
    const url = appendAuthToken(`${FRAME_WS_URL}${FRAME_WS_URL.includes('?') ? '&' : '?'}stationId=${encodeURIComponent(stationId)}`);
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    this.sockets.set(stationId, socket);

    socket.onopen = () => {
      if (this.sockets.get(stationId) !== socket) {
        try { socket.close(); } catch { /* ignore */ }
        return;
      }
      this.retryMs.set(stationId, 1000);
      this.connecting.delete(stationId);
    };
    socket.onmessage = (message) => {
      if (!(message.data instanceof ArrayBuffer)) return;
      this.handlePacket(message.data);
    };
    socket.onclose = () => {
      if (this.sockets.get(stationId) === socket) this.sockets.delete(stationId);
      this.connecting.delete(stationId);
      if (!this.listeners.has(stationId)) return;
      const retryMs = this.retryMs.get(stationId) ?? 1000;
      const timer = window.setTimeout(() => {
        this.timers.delete(stationId);
        this.connect(stationId);
      }, retryMs);
      this.timers.set(stationId, timer);
      this.retryMs.set(stationId, Math.min(retryMs * 2, 15000));
    };
    socket.onerror = () => {
      try { socket.close(); } catch { /* ignore */ }
    };
  }

  private clearRetry(stationId: string) {
    const timer = this.timers.get(stationId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.timers.delete(stationId);
    }
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
    const listeners = this.listeners.get(stationId);
    if (!listeners) return;
    for (const listener of listeners) listener(stationId, blob);
  }
}

const frameStreamClient = new FrameStreamClient();

export function subscribeFrames(stationId: string, listener: FrameListener) {
  return frameStreamClient.subscribe(stationId, listener);
}
