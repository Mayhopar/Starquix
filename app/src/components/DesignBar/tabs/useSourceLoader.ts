/**
 * useSourceLoader Hook
 *
 * Handles loading source code for elements from either:
 * - Source-tracked elements (from .astro files) via HTTP endpoints
 * - Component instances via Yjs staticMarkup
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { SourceLocation } from '@/core/state/types';
import { useEditorDoc } from '@/store/hooks';
import { selectResolvedStaticMarkup } from '@/store/selectors';
import { readLocalElementSource } from '@/utils/localElementSource';

export interface SourceState {
  text: string;
  isDirty: boolean;
  isLoading: boolean;
  error: 'read-unavailable' | 'write-unconfirmed' | 'selection-changed' | null;
  startLine: number | null;
  endLine: number | null;
}

interface UseSourceLoaderOptions {
  elementKey: string | null;
  sourceLocation: SourceLocation | null;
}

interface UseSourceLoaderReturn {
  state: SourceState;
  setState: React.Dispatch<React.SetStateAction<SourceState>>;
  isComponentInstance: boolean;
  instanceId: string | null;
  componentType: string | null;
  forceReload: () => void;
  /**
   * The elementKey the current buffer was loaded against. Diverges from the
   * live `elementKey` prop when the user dirties the buffer then switches
   * selection — at that point a naive Apply would write the buffered text
   * against the new selection's identity. Callers should refuse to save
   * when `loadedElementKey !== elementKey`.
   */
  loadedElementKey: string | null;
}

const INITIAL_STATE: SourceState = {
  text: '',
  isDirty: false,
  isLoading: false,
  error: null,
  startLine: null,
  endLine: null,
};

export function useSourceLoader({
  elementKey,
  sourceLocation,
}: UseSourceLoaderOptions): UseSourceLoaderReturn {
  const [state, setStateRaw] = useState<SourceState>(INITIAL_STATE);
  const [reloadKey, setReloadKey] = useState(0);

  const requestIdRef = useRef(0);
  const currentKeyRef = useRef<string | null>(null);
  const isDirtyRef = useRef(false);

  // Wrap setState to keep isDirtyRef in sync
  const setState: React.Dispatch<React.SetStateAction<SourceState>> = useCallback((action) => {
    setStateRaw(prev => {
      const next = typeof action === 'function' ? action(prev) : action;
      isDirtyRef.current = next.isDirty;
      return next;
    });
  }, []);

  const doc = useEditorDoc();

  const isComponentInstance = elementKey?.startsWith('el-') ?? false;
  const instanceId = useMemo(() => {
    if (!isComponentInstance || !elementKey) return null;
    return elementKey.split(':')[0];
  }, [isComponentInstance, elementKey]);

  const resolvedMarkup = useMemo(() => {
    if (!instanceId) return null;
    return selectResolvedStaticMarkup(doc, instanceId);
  }, [doc, instanceId, reloadKey]);

  const componentType = useMemo(() => {
    if (!instanceId) return null;
    const elements = doc.getMap('elements');
    const yEl = elements.get(instanceId) as import('yjs').Map<unknown> | undefined;
    return (yEl?.get('componentType') as string) ?? null;
  }, [doc, instanceId]);

  function forceReload(): void {
    // A read retry must never discard a source draft.
    if (isDirtyRef.current) return;
    currentKeyRef.current = null;
    setReloadKey(k => k + 1);
  }

  useEffect(() => () => {
    ++requestIdRef.current;
    if (!isDirtyRef.current) currentKeyRef.current = null;
  }, []);

  useEffect(() => {
    if (isDirtyRef.current) return;
    if (!elementKey) {
      ++requestIdRef.current;
      currentKeyRef.current = null;
      setState({ ...INITIAL_STATE });
      return;
    }

    if (currentKeyRef.current === elementKey) {
      return;
    }

    // Even selecting a component retires an old file read. A new object for
    // the same selected location, however, must not cancel its active read.
    const requestId = ++requestIdRef.current;
    currentKeyRef.current = elementKey;

    // Component instance - get from Yjs
    if (isComponentInstance && resolvedMarkup !== null) {
      setState({
        text: resolvedMarkup,
        isDirty: false,
        isLoading: false,
        error: null,
        startLine: null,
        endLine: null,
      });
      return;
    }

    // Component instance but no markup found
    if (isComponentInstance && resolvedMarkup === null) {
      setState({
        text: '',
        isDirty: false,
        isLoading: false,
        error: 'read-unavailable',
        startLine: null,
        endLine: null,
      });
      return;
    }

    // Source-tracked element - fetch from file
    if (sourceLocation) {
      setState(prev => ({ ...prev, isLoading: true, error: null }));

      readLocalElementSource(sourceLocation).then((data) => {
        if (requestIdRef.current !== requestId) return;
        setState({ text: data.source || '', isDirty: false, isLoading: false, error: null, startLine: data.startLine, endLine: data.endLine });
      }, (error) => {
        if (requestIdRef.current !== requestId) return;
        console.error('[Source] Read failed', error);
        setState(prev => ({ ...prev, isLoading: false, error: 'read-unavailable' }));
      });
      return;
    }

    // No source available
    setState({ ...INITIAL_STATE });
  }, [elementKey, sourceLocation, isComponentInstance, resolvedMarkup, reloadKey, state.isDirty]);

  return {
    state,
    setState,
    isComponentInstance,
    instanceId,
    componentType,
    forceReload,
    loadedElementKey: currentKeyRef.current,
  };
}
