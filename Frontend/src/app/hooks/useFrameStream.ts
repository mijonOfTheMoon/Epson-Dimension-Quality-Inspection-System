import { useEffect, useRef, useState } from 'react';
import { subscribeFrames } from '../services/frame-stream';

export function useFrameStream() {
  const [frames, setFrames] = useState<Record<string, string>>({});
  const urlsRef = useRef<Record<string, string>>({});

  useEffect(() => {
    const unsubscribe = subscribeFrames((stationId, blob) => {
      const url = URL.createObjectURL(blob);
      const previous = urlsRef.current[stationId];
      urlsRef.current = { ...urlsRef.current, [stationId]: url };
      setFrames((current) => ({ ...current, [stationId]: url }));
      if (previous) URL.revokeObjectURL(previous);
    });

    return () => {
      unsubscribe();
      for (const url of Object.values(urlsRef.current)) URL.revokeObjectURL(url);
      urlsRef.current = {};
    };
  }, []);

  return frames;
}
