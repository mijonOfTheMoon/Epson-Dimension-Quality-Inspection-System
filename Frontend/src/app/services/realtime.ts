const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
const apiUrl = env?.VITE_API_URL ?? 'http://localhost:4000';
const defaultWsUrl = apiUrl.replace(/^http/, 'ws') + '/ws';
const WS_URL = env?.VITE_WS_URL ?? defaultWsUrl;

export interface RealtimeEvent {
  eventId: string;
  eventType: string;
  [key: string]: any;
}

export function subscribeRealtime(onEvent: (event: RealtimeEvent) => void) {
  if (typeof WebSocket === 'undefined') return () => undefined;

  let closed = false;
  let socket: WebSocket | null = null;
  let retryMs = 1000;
  let timer: number | undefined;

  const connect = () => {
    socket = new WebSocket(WS_URL);
    socket.onopen = () => {
      retryMs = 1000;
    };
    socket.onmessage = (message) => {
      try {
        const payload = JSON.parse(message.data);
        if (payload.type === 'snapshot' && Array.isArray(payload.events)) payload.events.forEach(onEvent);
        if (payload.type === 'event' && payload.event) onEvent(payload.event);
      } catch {}
    };
    socket.onclose = () => {
      if (closed) return;
      timer = window.setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 15000);
    };
  };

  connect();

  return () => {
    closed = true;
    if (timer) window.clearTimeout(timer);
    socket?.close();
  };
}
