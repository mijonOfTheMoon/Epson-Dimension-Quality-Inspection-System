import { useCallback, useEffect, useRef, useState } from 'react';
import type { AsyncData, Batch } from '../types/api';
import { api, getErrorMessage } from '../services/api';
import { subscribeRealtime } from '../services/realtime';

export function useBatches(): AsyncData<Batch[]> {
  const [data, setData] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const refreshTimer = useRef<number | undefined>(undefined);
  const reload = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.getBatches()
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

    return () => {
      active = false;
    };
  }, [version]);

  useEffect(() => {
    const scheduleReload = () => {
      if (refreshTimer.current !== undefined) return;
      refreshTimer.current = window.setTimeout(() => {
        refreshTimer.current = undefined;
        reload();
      }, 250);
    };

    const unsubscribe = subscribeRealtime((event) => {
      if (event.eventType === 'inspection.created') scheduleReload();
    });
    return () => {
      unsubscribe();
      if (refreshTimer.current !== undefined) {
        window.clearTimeout(refreshTimer.current);
        refreshTimer.current = undefined;
      }
    };
  }, [reload]);

  return { data, loading, error, reload };
}
