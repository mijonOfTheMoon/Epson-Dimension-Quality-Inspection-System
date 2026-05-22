import type { QualityTrackingRecord } from '$lib/types/api';
import { api, getErrorMessage } from '$lib/services/api';

export function useQualityRecords() {
  let data = $state<QualityTrackingRecord[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let version = $state(0);

  $effect(() => {
    void version;
    let active = true;
    loading = true;
    api.getQualityRecords()
      .then((next) => { if (active) { data = next; error = null; } })
      .catch((err) => { if (active) error = getErrorMessage(err); })
      .finally(() => { if (active) loading = false; });
    return () => { active = false; };
  });

  return {
    get data() { return data; },
    get loading() { return loading; },
    get error() { return error; },
    reload() { version += 1; },
    replace(next: QualityTrackingRecord[]) { data = next; },
    update(record: QualityTrackingRecord) {
      data = data.map((item) => item.id === record.id ? record : item);
    },
  };
}
