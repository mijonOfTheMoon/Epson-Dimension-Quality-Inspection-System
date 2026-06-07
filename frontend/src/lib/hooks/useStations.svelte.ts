import { onMount } from 'svelte';
import type { MqttClient } from 'mqtt';
import type { ObjectDetection, StationStatusEvent } from '$lib/types/api';
import { api, getErrorMessage } from '$lib/services/api';
import { deepEqual } from '$lib/services/polling';

let stationsCache: StationStatusEvent[] | null = null;

const PRESENCE_STALE_MS = 15000;

interface PresencePayload {
  stationId?: unknown;
  online?: unknown;
  running?: unknown;
  phase?: unknown;
  activePartCode?: unknown;
  fps?: unknown;
  updatedAt?: unknown;
  detections?: unknown;
}

function presenceToEvent(raw: PresencePayload): StationStatusEvent | null {
  if (typeof raw.stationId !== 'string') return null;
  const online = Boolean(raw.online);
  return {
    eventId: `mqtt-${raw.stationId}`,
    eventType: 'station.status',
    stationId: raw.stationId,
    timestamp: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    state: online ? 'online' : 'offline',
    fps: typeof raw.fps === 'number' ? raw.fps : undefined,
    running: Boolean(raw.running),
    phase: typeof raw.phase === 'string' ? (raw.phase as StationStatusEvent['phase']) : undefined,
    activePartCode: typeof raw.activePartCode === 'string' ? raw.activePartCode : undefined,
    isActive: true,
    detections: Array.isArray(raw.detections) ? (raw.detections as ObjectDetection[]) : [],
  };
}

export function useStations() {
  let data = $state<StationStatusEvent[]>(stationsCache ?? []);
  let loading = $state(stationsCache === null);
  let error = $state<string | null>(null);
  let mounted = false;
  let mqttClient: MqttClient | null = null;
  let stalenessTimer: ReturnType<typeof setInterval> | null = null;
  const presenceMap = new Map<string, StationStatusEvent>();

  const commit = (next: StationStatusEvent[]) => {
    if (!deepEqual(data, next)) data = next;
    stationsCache = next;
  };

  const rebuildFromPresence = () => {
    if (!mounted) return;
    const now = Date.now();
    const list: StationStatusEvent[] = [];
    for (const event of presenceMap.values()) {
      const ts = Date.parse(event.timestamp);
      const stale = Number.isFinite(ts) && now - ts > PRESENCE_STALE_MS;
      if (stale) {
        list.push({ ...event, state: 'offline', running: false, phase: 'idle', detections: [] });
      } else {
        list.push(event);
      }
    }
    list.sort((a, b) => a.stationId.localeCompare(b.stationId));
    commit(list);
  };

  const start = async () => {
    const info = await api.getRealtimeMqtt();
    if (!mounted) return;
    if (!info) {
      error = 'Realtime MQTT belum dikonfigurasi';
      loading = false;
      return;
    }
    try {
      const mqtt = (await import('mqtt')).default;
      if (!mounted) return;
      const client = mqtt.connect(info.url, {
        username: info.username,
        password: info.password,
        reconnectPeriod: 3000,
        connectTimeout: 8000,
        clean: true,
      });
      client.on('connect', () => {
        client.subscribe(info.presenceTopic, { qos: 1 });
        if (mounted) {
          loading = false;
          error = null;
        }
      });
      client.on('message', (topic, payload) => {
        if (!mounted) return;
        if (payload.length === 0) {
          const parts = topic.split('/');
          const stationId = parts[parts.length - 2];
          if (stationId && presenceMap.delete(stationId)) {
            rebuildFromPresence();
          }
          return;
        }
        try {
          const parsed = JSON.parse(payload.toString()) as PresencePayload;
          const event = presenceToEvent(parsed);
          if (!event) return;
          presenceMap.set(event.stationId, event);
          error = null;
          rebuildFromPresence();
        } catch { /* ignore malformed payload */ }
      });
      client.on('error', (err) => {
        if (mounted) {
          loading = false;
          error = err?.message ?? 'Koneksi realtime gagal';
        }
      });
      mqttClient = client;
      stalenessTimer = setInterval(rebuildFromPresence, 1000);
    } catch (err) {
      if (mounted) {
        loading = false;
        error = getErrorMessage(err);
      }
    }
  };

  onMount(() => {
    mounted = true;
    void start();
    return () => {
      mounted = false;
      if (stalenessTimer) { clearInterval(stalenessTimer); stalenessTimer = null; }
      if (mqttClient) { try { mqttClient.end(true); } catch { /* ignore */ } mqttClient = null; }
    };
  });

  return {
    get data() { return data; },
    get loading() { return loading; },
    get error() { return error; },
  };
}
