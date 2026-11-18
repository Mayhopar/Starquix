import { useEffect, useCallback, useRef } from 'react';
import { useEditorDoc } from '@/store/EditorContext';
import { selectProjectFonts, generateFontsCss } from '@/store/fontSelectors';

/**
 * Observes the Yjs `fonts` map and injects baked @font-face CSS into the
 * preview iframe (SET_FONTS_CSS). Re-injects on iframe reload
 * (`sq:iframe-ready` — fired post-RENDER by ViewportFrame in WC/server, and
 * straight off the bridge's IFRAME_READY announce for local iframes via
 * Canvas.tsx relayLocalIframeReady, since local mode never sends RENDER).
 *
 * This hook itself never writes the FS, but font persistence is per-runtime:
 * WC keeps Dexie bytes + the doc manifest (export bakes real files); the
 * LOCAL runtime writes real files into the user's project (public/fonts/* +
 * public/sq-fonts.css + <head> link — utils/localFonts.ts via
 * /__sq/local/font-file|font-css) and still feeds this hook for live
 * injection in the current session.
 */
export function useFontsSync(iframeRef?: React.RefObject<HTMLIFrameElement | null>): void {
  const doc = useEditorDoc();
  // task-120: skip observer re-posts when the generated CSS is unchanged
  // (fonts map events that don't alter the output). The reload path below
  // bypasses the gate — a fresh iframe always needs the CSS.
  const lastSentRef = useRef<string | null>(null);

  const injectCSS = useCallback((css: string) => {
    if (!iframeRef?.current?.contentWindow) return;
    lastSentRef.current = css;
    iframeRef.current.contentWindow.postMessage({ type: 'SET_FONTS_CSS', payload: { css } }, '*');
  }, [iframeRef]);

  useEffect(() => {
    const handleIframeReady = () => {
      const css = generateFontsCss(selectProjectFonts(doc));
      if (css) injectCSS(css);
    };
    window.addEventListener('sq:iframe-ready', handleIframeReady);
    return () => window.removeEventListener('sq:iframe-ready', handleIframeReady);
  }, [doc, injectCSS]);

  useEffect(() => {
    const fonts = doc.getMap('fonts');
    const observer = () => {
      const css = generateFontsCss(selectProjectFonts(doc));
      if (css === lastSentRef.current) return;
      injectCSS(css);
    };
    fonts.observeDeep(observer);
    const initial = generateFontsCss(selectProjectFonts(doc));
    if (initial) injectCSS(initial);
    return () => fonts.unobserveDeep(observer);
  }, [doc, injectCSS]);
}
