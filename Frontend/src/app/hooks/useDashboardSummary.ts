import { useCallback, useEffect, useState } from 'react';
import type { AsyncData, DashboardSummary } from '../types/api';
import { api, getErrorMessage } from '../services/api';
import { subscribeRealtime } from '../services/realtime';

const EMPTY: DashboardSummary = {
  total: 0, ok: 0, ng: 0, ngRate: 0, dailyTrend: [], stationCount: 0, activeStationCount: 0,
};

export function useDashboardSummary(): AsyncData<DashboardSummary> {
  const [data, setData] = useState<DashboardSummary>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.getDashboardSummary()
      .then((next) => { if (active) { setData(next); setError(null); } })
      .catch((err) => { if (active) setError(getErrorMessage(err)); })
      .finally(() => { if (active) setLoading(false); });

    // Refresh summary whenever a new inspection arrives via WebSocket
    const unsubscribe = subscribeRealtime((event) => {
      if (event.eventType === 'inspection.created' && active) {
        api.getDashboardSummary()
          .then((next) => { if (active) setData(next); })
          .catch(() => undefined);
      }
    });

    return () => { active = false; unsubscribe(); };
  }, [version]);

  return { data, loading, error, reload };
}
