import { useEffect, useState } from 'react';
import { inspectionResults, type InspectionResult } from '../data/mock-data';
import { api, normalizeInspectionEvent } from '../services/api';
import { subscribeRealtime } from '../services/realtime';

export function useInspections(limit = 1000) {
  const [inspections, setInspections] = useState<InspectionResult[]>(inspectionResults);

  useEffect(() => {
    let active = true;

    api.getInspections({ limit }).then((data) => {
      if (active) setInspections(data);
    });

    const unsubscribe = subscribeRealtime((event) => {
      if (event.eventType !== 'inspection.created') return;
      const next = normalizeInspectionEvent(event);
      setInspections((current) => {
        if (current.some((item) => item.id === next.id)) return current;
        return [next, ...current].slice(0, limit);
      });
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [limit]);

  return inspections;
}
