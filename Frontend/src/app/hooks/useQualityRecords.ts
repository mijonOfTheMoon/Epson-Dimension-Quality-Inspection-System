import { useEffect, useState } from 'react';
import { qualityTrackingRecords, type QualityTrackingRecord } from '../data/mock-data';
import { api } from '../services/api';

export function useQualityRecords() {
  const [records, setRecords] = useState<QualityTrackingRecord[]>(() => JSON.parse(JSON.stringify(qualityTrackingRecords)));

  useEffect(() => {
    let active = true;
    api.getQualityRecords().then((data) => {
      if (active) setRecords(data);
    });
    return () => {
      active = false;
    };
  }, []);

  return [records, setRecords] as const;
}
