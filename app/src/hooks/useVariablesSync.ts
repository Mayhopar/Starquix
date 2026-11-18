// app/src/hooks/useVariablesSync.ts

import { useEffect, useCallback } from 'react';
import { useEditorDoc } from '@/store/EditorContext';
import { selectVariableCollections } from '@/store/variableSelectors';
import { generateCollectionsCSS } from '@/core/variables/cssGenerator';
import { selectProjectId } from '@/store/selectors';
import { isLocalProjectId } from '@/utils/localMode';

/**
 * Observes variable collections in Yjs and:
 * 1. Injects <style id="sq-variables"> into the iframe for live preview
 * 2. Re-injects CSS on sq:iframe-ready (iframe reload)
 * Persistence is the Yjs doc itself (sq-doc:{projectId}) — no shared disk JSON.
 *
 * task-174: there is deliberately NO source write here. A `ViteVariablesWriter`
 * used to post `SQ_WRITE_VARIABLES` into the iframe on a 2s debounce, but the
 * message never had a receiver in the entire history of the repo — no bridge
 * handler, no `window.__SQ_WRITE_VARIABLES__` sender, no `sq:write-variables`
 * plugin handler — so every edit burned a 10s timeout and logged a failure.
 * The one path that DID reach disk (`sendViaHttp('/__sq/write-variables')`)
 * was deleted in 1d4d6c59 (2026-06-11). Re-wiring it would also be inert:
 * nothing in preview-template or in an arbitrary user project imports
 * `src/styles/variables.css`, and nothing reads it back into the doc.
 * The three real sinks for variables are: this <style> injection (canvas),
 * the Yjs doc (storage), and `export/generateAstro.ts` — which is the ONLY
 * place that emits `src/styles/variables.css`, and it emits the matching
 * `@import` into global.css alongside it, which is what makes it work there.
 * Local-mode on-disk variables are unbuilt, not broken — see task-178.
 */
export function useVariablesSync(iframeRef?: React.RefObject<HTMLIFrameElement | null>): void {
  const doc = useEditorDoc();

  const injectCSS = useCallback((css: string) => {
    if (!iframeRef?.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage({
      type: 'SET_VARIABLES_CSS',
      payload: { css },
    }, '*');
  }, [iframeRef]);

  // Re-inject CSS when iframe reloads
  useEffect(() => {
    const handleIframeReady = () => {
      const css = generateCollectionsCSS(selectVariableCollections(doc));
      if (css) injectCSS(css);
    };
    window.addEventListener('sq:iframe-ready', handleIframeReady);
    return () => window.removeEventListener('sq:iframe-ready', handleIframeReady);
  }, [doc, injectCSS]);

  // Observe Yjs changes
  useEffect(() => {
    const collections = doc.getMap('variableCollections');

    const observer = () => {
      const allCollections = selectVariableCollections(doc);
      const fullCSS = generateCollectionsCSS(allCollections);

      // Immediate: inject into iframe + update server cache
      injectCSS(fullCSS);
      // Files-truth / local (Phase 3.2): the CSS is a REAL file in the
      // project (src/styles/sq-variables.css), linked from the layout —
      // the host cache is doc-truth only.
      const projectId = selectProjectId(doc);
      // Local CSS/import intent committed in the same transaction as this
      // document update. Observers only repaint its accepted projection.
      if (!projectId || !isLocalProjectId(projectId)) pushCSSToCache(fullCSS);
    };

    collections.observeDeep(observer);

    // Initial injection: if variables already exist in Yjs, inject now
    const initialCSS = generateCollectionsCSS(selectVariableCollections(doc));
    if (initialCSS) {
      injectCSS(initialCSS);
    }

    return () => {
      collections.unobserveDeep(observer);
    };
  }, [doc, injectCSS]);
}

// ── Server cache helper ─────────────────────────────────────────────

function pushCSSToCache(css: string): void {
  fetch('/__sq/cache-variables-css', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ css }),
  }).catch(() => { /* fire-and-forget */ });
}
