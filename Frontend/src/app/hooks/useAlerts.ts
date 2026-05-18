import { useCallback, useEffect, useState } from 'react';
import type { AsyncData, QualityAlertEvent } from '../types/api';
import { api, getErrorMessage } from '../services/api';
import { subscribeRealtime } from '../services/realtime';

export function useAlerts(limit = 50): AsyncData<QualityAlertEvent[]> {
  const [data, setData] = useState<QualityAlertEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.getAlerts(limit)
      .then((next) => {
        if (!active) return;
        setData(next);
        setError(null);
      })
      .catch((err) => {
        if (active) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const unsubscribe = subscribeRealtime((event) => {
      if (event.eventType !== 'quality.alert') return;
      setData((current) => {
        if (current.some((item) => item.eventId === event.eventId)) return current;
        return [event, ...current].slice(0, limit);
      });
      setError(null);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [limit, version]);

  return { data, loading, error, reload };
}
