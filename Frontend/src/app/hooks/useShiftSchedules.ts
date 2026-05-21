import { useCallback, useEffect, useState } from 'react';
import type { AsyncData, ShiftSchedule } from '../types/api';
import { api, getErrorMessage } from '../services/api';

export function useShiftSchedules(): AsyncData<ShiftSchedule[]> {
  const [data, setData] = useState<ShiftSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.getShiftSchedules()
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
    return () => { active = false; };
  }, [version]);

  return { data, loading, error, reload };
}
