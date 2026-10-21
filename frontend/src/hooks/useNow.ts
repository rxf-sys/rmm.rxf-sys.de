import { useEffect, useState } from 'react';

/** The current time in epoch seconds, refreshed every `stepMs`. Reading the
 *  clock in render would make a component impure; this re-renders it on a
 *  schedule instead. */
export function useNow(stepMs = 60_000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), stepMs);
    return () => clearInterval(t);
  }, [stepMs]);
  return now;
}
