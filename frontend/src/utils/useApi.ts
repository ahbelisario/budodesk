import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from './errors';

/**
 * Carga datos de una función async y expone { data, loading, error, reload }.
 * Se vuelve a ejecutar cuando cambian `deps`.
 */
export function useApi<T>(fn: () => Promise<T>, deps: unknown[] = [], { enabled = true } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async (mode: 'load' | 'refresh' = 'load') => {
    const my = ++seq.current;
    if (mode === 'refresh') setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const d = await fnRef.current();
      if (my === seq.current) setData(d);
    } catch (e) {
      if (my === seq.current) setError(errorMessage(e));
    } finally {
      if (my === seq.current) { setLoading(false); setRefreshing(false); }
    }
  }, []);

  useEffect(() => { if (enabled) run('load'); }, [enabled, run, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, setData, loading, refreshing, error, reload: () => run('refresh') };
}
