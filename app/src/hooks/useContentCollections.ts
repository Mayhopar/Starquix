import { useState, useEffect, useCallback } from 'react';
import { contentOps } from '@/core/collections/content-ops';
import type { PostMeta, DiscoveredCollection } from '@/core/collections/types';

export type { PostMeta as DiscoveredPost, DiscoveredCollection };

export function useContentCollections() {
  const [collections, setCollections] = useState<DiscoveredCollection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCollections = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await contentOps.fetchCollections();
      setCollections(data);
      setError(null);
    } catch (err) {
      setError(String(err));
      setCollections([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCollections();

    const hmrHandler = () => fetchCollections();
    // ?. — vitest's SSR shim has import.meta.hot without on/off
    import.meta.hot?.on?.('sq:content-changed', hmrHandler);

    const handler = () => fetchCollections();
    window.addEventListener('sq:content-changed', handler);

    return () => {
      window.removeEventListener('sq:content-changed', handler);
      import.meta.hot?.off?.('sq:content-changed', hmrHandler);
    };
  }, [fetchCollections]);

  return { collections, isLoading, error, refresh: fetchCollections };
}
