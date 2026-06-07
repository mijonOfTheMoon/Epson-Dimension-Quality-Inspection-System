import { onMount } from 'svelte';
import type { QualityTrackingRecord } from '$lib/types/api';
import { api, getErrorMessage } from '$lib/services/api';

let qualityCache: QualityTrackingRecord[] | null = null;

export function useQualityRecords() {
  let data = $state<QualityTrackingRecord[]>(qualityCache ?? []);
  let loading = $state(qualityCache === null);
  let error = $state<string | null>(null);
  let mounted = false;
  let requestId = 0;

  const load = async () => {
    if (!mounted) return;
    const current = ++requestId;
    if (qualityCache === null) loading = true;
    try {
      const next = await api.getQualityRecords();
      if (mounted && current === requestId) {
        data = next;
        qualityCache = next;
        error = null;
      }
    } catch (err) {
      if (mounted && current === requestId) error = getErrorMessage(err);
    } finally {
      if (mounted && current === requestId) loading = false;
    }
  };

  onMount(() => {
    mounted = true;
    void load();
    return () => {
      mounted = false;
      requestId += 1;
    };
  });

  return {
    get data() { return data; },
    get loading() { return loading; },
    get error() { return error; },
    reload() { void load(); },
    update(record: QualityTrackingRecord) {
      data = data.map((item) => item.id === record.id ? record : item);
      qualityCache = data;
    },
  };
}
