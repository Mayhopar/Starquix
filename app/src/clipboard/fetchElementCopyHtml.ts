// Parent-side request/response over the ViewportFrame relay (CustomEvent seam so
// non-React code can ask the iframe for an element's cleaned outerHTML).
let seq = 0;

export function fetchElementCopyHtml(key: string, timeoutMs = 3000): Promise<string | null> {
  const requestId = `copyhtml_${++seq}_${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve) => {
    const onResult = (e: Event) => {
      const detail = (e as CustomEvent).detail as { requestId: string; html: string | null };
      if (detail?.requestId !== requestId) return;
      cleanup();
      resolve(detail.html);
    };
    const timer = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('sq:copy-element-html-result', onResult);
    };
    window.addEventListener('sq:copy-element-html-result', onResult);
    window.dispatchEvent(new CustomEvent('sq:copy-element-html', { detail: { key, requestId } }));
  });
}
