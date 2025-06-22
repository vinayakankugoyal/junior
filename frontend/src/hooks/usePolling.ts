import { useEffect, useRef } from 'react';

interface UsePollingOptions {
  interval: number;
  enabled?: boolean;
}

export function usePolling(callback: () => void, { interval, enabled = true }: UsePollingOptions) {
  const savedCallback = useRef<() => void>(() => {});

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;

    const tick = () => {
      if (savedCallback.current) {
        savedCallback.current();
      }
    };

    const id = setInterval(tick, interval);
    return () => clearInterval(id);
  }, [interval, enabled]);
}