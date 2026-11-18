/**
 * Seamless canvas A4/A5 (2026-11-10, log-proven): a document boundary used `location.reload()`,
 * which is not eligible for the paint-hold view transition — Chromium showed ONE blank frame between
 * the new document's commit and its first paint. The boundary is now a same-origin REPLACE to the
 * page's own URL + `sq-b` (a fragment-only change would not load a new document); the new document
 * drops the marker before anything reads the URL and gets the scroll a reload used to restore.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type Bridge = HarnessBridge & {
  boundaryUrl(href: string): string;
  restoreBoundaryScroll(x: number, y: number): void;
  flushTextDraft(): void;
};
const mount = () => mountBridgeForTest() as Bridge;
const proto = () => Object.getPrototypeOf(mount()) as Bridge;

describe('document boundary (paint-hold replace)', () => {
  beforeEach(() => { resetHarnessDom(); history.replaceState(null, '', '/'); sessionStorage.clear(); });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); history.replaceState(null, '', '/'); sessionStorage.clear(); });

  it('targets the same page as a NEW url: path, query and #sq-ov kept, sq-b added', () => {
    const next = new URL(mount().boundaryUrl('http://127.0.0.1:4000/blog/post?x=1#sq-ov=%7B%7D'));
    expect(next.origin + next.pathname).toBe('http://127.0.0.1:4000/blog/post');
    expect(next.searchParams.get('x')).toBe('1');
    expect(next.searchParams.get('sq-b')).toMatch(/^\d+$/);
    expect(next.hash).toBe('#sq-ov=%7B%7D');
  });

  it('navigates through boundaryUrl (a replace, never a reload) and carries the scroll', () => {
    const bridge = mount();
    bridge.flushTextDraft = vi.fn();
    const target = vi.spyOn(proto(), 'boundaryUrl').mockReturnValue('/about#sq-test'); // jsdom only does fragment navigations
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(640);
    history.replaceState(null, '', '/about');
    const here = location.href;
    bridge.documentBoundary('shape');
    expect(bridge.flushTextDraft).toHaveBeenCalled();
    expect(target).toHaveBeenCalledWith(here);
    expect(JSON.parse(sessionStorage.getItem('sq-b-scroll')!)).toEqual(['/about', 0, 640]);
  });

  it('the new document drops sq-b before anything reads the url and restores the scroll of the same page', () => {
    const restore = vi.spyOn(proto(), 'restoreBoundaryScroll').mockImplementation(() => {});
    sessionStorage.setItem('sq-b-scroll', JSON.stringify(['/about', 0, 640]));
    history.replaceState(null, '', '/about?sq-b=123#sq-ov=%7B%7D');
    mount();
    expect(location.pathname + location.search + location.hash).toBe('/about#sq-ov=%7B%7D');
    expect(restore).toHaveBeenCalledWith(0, 640);
    expect(sessionStorage.getItem('sq-b-scroll')).toBeNull();
  });

  it('another page, or no boundary marker, restores nothing and keeps the url', () => {
    const restore = vi.spyOn(proto(), 'restoreBoundaryScroll').mockImplementation(() => {});
    sessionStorage.setItem('sq-b-scroll', JSON.stringify(['/blog', 0, 640]));
    history.replaceState(null, '', '/about?sq-b=1');
    mount();
    expect(restore).not.toHaveBeenCalled();
    history.replaceState(null, '', '/about?q=1');
    sessionStorage.setItem('sq-b-scroll', JSON.stringify(['/about', 0, 640]));
    mount();
    expect(location.search).toBe('?q=1');
    expect(restore).not.toHaveBeenCalled();
  });

  it('restoring re-applies each frame until it holds, and stops on user input', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame'] });
    let y = 0; let room = 0; // the page grows: scrollTo clamps to what exists
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => y);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(((_x: number, ny: number) => { y = Math.min(ny, room); }) as typeof window.scrollTo);
    const bridge = mount();
    bridge.restoreBoundaryScroll(0, 640);
    vi.advanceTimersToNextFrame(); expect(y).toBe(0);
    room = 300; vi.advanceTimersToNextFrame(); expect(y).toBe(300);
    room = 2000; vi.advanceTimersToNextFrame(); expect(y).toBe(640);
    const calls = scrollTo.mock.calls.length;
    vi.advanceTimersToNextFrame(); expect(scrollTo.mock.calls.length).toBe(calls); // held on a loaded page: done

    y = 0; room = 0;
    bridge.restoreBoundaryScroll(0, 640);
    vi.advanceTimersToNextFrame();
    window.dispatchEvent(new Event('wheel'));
    room = 2000; const before = scrollTo.mock.calls.length;
    vi.advanceTimersToNextFrame(); vi.advanceTimersToNextFrame();
    expect(scrollTo.mock.calls.length).toBe(before); // the user's scroll wins
  });
});
