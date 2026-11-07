import { useEffect, useState } from 'react';
import { useParentPortal } from '../context/ParentContext';

export interface FamilyItem<T> { data: T | null; error: boolean }

// Fetches a resource for every child at once (in parallel, not one after the
// other), for the "All children" view. One child failing doesn't hide the others.
export function useFamilyResource<T>(fetcher: (studentId: string, guardianId?: string) => Promise<T>) {
  const { children, guardianId } = useParentPortal();
  const [items, setItems] = useState<Record<string, FamilyItem<T>>>({});
  const [loading, setLoading] = useState(true);
  const key = children.map((c) => c._id).join(',');

  useEffect(() => {
    let cancelled = false;
    const ids = key ? key.split(',') : [];
    setLoading(true);
    Promise.allSettled(ids.map((id) => fetcher(id, guardianId))).then((results) => {
      if (cancelled) return;
      setItems(Object.fromEntries(results.map((r, i) => [ids[i], r.status === 'fulfilled' ? { data: r.value, error: false } : { data: null, error: true }])));
      setLoading(false);
    });
    return () => { cancelled = true; };
    // fetcher passed inline; refetch keyed on the family only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, guardianId]);

  return { items, loading };
}

// The family summary (GET /family), loaded once per family.
export function useFamilySummary<T>(fetcher: (guardianId?: string) => Promise<T>) {
  const { guardianId, children } = useParentPortal();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const count = children.length;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetcher(guardianId)
      .then((d) => { if (!cancelled) { setData(d); setError(false); } })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guardianId, count]);

  return { data, loading, error };
}
