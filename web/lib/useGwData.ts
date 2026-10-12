import { useCallback, useEffect, useState } from "react";
import { errorText, gwFetch } from "./api";

export interface GwData<T> {
  data: T | null;
  error: string | null;
  reload: () => void;
}

/** Loads one admin API path and reloads it on demand; a stale response never overwrites a newer one. */
export function useGwData<T>(path: string): GwData<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let current = true;
    gwFetch<T>(path).then(
      (result) => {
        if (!current) return;
        setData(result);
        setError(null);
      },
      (failure) => current && setError(errorText(failure))
    );
    return () => {
      current = false;
    };
  }, [path, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { data, error, reload };
}
