import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadPostViewHtml, loadViaHiddenFrame } from '../loadPostViewHtml';

/**
 * Measured 2026-08-12: `fetch()` of the instance origin can fail from the
 * editor page AND from inside the preview iframe (all four probed URLs,
 * including "/", came back null). Document loads work. So the route posts its
 * own HTML and we read it from a hidden frame.
 */
const URL_ = 'https://instance.example/__sq_post_view/posts/hello';

/** Reply as the route's inline script would, once the frame is in the DOM. */
function answerAsRoute(path: string, html: string, opts?: { fromWrongFrame?: boolean }) {
  const frame = document.querySelector('iframe[aria-hidden="true"]') as HTMLIFrameElement | null;
  if (!frame) throw new Error('no hidden frame was appended');
  window.dispatchEvent(new MessageEvent('message', {
    source: (opts?.fromWrongFrame ? window : frame.contentWindow) as Window,
    data: { type: 'SQ_POST_VIEW_HTML', payload: { path, html } },
  }));
}

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

describe('loadViaHiddenFrame', () => {
  it('resolves the HTML the route posts up, then removes the frame', async () => {
    const p = loadViaHiddenFrame(URL_);
    await Promise.resolve();
    expect(document.querySelectorAll('iframe').length).toBe(1);
    answerAsRoute('posts/hello', '<html>real render</html>');
    await expect(p).resolves.toBe('<html>real render</html>');
    expect(document.querySelectorAll('iframe').length).toBe(0);
  });

  it('ignores a message for a DIFFERENT path so two loads cannot cross', async () => {
    const p = loadViaHiddenFrame(URL_, 500);
    await Promise.resolve();
    answerAsRoute('posts/other', '<html>wrong post</html>');
    vi.advanceTimersByTime(600);
    await expect(p).resolves.toBeNull();
  });

  it('ignores a message from a different window', async () => {
    const p = loadViaHiddenFrame(URL_, 500);
    await Promise.resolve();
    answerAsRoute('posts/hello', '<html>spoofed</html>', { fromWrongFrame: true });
    vi.advanceTimersByTime(600);
    await expect(p).resolves.toBeNull();
  });

  it('resolves null and cleans up on timeout', async () => {
    const p = loadViaHiddenFrame(URL_, 300);
    await Promise.resolve();
    vi.advanceTimersByTime(400);
    await expect(p).resolves.toBeNull();
    expect(document.querySelectorAll('iframe').length).toBe(0);
  });
});

describe('loadPostViewHtml', () => {
  it('uses direct fetch when it works — the fast path', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>direct</html>', { status: 200 })));
    await expect(loadPostViewHtml(URL_)).resolves.toBe('<html>direct</html>');
    expect(document.querySelectorAll('iframe').length).toBe(0);
  });

  it('falls back to the hidden frame when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const p = loadPostViewHtml(URL_);
    await vi.waitFor(() => expect(document.querySelectorAll('iframe').length).toBe(1));
    answerAsRoute('posts/hello', '<html>via frame</html>');
    await expect(p).resolves.toBe('<html>via frame</html>');
  });

  it('falls back when the fetch returns a non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    const p = loadPostViewHtml(URL_);
    await vi.waitFor(() => expect(document.querySelectorAll('iframe').length).toBe(1));
    answerAsRoute('posts/hello', '<html>via frame</html>');
    await expect(p).resolves.toBe('<html>via frame</html>');
  });
});
