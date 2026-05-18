import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { AsyncData, QualityTrackingRecord } from '../types/api';
import { api, getErrorMessage } from '../services/api';

export function useQualityRecords(): AsyncData<QualityTrackingRecord[]> & {
  setData: Dispatch<SetStateAction<QualityTrackingRecord[]>>;
} {
  const [data, setData] = useState<QualityTrackingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.getQualityRecords()
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

  return { data, setData, loading, error, reload };
}
