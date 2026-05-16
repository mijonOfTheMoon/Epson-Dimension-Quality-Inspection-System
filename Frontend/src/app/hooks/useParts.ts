import { useEffect, useState } from 'react';
import { partTypes, type PartType } from '../data/mock-data';
import { api } from '../services/api';

export function useParts() {
  const [parts, setParts] = useState<PartType[]>(partTypes);

  useEffect(() => {
    let active = true;
    api.getParts().then((data) => {
      if (active) setParts(data);
    });
    return () => {
      active = false;
    };
  }, []);

  return parts;
}
