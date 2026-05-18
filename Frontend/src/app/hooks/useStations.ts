import { useCallback, useEffect, useState } from 'react';
import type { AsyncData, StationStatusEvent } from '../types/api';
import { api, getErrorMessage } from '../services/api';
import { subscribeRealtime } from '../services/realtime';

export function useStations(): AsyncData<StationStatusEvent[]> {
  const [data, setData] = useState<StationStatusEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.getStations()
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
      if (event.eventType !== 'station.status') return;
      setData((current) => {
        const withoutCurrent = current.filter((item) => item.stationId !== event.stationId);
        return [event, ...withoutCurrent].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      });
      setError(null);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [version]);

  return { data, loading, error, reload };
}
