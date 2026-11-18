import { useState, useEffect, useCallback } from 'react';
import { tryResolveCanvasHtmlFromSource } from '@/utils/canvasHtml';
import type { ScannedComponent } from './useComponentLibrary';

/**
 * Fetches the current HTML for a component's .astro source and runs it
 * through `resolveCanvasHtml` so sub-component tags (`<Header />`,
 * `<Footer />`, etc.) are expanded into their rendered HTML. This is the
 * format the canvas actually renders, and the format every instance's
 * `staticMarkup` / `masterVersion` is computed from at wrap/add time —
 * returning raw-and-unexpanded source from here was a footgun: the
 * outdated comparison fired false positives, and the "pull from source"
 * reset wrote raw `<Header />` into the wrapper, which the browser
 * silently drops.
 *
 * `library` is required so resolveCanvasHtml can find sub-component
 * bodies. Pass `[...builtIn, ...userProject]`.
 *
 * `setSourceHtml` is a synchronous setter for callers who already have
 * the resolved HTML (e.g. after writing to source) and want to avoid the
 * async-refetch window where `sourceHtml` lags Yjs updates and transient
 * isOutdated/isBaseStale flickers appear.
 */
/** One-shot resolved-source fetch (the hook's read), for non-React callers (AI tools). */
export async function resolveSourceHtml(
  astroSource: string,
  library: ScannedComponent[],
): Promise<string | null> {
  return (await tryResolveCanvasHtmlFromSource(astroSource, library)) ?? null;
}

export function useSourceHtml(astroSource: string | null, library: ScannedComponent[]) {
  const [html, setHtml] = useState<string | null>(null);

  const refetch = useCallback(() => {
    if (!astroSource) { setHtml(null); return; }

    let cancelled = false;
    void resolveSourceHtml(astroSource, library).then(resolved => {
      if (!cancelled) setHtml(resolved);
    });

    return () => { cancelled = true; };
  }, [astroSource, library]);

  useEffect(() => {
    return refetch();
  }, [refetch]);

  return { sourceHtml: html, refetchSourceHtml: refetch, setSourceHtml: setHtml };
}
