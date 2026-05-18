import { useCallback, useEffect, useState } from 'react';
import type { AgentInfo, AsyncData } from '../types/api';
import { api, getErrorMessage } from '../services/api';
import { subscribeRealtime } from '../services/realtime';

export function useAgents(): AsyncData<AgentInfo[]> & { refresh: () => Promise<void> } {
  const [data, setData] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((current) => current + 1), []);

  const refresh = useCallback(async () => {
    try {
      const next = await api.getAgents();
      setData(next);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.getAgents()
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
    let throttled = false;
    const unsubscribe = subscribeRealtime((event) => {
      if (event.eventType !== 'station.status') return;
      if (throttled) return;
      throttled = true;
      window.setTimeout(() => {
        throttled = false;
        void refresh();
      }, 500);
    });
    return unsubscribe;
  }, [refresh]);

  return { data, loading, error, reload, refresh };
}
