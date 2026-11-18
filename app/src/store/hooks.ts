import { recordEditorMetric } from '@/performance/editorMetrics';
import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { useEditorDoc } from './EditorContext';
import { normalizeYjsScopes, subscribeYjsScopes, type YjsScope } from './scopedYjsSubscription';
import { selectCurrentPageId, selectCurrentThemeMode, selectProjectId } from './selectors';
import type { EditorCommand } from './types';
import { classifyEditorAction, dispatchDurableAction, dispatchSessionAction, type SessionCommand } from './durableDispatch';
import { acceptEditorCommands } from './commandGesture';
import { parseKey } from './types';
import { isLocalProjectId } from '@/utils/localMode';
import type { AcceptedEdit } from '@/services/durableEdits/types';
import { useUndoContext, useOptionalUndoContext } from '@/context/UndoContext';

// Re-export for convenience
export { useEditorDoc };

/** Deep value equality with Object.is shortcuts at every level — faster than JSON.stringify (no allocation, early exits) */
function valueEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!valueEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (Array.isArray(b)) return false;

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  if (aKeys.length !== Object.keys(bObj).length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bObj, key) || !valueEqual(aObj[key], bObj[key])) return false;
  }
  return true;
}

export function useYjsValue<T>(selector: (doc: Y.Doc) => T, equalityFn?: (a: T, b: T) => boolean): T {
  const doc = useEditorDoc();
  const selectorRef = useRef(selector);
  const cachedValueRef = useRef<T | null>(null);
  const isFirstRef = useRef(true);
  const equalityFnRef = useRef(equalityFn);

  // Keep refs up to date
  selectorRef.current = selector;
  equalityFnRef.current = equalityFn;

  const subscribe = useCallback(
    (callback: () => void) => {
      doc.on('update', callback);
      return () => doc.off('update', callback);
    },
    [doc]
  );

  const getSnapshot = useCallback(() => {
    recordEditorMetric('selector');
    const newValue = selectorRef.current(doc);

    if (isFirstRef.current) {
      isFirstRef.current = false;
      cachedValueRef.current = newValue;
      return newValue;
    }

    const cached = cachedValueRef.current as T;
    const eq = equalityFnRef.current;
    const isEqual = eq ? eq(newValue, cached) : valueEqual(newValue, cached);

    if (isEqual) {
      return cached;
    }

    cachedValueRef.current = newValue;
    return newValue;
  }, [doc]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useDurableDispatch() {
  const doc = useEditorDoc();
  const undo = useOptionalUndoContext();
  return useCallback((action: EditorCommand): Promise<AcceptedEdit> => {
    const projectId = doc.getMap('meta').get('projectId');
    if (typeof projectId === 'string' && isLocalProjectId(projectId)
      && (action.type === 'UPDATE_SOURCE_CLASSES' || action.type === 'UPDATE_SOURCE_TEXT' || action.type === 'UPDATE_SOURCE_MARKUP')
      && parseKey(action.sourceKey)?.type === 'source') {
      return acceptEditorCommands(doc, [action], undo?.claimSnapshot());
    }
    return dispatchDurableAction(doc, action, [], undefined, undo?.claimSnapshot());
  }, [doc, undo?.claimSnapshot]);
}

export function useSessionDispatch() {
  const doc = useEditorDoc();
  return useCallback((action: SessionCommand) => dispatchSessionAction(doc, action), [doc]);
}

/** Compatibility entry point: project calls always return their acceptance. */

/** Explicit read dependencies; writes and the broad useYjsValue contract are unchanged. */
export function useScopedYjsValue<T>(
  selector: (doc: Y.Doc) => T,
  scopes: readonly YjsScope[],
  equalityFn?: (a: T, b: T) => boolean,
): T {
  const doc = useEditorDoc();
  const selectorRef = useRef(selector);
  const equalityFnRef = useRef(equalityFn);
  selectorRef.current = selector;
  equalityFnRef.current = equalityFn;
  const scopeKey = JSON.stringify(normalizeYjsScopes(scopes));
  const subscribe = useCallback((notify: () => void) =>
    subscribeYjsScopes(doc, JSON.parse(scopeKey) as YjsScope[], notify), [doc, scopeKey]);
  // A new provider document owns a fresh snapshot, even if the values compare equal.
  const cache = useMemo(() => ({ initialized: false, value: undefined as T | undefined }), [doc]);
  const getSnapshot = useCallback(() => {
    recordEditorMetric('selector');
    const next = selectorRef.current(doc);
    if (cache.initialized && (equalityFnRef.current ?? valueEqual)(next, cache.value as T)) return cache.value as T;
    cache.initialized = true;
    cache.value = next;
    return next;
  }, [doc, cache]);
  // Closure changes get a fresh snapshot during render, without needing a Yjs event.
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

const PAGE_SCOPE = [{ map: 'meta', keys: ['currentPageId'] }] as const;
const PROJECT_SCOPE = [{ map: 'meta', keys: ['projectId'] }] as const;
const THEME_SCOPE = [{ map: 'meta', keys: ['currentThemeMode'] }] as const;
export const useCurrentPageId = () => useScopedYjsValue(selectCurrentPageId, PAGE_SCOPE);
export const useProjectId = () => useScopedYjsValue(selectProjectId, PROJECT_SCOPE);
export const useCurrentThemeMode = () => useScopedYjsValue(selectCurrentThemeMode, THEME_SCOPE);

export function useDispatch() {
  const doc = useEditorDoc();
  const durableDispatch = useDurableDispatch();
  return useCallback((action: EditorCommand, _origin: 'user' | 'ai' = 'user'): Promise<AcceptedEdit> | boolean =>
    classifyEditorAction(action) === 'session'
      ? dispatchSessionAction(doc, action as SessionCommand)
      : durableDispatch(action), [doc, durableDispatch]);
}

/**
 * Single undo/redo using snapshot-based UndoContext.
 * Tracks element tree operations and source-keyed class changes.
 */
export function useUndo() {
  return useUndoContext();
}
