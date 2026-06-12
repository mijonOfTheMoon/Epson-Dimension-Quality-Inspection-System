import { onMount } from 'svelte';
import type { MqttClient } from 'mqtt';
import type { InspectionCreatedEvent, InspectionResult } from '$lib/types/api';
import { api, getErrorMessage, normalizeInspectionEvent } from '$lib/services/api';
import { createPollingBackoff } from '$lib/services/backoff';
import { startVisibilityPolling, deepEqual } from '$lib/services/polling';

const inspectionsCache = new Map<string, InspectionResult[]>();

export function useInspections(limit = 200, visibleMs = 3000, hiddenMs = 15000, includeDetections = false, realtime = false) {
  const cacheKey = `${limit}|${includeDetections}`;
  let data = $state<InspectionResult[]>(inspectionsCache.get(cacheKey) ?? []);
  let loading = $state(!inspectionsCache.has(cacheKey));
  let error = $state<string | null>(null);
  let mounted = false;
  let requestId = 0;
  let inFlight = false;
  const backoff = createPollingBackoff();

  const load = async (showLoading = true) => {
    if (!mounted) return;
    if (inFlight) return;
    if (!showLoading && !backoff.canRequest()) return;
    inFlight = true;
    const current = ++requestId;
    if (showLoading && !inspectionsCache.has(cacheKey)) loading = true;
    try {
      const next = await api.getInspections({ limit, includeDetections });
      if (!mounted || current !== requestId) return;
      if (!deepEqual(data, next)) data = next;
      inspectionsCache.set(cacheKey, next);
      error = null;
      backoff.reset();
    } catch (err) {
      backoff.recordFailure(err);
      if (mounted && current === requestId && showLoading) error = getErrorMessage(err);
    } finally {
      inFlight = false;
      if (mounted && current === requestId && (showLoading || loading)) loading = false;
    }
  };

  const refresh = () => load(false);

  const prependEvent = (event: InspectionCreatedEvent) => {
    const incoming = normalizeInspectionEvent(event);
    const filtered = data.filter((item) => item.id !== incoming.id);
    const next = [incoming, ...filtered].slice(0, limit);
    data = next;
    inspectionsCache.set(cacheKey, next);
  };

  const startRealtime = async (): Promise<MqttClient | null> => {
    const info = await api.getRealtimeMqtt();
    if (!mounted || !info) return null;
    try {
      const mqtt = (await import('mqtt')).default;
      if (!mounted) return null;
      const client = mqtt.connect(info.url, {
        username: info.username,
        password: info.password,
        reconnectPeriod: 3000,
        connectTimeout: 8000,
        clean: true,
      });
      client.on('connect', () => client.subscribe(info.inspectionTopic, { qos: 1 }));
      client.on('message', (_topic, payload) => {
        if (!mounted || payload.length === 0) return;
        try {
          const event = JSON.parse(payload.toString()) as InspectionCreatedEvent;
          prependEvent(event);
        } catch { /* ignore malformed payload */ }
      });
      return client;
    } catch {
      return null;
    }
  };

  onMount(() => {
    mounted = true;
    void load();
    const stopPolling = startVisibilityPolling(refresh, visibleMs, hiddenMs);
    let mqttClient: MqttClient | null = null;
    if (realtime) {
      void startRealtime().then((client) => {
        if (!mounted) { try { client?.end(true); } catch { /* ignore */ } return; }
        mqttClient = client;
      });
    }

    return () => {
      mounted = false;
      requestId += 1;
      stopPolling();
      if (mqttClient) { try { mqttClient.end(true); } catch { /* ignore */ } mqttClient = null; }
    };
  });

  return {
    get data() { return data; },
    get loading() { return loading; },
    get error() { return error; },
    reload() { void load(); },
  };
}
