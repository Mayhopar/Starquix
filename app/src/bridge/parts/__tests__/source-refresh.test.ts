/**
 * Seamless canvas (plan docs/plans/2026-10-04-seamless-canvas-plan.md):
 * a Vite reload is claimed by the bridge and applied in place — the document
 * is never replaced for an in-place-patchable change, and typed input is never
 * touched.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

const page = (body: string) => `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;
const P = (src: string, ver: string, cls: string, text: string) =>
  `<p data-sq-source="src/pages/index.astro:${src}" data-sq-source-version="${ver}" data-sq-placement="" data-sq-usage="" class="${cls}">${text}</p>`;
const reload = (reason = 'reload') => (window as unknown as { __SQ_VITE_RELOAD__: (r: string) => boolean }).__SQ_VITE_RELOAD__(reason);
const respond = (body: string) => vi.fn(async () => new Response(page(body)));

describe('source refresh', () => {
  let bridge: HarnessBridge;
  beforeEach(() => {
    resetHarnessDom();
    bridge = mountBridgeForTest();
    (window as unknown as { __SQ_LOCAL_MODE__: boolean }).__SQ_LOCAL_MODE__ = true;
  });
  afterEach(() => {
    if (bridge._refreshRetry) clearTimeout(bridge._refreshRetry);
    vi.unstubAllGlobals();
  });

  it('claims a Vite reload and patches classes + version stamps in place', async () => {
    document.body.innerHTML = P('3:1', 'v1', 'a', 'Hello') + P('4:1', 'v1', '', 'World');
    const first = document.querySelector('p');
    vi.stubGlobal('fetch', respond(P('3:1', 'v2', 'a b', 'Hello') + P('4:1', 'v2', '', 'World')));
    expect(reload()).toBe(true);
    await bridge._refreshDone;
    expect(document.querySelector('p')).toBe(first); // same node
    expect(first!.className).toBe('a b');
    expect(first!.getAttribute('data-sq-source-version')).toBe('v2');
    expect(bridge.scanElements).toHaveBeenCalledTimes(1);
    expect(bridge.sendToParent).toHaveBeenCalledWith({ type: 'SOURCE_OK' }); // clears a template-error status
  });

  it('a failing render (500) keeps the DOM and reports no recovery', async () => {
    document.body.innerHTML = P('3:1', 'v1', 'a', 'Hi');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<title>undefined</title>', { status: 500 })));
    reload(); await bridge._refreshDone;
    expect(document.querySelector('p')!.className).toBe('a');
    expect(bridge.sendToParent).not.toHaveBeenCalledWith({ type: 'SOURCE_OK' });
  });

  it('patches text nodes in place', async () => {
    document.body.innerHTML = P('3:1', 'v1', 'a', 'Hello');
    const text = document.querySelector('p')!.firstChild;
    vi.stubGlobal('fetch', respond(P('3:1', 'v2', 'a', 'Hello there')));
    reload(); await bridge._refreshDone;
    expect(document.querySelector('p')!.firstChild).toBe(text);
    expect(document.querySelector('p')!.textContent).toBe('Hello there');
  });

  it('keeps editor-owned attributes the server never sends', async () => {
    document.body.innerHTML = P('3:1', 'v1', 'a', 'Hi');
    document.querySelector('p')!.setAttribute('data-key', 'k1');
    vi.stubGlobal('fetch', respond(P('3:1', 'v2', 'a', 'Hi')));
    reload(); await bridge._refreshDone;
    expect(document.querySelector('p')!.getAttribute('data-key')).toBe('k1');
  });

  it('an element that moved in its file loses the key derived from its old line; other editor keys stay (live 2026-10-10)', async () => {
    document.body.innerHTML = P('3:1', 'v1', 'a', 'Hi');
    const moved = document.querySelector('p')!;
    moved.setAttribute('data-key', 'src/pages/index.astro:3:1');
    vi.stubGlobal('fetch', respond(P('4:1', 'v2', 'a', 'Hi')));
    reload(); await bridge._refreshDone;
    expect(document.querySelector('p')).toBe(moved);
    expect(moved.getAttribute('data-sq-source')).toBe('src/pages/index.astro:4:1');
    expect(moved.hasAttribute('data-key')).toBe(false); // the rescan stamps :4:1
    // A key the scan did not derive from the line (drawn, blog wrappers) stays.
    moved.setAttribute('data-key', 'drawn:abc');
    vi.stubGlobal('fetch', respond(P('5:1', 'v3', 'a', 'Hi')));
    reload(); await bridge._refreshDone;
    expect(moved.getAttribute('data-key')).toBe('drawn:abc');
  });

  it('ignores editor-injected body nodes (selection highlight)', async () => {
    document.body.innerHTML = P('3:1', 'v1', 'a', 'Hi') + '<div data-sq-selection-highlight="true"></div>';
    vi.stubGlobal('fetch', respond(P('3:1', 'v2', 'a b', 'Hi')));
    bridge.documentBoundary = vi.fn();
    reload(); await bridge._refreshDone;
    expect(bridge.documentBoundary).not.toHaveBeenCalled();
    expect(document.querySelector('[data-sq-selection-highlight]')).not.toBeNull();
    expect(document.querySelector('p')!.className).toBe('a b');
  });

  it('coalesces a burst into at most one trailing refetch', async () => {
    document.body.innerHTML = P('3:1', 'v1', 'a', 'Hi');
    const f = respond(P('3:1', 'v2', 'a', 'Hi'));
    vi.stubGlobal('fetch', f);
    for (let i = 0; i < 5; i++) reload();
    await bridge._refreshDone; await bridge._refreshDone;
    expect(f.mock.calls.length).toBeLessThanOrEqual(2);
    expect(bridge.scanElements).toHaveBeenCalledTimes(1);
  });

  it('keeps the DOM and claims the reload when the fetch fails (case 23)', async () => {
    document.body.innerHTML = P('3:1', 'v1', 'a', 'Hi');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('down'); }));
    expect(reload()).toBe(true);
    await bridge._refreshDone;
    expect(document.querySelector('p')!.className).toBe('a');
    expect(bridge._refreshRetry).toBeTruthy();
  });

  it('a garbage response (no tagged elements) twice → boundary, nothing half-applied (case 25)', async () => {
    document.body.innerHTML = P('3:1', 'v1', 'a', 'Hi');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"nope"}')));
    bridge.documentBoundary = vi.fn();
    reload(); await bridge._refreshDone;
    expect(bridge.documentBoundary).not.toHaveBeenCalled();
    expect(bridge._refreshRetry).toBeTruthy();
    reload(); await bridge._refreshDone;
    expect(bridge.documentBoundary).toHaveBeenCalledWith('shape');
    expect(document.querySelector('p')!.getAttribute('data-sq-source-version')).toBe('v1');
  });

  it('a torn-write read (empty render) re-reads once and morphs in place, no boundary', async () => {
    document.body.innerHTML = P('3:1', 'v1', 'a', 'Hi');
    const first = document.querySelector('p');
    const f = vi.fn(async () => new Response(page('<style>x</style>')));
    vi.stubGlobal('fetch', f);
    bridge.documentBoundary = vi.fn();
    reload(); await bridge._refreshDone;
    f.mockImplementation(async () => new Response(page(P('3:1', 'v2', 'a b', 'Hi'))));
    reload(); await bridge._refreshDone;
    expect(bridge.documentBoundary).not.toHaveBeenCalled();
    expect(document.querySelector('p')).toBe(first);
    expect(first!.className).toBe('a b');
  });

  it('changed script → boundary (case 14)', async () => {
    document.body.innerHTML = P('3:1', 'v1', 'a', 'Hi') + '<script>var a=1</script>';
    vi.stubGlobal('fetch', respond(P('3:1', 'v1', 'a', 'Hi') + '<script>var a=2</script>'));
    bridge.documentBoundary = vi.fn();
    reload(); await bridge._refreshDone;
    expect(bridge.documentBoundary).toHaveBeenCalledWith('shape');
  });

  it('reconnect is always a boundary', () => {
    bridge.documentBoundary = vi.fn();
    expect(reload('reconnect')).toBe(true);
    expect(bridge.documentBoundary).toHaveBeenCalledWith('reconnect');
  });

  it('re-applies #sq-ov overrides in the same task and stashes FILE classes for the scan (D4)', async () => {
    document.body.innerHTML = P('3:1', 'v1', 'override', 'Hi');
    history.replaceState(null, '', '#sq-ov=' + encodeURIComponent(JSON.stringify({ 'src/pages/index.astro:3:1': 'override' })));
    try {
      vi.stubGlobal('fetch', respond(P('3:1', 'v2', 'file', 'Hi')));
      reload(); await bridge._refreshDone;
      expect(document.querySelector('p')!.className).toBe('override');
      expect(bridge._preAppliedFileClasses['src/pages/index.astro:3:1']).toBe('file');
    } finally { history.replaceState(null, '', location.pathname); }
  });

  it('edit in progress, same key + same version → patches elsewhere, edited subtree untouched', async () => {
    const X = (cls: string) => `<p data-sq-source="src/components/X.astro:2:1" data-sq-source-version="w1" data-sq-placement="" data-sq-usage="" class="${cls}">Body</p>`;
    document.body.innerHTML = P('3:1', 'v1', 'a', 'Title') + X('');
    const edited = document.querySelectorAll('p')[1] as HTMLElement;
    bridge.editingElement = edited; edited.textContent = 'Body typed';
    vi.stubGlobal('fetch', respond(P('3:1', 'v2', 'a b', 'Title') + X('')));
    reload(); await bridge._refreshDone;
    expect(document.querySelector('p')!.className).toBe('a b');
    expect(edited.textContent).toBe('Body typed');
  });

  it('edited element file version moved → whole refresh deferred until exit (D3)', async () => {
    document.body.innerHTML = P('3:1', 'v1', 'a', 'Title') + P('4:1', 'v1', '', 'Body');
    const edited = document.querySelectorAll('p')[1] as HTMLElement;
    bridge.editingElement = edited; edited.textContent = 'Body typed';
    const f = respond(P('3:1', 'v2', 'a b', 'Title') + P('4:1', 'v2', '', 'Body'));
    vi.stubGlobal('fetch', f);
    reload(); await bridge._refreshDone;
    expect(document.querySelector('p')!.className).toBe('a'); // nothing touched
    expect(edited.textContent).toBe('Body typed');
    expect(bridge.scanElements).not.toHaveBeenCalled();
    bridge.editingElement = null; bridge.onEditExitedForRefresh();
    await bridge._refreshDone;
    expect(f).toHaveBeenCalledTimes(2); // re-fetched after exit
    expect(document.querySelector('p')!.className).toBe('a b');
  });

  it('after exit, the committed text is held until the served file catches up (no old-text flash)', async () => {
    document.body.innerHTML = P('3:1', 'v1', 'a', 'Title') + P('4:1', 'v1', '', 'Body');
    const edited = document.querySelectorAll('p')[1] as HTMLElement;
    edited.textContent = 'Body typed';
    bridge.onEditExitedForRefresh(edited, true, 'Body');
    vi.stubGlobal('fetch', respond(P('3:1', 'v2', 'a b', 'Title') + P('4:1', 'v2', 'c', 'Body')));
    reload(); await bridge._refreshDone;
    expect(edited.textContent).toBe('Body typed'); // write not landed yet: held
    expect(edited.className).toBe('c');            // attributes still refresh
    vi.stubGlobal('fetch', respond(P('3:1', 'v3', 'a b', 'Title') + P('4:1', 'v3', 'c', 'Body typed')));
    reload(); await bridge._refreshDone;
    vi.stubGlobal('fetch', respond(P('3:1', 'v4', 'a b', 'Title') + P('4:1', 'v4', 'c', 'Body from IDE')));
    reload(); await bridge._refreshDone;
    expect(edited.textContent).toBe('Body from IDE'); // released once the file caught up
  });

  // Desktop 2026-10-04 (logs: heldEdit HOLD liveKey 11:5 'Nested edited' vs fresh 11:5
  // 'Hello post', versions sbd2→sf2ea): keys are positional. After a reorder the
  // fresh element on the edited key is ANOTHER element; holding the typed text
  // there painted the edit onto it (and kept it after the commit landed).
  it('a held edit is released when the fresh element on its key is another element (moved by a reorder)', async () => {
    const A = (src: string, ver: string, text: string) => `<a data-sq-source="src/pages/index.astro:${src}" data-sq-source-version="${ver}" data-sq-placement="" data-sq-usage="">${text}</a>`;
    document.body.innerHTML = A('10:5', 'v9', 'Release widget') + A('11:5', 'v9', 'Nested about') + A('12:5', 'v9', 'Hello post');
    const edited = document.querySelectorAll('a')[1] as HTMLElement;
    edited.textContent = 'Nested edited';
    bridge.onEditExitedForRefresh(edited, true, 'Nested about');
    vi.stubGlobal('fetch', respond(A('10:5', 'v10', 'Nested about') + A('11:5', 'v10', 'Hello post') + A('12:5', 'v10', 'Release widget')));
    reload(); await bridge._refreshDone;
    expect([...document.querySelectorAll('a')].map(a => a.textContent)).toEqual(['Nested about', 'Hello post', 'Release widget']);
    vi.stubGlobal('fetch', respond(A('10:5', 'v11', 'Nested edited') + A('11:5', 'v11', 'Hello post') + A('12:5', 'v11', 'Release widget')));
    reload(); await bridge._refreshDone;
    expect([...document.querySelectorAll('a')].map(a => a.textContent)).toEqual(['Nested edited', 'Hello post', 'Release widget']);
  });

  // ── Layer 2: keyed morph (Task 2.1) ──
  const norm = (html: string) => html.replace(/ data-key="[^"]*"/g, '');
  const morphTo = async (body: string) => { vi.stubGlobal('fetch', respond(body)); reload(); await bridge._refreshDone; };

  it('insert in the middle: the DOM equals the fresh HTML, the unshifted node is kept', async () => {
    document.body.innerHTML = P('3:1', 'v1', '', 'A') + P('4:1', 'v1', '', 'B');
    const a = document.querySelectorAll('p')[0];
    const fresh = P('3:1', 'v2', '', 'A') + P('4:1', 'v2', '', 'X') + P('5:1', 'v2', '', 'B');
    await morphTo(fresh);
    expect(norm(document.body.innerHTML)).toBe(fresh);
    expect(document.querySelectorAll('p')[0]).toBe(a);
    expect(bridge.scanElements).toHaveBeenCalledTimes(1);
  });

  it('delete', async () => {
    document.body.innerHTML = P('3:1', 'v1', '', 'A') + P('4:1', 'v1', '', 'B') + P('5:1', 'v1', '', 'C');
    const fresh = P('3:1', 'v2', '', 'A') + P('4:1', 'v2', '', 'C');
    await morphTo(fresh);
    expect(norm(document.body.innerHTML)).toBe(fresh);
  });

  it('reorder by key moves the same node with one insertBefore', async () => {
    const K = (k: string, t: string) => `<section data-sq-source="src/components/${k}.astro:1:1" data-sq-source-version="v" data-sq-placement="" data-sq-usage="">${t}</section>`;
    document.body.innerHTML = K('A', 'a') + K('B', 'b') + K('C', 'c');
    const c = document.querySelectorAll('section')[2];
    const spy = vi.spyOn(Node.prototype, 'insertBefore');
    try {
      await morphTo(K('C', 'c') + K('A', 'a') + K('B', 'b'));
      expect(spy).toHaveBeenCalledTimes(1);
    } finally { spy.mockRestore(); }
    expect(document.querySelectorAll('section')[0]).toBe(c);
  });

  it('flow reorder already applied optimistically → zero DOM moves (Task 2.4)', async () => {
    const K = (k: string) => `<section data-sq-source="src/components/${k}.astro:1:1" data-sq-source-version="v" data-sq-placement="" data-sq-usage="">${k}</section>`;
    document.body.innerHTML = K('B') + K('A');
    const spy = vi.spyOn(Node.prototype, 'insertBefore');
    try { await morphTo(K('B') + K('A')); expect(spy).not.toHaveBeenCalled(); } finally { spy.mockRestore(); }
  });

  it('repeated keys from a loop pair in order', async () => {
    const L = (t: string) => `<li data-sq-source="src/pages/index.astro:9:3" data-sq-source-version="v" data-sq-placement="" data-sq-usage="">${t}</li>`;
    document.body.innerHTML = `<ul>${L('1')}${L('2')}</ul>`;
    const [one, two] = Array.from(document.querySelectorAll('li'));
    await morphTo(`<ul>${L('1')}${L('2')}${L('3')}</ul>`);
    const lis = document.querySelectorAll('li');
    expect(lis[0]).toBe(one); expect(lis[1]).toBe(two); expect(lis[2].textContent).toBe('3');
  });

  it('unchanged island is kept untouched (client state survives); a changed one is replaced alone', async () => {
    const I = (props: string) => `<astro-island component-url="/C.jsx" renderer-url="/r.js" props="${props.replace(/"/g, '&quot;')}" client="load"><b>ssr</b></astro-island>`;
    document.body.innerHTML = P('3:1', 'v1', '', 'A') + I('{}') + I('{"n":1}');
    const [kept, changed] = Array.from(document.querySelectorAll('astro-island')) as Array<HTMLElement & { __state?: number }>;
    kept.__state = 1; kept.innerHTML = '<b>hydrated</b>'; kept.removeAttribute('ssr');
    await morphTo(P('3:1', 'v2', '', 'A') + I('{}') + I('{"n":2}'));
    const islands = document.querySelectorAll('astro-island') as NodeListOf<HTMLElement & { __state?: number }>;
    expect(islands[0]).toBe(kept); expect(islands[0].__state).toBe(1); expect(islands[0].innerHTML).toBe('<b>hydrated</b>');
    expect(islands[1]).not.toBe(changed); expect(islands[1].getAttribute('props')).toBe('{"n":2}');
  });

  it.each([
    ['added', '', '<script>var a=1</script>'],
    ['removed', '<script>var a=1</script>', ''],
    ['inside an imported subtree', '', '<div><script>var a=1</script></div>'],
  ])('script %s → boundary (case 14)', async (_n, before, after) => {
    document.body.innerHTML = P('3:1', 'v1', '', 'A') + before;
    bridge.documentBoundary = vi.fn();
    await morphTo(P('3:1', 'v1', '', 'A') + after);
    expect(bridge.documentBoundary).toHaveBeenCalledWith('shape');
  });

  it('media with the same src keeps its node and children (playback continues)', async () => {
    const V = (cls: string) => `<video data-sq-source="src/pages/index.astro:7:1" data-sq-source-version="v" data-sq-placement="" data-sq-usage="" src="/a.mp4" class="${cls}"><track kind="captions"></video>`;
    document.body.innerHTML = V('a');
    const video = document.querySelector('video')!;
    const track = video.firstChild;
    await morphTo(V('b'));
    expect(document.querySelector('video')).toBe(video);
    expect(video.firstChild).toBe(track);
    expect(video.className).toBe('b');
  });

  it('editor ghost nodes survive a structural morph', async () => {
    document.body.innerHTML = P('3:1', 'v1', '', 'A') + '<div data-drag-ghost="true"></div>';
    await morphTo(P('3:1', 'v2', '', 'A') + P('4:1', 'v2', '', 'B'));
    expect(document.querySelector('[data-drag-ghost]')).not.toBeNull();
    expect(document.querySelectorAll('p')).toHaveLength(2);
  });

  it('a morph that would destroy the element being edited is deferred, never applied', async () => {
    bridge.documentBoundary = vi.fn();
    document.body.innerHTML = `<div data-sq-source="src/layouts/L.astro:2:1" data-sq-source-version="l1" data-sq-placement="" data-sq-usage="">${P('3:1', 'v1', '', 'Typed')}</div>`;
    const edited = document.querySelector('p') as HTMLElement;
    bridge.editingElement = edited;
    await morphTo(`<main data-sq-source="src/layouts/L.astro:2:1" data-sq-source-version="l2" data-sq-placement="" data-sq-usage="">${P('3:1', 'v1', '', 'Typed')}</main>`);
    expect(document.querySelector('p')).toBe(edited);
    expect(document.querySelector('main')).toBeNull();
    expect(bridge.documentBoundary).not.toHaveBeenCalled();
  });

  // ── Layer 2: head carriers (Task 2.2) ──
  const pageWithHead = (head: string, body: string) => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
  const S = (id: string, css: string) => `<style type="text/css" data-vite-dev-id="${id}">${css}</style>`;
  const morphPage = async (head: string, body: string) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(pageWithHead(head, body)))); reload(); await bridge._refreshDone;
  };

  it('adds a new component style before the body changes; updates changed style text; title follows', async () => {
    document.head.innerHTML = '<title>Old</title>' + S('/a.css', '.a{}');
    document.body.innerHTML = P('3:1', 'v1', '', 'A');
    let styleSeenWhenBodyChanged = false;
    const obs = new MutationObserver(() => { if (document.querySelectorAll('p').length === 2) styleSeenWhenBodyChanged = !!document.querySelector('style[data-vite-dev-id="/b.css"]'); });
    obs.observe(document.body, { childList: true });
    await morphPage('<title>New</title>' + S('/a.css', '.a{color:red}') + S('/b.css', '.b{}'), P('3:1', 'v2', '', 'A') + P('4:1', 'v2', '', 'B'));
    await Promise.resolve(); obs.disconnect();
    expect(styleSeenWhenBodyChanged).toBe(true);
    expect(document.querySelector('style[data-vite-dev-id="/a.css"]')!.textContent).toBe('.a{color:red}');
    expect(document.title).toBe('New');
  });

  it('a keyed inline style (component view backdrop) follows the fresh text (owner 2026-10-10)', async () => {
    const B = (css: string) => `<style data-sq-head="backdrop">${css}</style>`;
    document.head.innerHTML = B(':where(html){background:#fff}');
    document.body.innerHTML = P('3:1', 'v1', '', 'A');
    await morphPage(B('html,body{background:#000000 !important}'), P('3:1', 'v2', '', 'A'));
    expect(document.querySelectorAll('style[data-sq-head]')).toHaveLength(1);
    expect(document.querySelector('style[data-sq-head="backdrop"]')!.textContent).toBe('html,body{background:#000000 !important}');
  });

  it('removes a server style the new HTML no longer carries; keeps runtime-injected styles', async () => {
    document.head.innerHTML = S('/a.css', '.a{}') + S('/gone.css', '.g{}');
    bridge.recordServerHead(document);
    document.head.insertAdjacentHTML('beforeend', S('/runtime.css', '.r{}')); // Vite updateStyle, after load
    document.body.innerHTML = P('3:1', 'v1', '', 'A');
    await morphPage(S('/a.css', '.a{}'), P('3:1', 'v2', '', 'A'));
    expect(document.querySelector('style[data-vite-dev-id="/gone.css"]')).toBeNull();
    expect(document.querySelector('style[data-vite-dev-id="/runtime.css"]')).not.toBeNull();
  });

  it('re-fetches project CSS links in head AND body after a refresh; foreign CSS untouched; the stamp is not undone', async () => {
    // The component master view renders the project's CSS as <link>s in the BODY.
    const headLinks = '<link rel="stylesheet" href="/src/fonts.css"><link rel="stylesheet" href="https://cdn.example.com/x.css">';
    const bodyLink = '<div><link rel="stylesheet" href="/src/styles.css"></div>';
    document.head.innerHTML = headLinks;
    document.body.innerHTML = bodyLink + P('3:1', 'v1', 'px-0', 'A');
    const oldBody = document.querySelector('link[href="/src/styles.css"]');
    const cdn = document.head.querySelector('link[href^="https://cdn"]');
    // jsdom never loads stylesheets: answer a stamped link's load like a browser would.
    const loader = new MutationObserver(() => document.querySelectorAll('link[href*="t="]').forEach(l => l.dispatchEvent(new Event('load'))));
    loader.observe(document.documentElement, { childList: true, subtree: true });
    await morphPage(headLinks, bodyLink + P('3:1', 'v2', 'px-0 xl:px-0', 'A'));
    await new Promise(r => setTimeout(r, 0));
    const styles = document.querySelectorAll('link[href^="/src/styles.css"]');
    expect(styles).toHaveLength(1);
    expect(styles[0]).not.toBe(oldBody);
    expect(styles[0].getAttribute('href')).toMatch(/^\/src\/styles\.css\?t=\d+$/);
    expect(document.querySelectorAll('link[href^="/src/fonts.css"]')[0].getAttribute('href')).toMatch(/\?t=\d+$/);
    expect(document.head.querySelector('link[href^="https://cdn"]')).toBe(cdn);
    expect(document.querySelector('p')!.className).toBe('px-0 xl:px-0');
    // A second refresh with the same server HTML refreshes again; it never patches the stamp off.
    await morphPage(headLinks, bodyLink + P('3:1', 'v3', 'px-0', 'A'));
    await new Promise(r => setTimeout(r, 0));
    loader.disconnect();
    expect(document.querySelectorAll('link[href^="/src/styles.css"]')).toHaveLength(1);
    expect(document.querySelector('link[href^="/src/styles.css"]')!.getAttribute('href')).toMatch(/\?t=\d+$/);
  });

  it('a new or changed head script → boundary', async () => {
    document.head.innerHTML = '<script type="module" src="/@vite/client"></script>';
    document.body.innerHTML = P('3:1', 'v1', '', 'A');
    bridge.documentBoundary = vi.fn();
    await morphPage('<script type="module" src="/@vite/client"></script><script>window.x=1</script>', P('3:1', 'v1', '', 'A'));
    expect(bridge.documentBoundary).toHaveBeenCalledWith('shape');
  });

  it('a head script injected at runtime (analytics) does not force a boundary', async () => {
    document.head.innerHTML = '<script type="module" src="/@vite/client"></script><script src="https://example.com/gtag.js"></script>';
    document.body.innerHTML = P('3:1', 'v1', '', 'A');
    bridge.documentBoundary = vi.fn();
    await morphPage('<script type="module" src="/@vite/client"></script>', P('3:1', 'v2', 'b', 'A'));
    expect(bridge.documentBoundary).not.toHaveBeenCalled();
    expect(document.querySelector('p')!.className).toBe('b');
  });

  it('500 consecutive refreshes leave the head node count unchanged (case 40)', async () => {
    document.head.innerHTML = '<title>t</title>' + S('/a.css', '.a{}') + '<meta name="description" content="d">';
    document.body.innerHTML = P('3:1', 'v0', 'c0', 'A');
    const count = document.head.children.length;
    for (let i = 1; i <= 500; i++) await morphPage('<title>t</title>' + S('/a.css', `.a{z-index:${i}}`) + '<meta name="description" content="d">', P('3:1', `v${i}`, `c${i}`, 'A'));
    expect(document.head.children.length).toBe(count);
    expect(document.querySelector('p')!.className).toBe('c500');
  });

  // ── Task 2.5: a morphed document scans exactly like a fresh load (D4/D5) ──
  it('after a structural morph under a #sq-ov override, ELEMENTS_SCANNED equals a fresh load of the same HTML', async () => {
    const before = P('3:1', 'v1', 'file', 'Target');
    const after = P('3:1', 'v2', '', 'Inserted') + P('4:1', 'v2', 'file', 'Target');
    const scanned = (b: HarnessBridge) => vi.mocked(b.sendToParent).mock.calls.map(c => c[0] as { type: string; payload: unknown })
      .filter(m => m.type === 'ELEMENTS_SCANNED').pop()?.payload;
    history.replaceState(null, '', '#sq-ov=' + encodeURIComponent(JSON.stringify({ 'src/pages/index.astro:4:1': 'override' })));
    const live: Array<Record<string, unknown>> = [];
    const stopObservers = () => live.forEach(b => (b.stopMutationObserver as () => void)());
    try {
      // Morphed: loaded with `before`, then refreshed to `after` (the override follows the shifted key).
      document.body.innerHTML = before;
      const morphed = mountBridgeForTest();
      delete (morphed as Partial<HarnessBridge>).scanElements; // the real prototype scan
      morphed._assetMap = {}; (morphed as unknown as { reportContentHeight: () => void }).reportContentHeight = () => {}; live.push(morphed as unknown as Record<string, unknown>);
      vi.stubGlobal('fetch', respond(after));
      reload(); await morphed._refreshDone;
      expect(document.querySelectorAll('p')[1].className).toBe('override');
      const viaMorph = scanned(morphed);
      // Fresh: the same HTML parsed from scratch with the same fragment.
      resetHarnessDom();
      document.body.innerHTML = after;
      const fresh = mountBridgeForTest();
      delete (fresh as Partial<HarnessBridge>).scanElements;
      fresh._assetMap = {}; (fresh as unknown as { reportContentHeight: () => void }).reportContentHeight = () => {}; live.push(fresh as unknown as Record<string, unknown>);
      fresh.preApplyLocalOverrides();
      fresh.scanElements();
      expect((viaMorph as { elements: Array<{ key: string; classes: string }> }).elements.map(e => [e.key, e.classes]))
        .toEqual([['src/pages/index.astro:3:1', ''], ['src/pages/index.astro:4:1', 'file']]); // FILE classes reported (D4 stash)
      expect(viaMorph).toEqual(scanned(fresh));
    } finally { stopObservers(); history.replaceState(null, '', location.pathname); }
  });
});

describe('parent-requested refresh (Task 2.6)', () => {
  beforeEach(() => { resetHarnessDom(); (window as unknown as { __SQ_LOCAL_MODE__: boolean }).__SQ_LOCAL_MODE__ = true; });
  afterEach(() => { history.replaceState(null, '', location.pathname); vi.unstubAllGlobals(); });

  it('REFRESH_FROM_SOURCE re-renders in place instead of navigating', async () => {
    const bridge = mountBridgeForTest();
    document.body.innerHTML = P('3:1', 'v1', 'override', 'Hi');
    vi.stubGlobal('fetch', respond(P('3:1', 'v1', 'file', 'Hi')));
    (bridge as unknown as { handleRefreshFromSource: () => void }).handleRefreshFromSource();
    await bridge._refreshDone;
    expect(document.querySelector('p')!.className).toBe('file');
  });

  it('a fragment sync that DROPS an override refreshes from source (Reset races the fragment)', async () => {
    const bridge = mountBridgeForTest() as HarnessBridge & { handleSyncLocalOverridesFragment: (p: { url: string }) => void };
    const ov = (o: object) => '#sq-ov=' + encodeURIComponent(JSON.stringify(o));
    history.replaceState(null, '', ov({ a: 'x', b: 'y' }));
    bridge.requestSourceRefresh = vi.fn();
    bridge.handleSyncLocalOverridesFragment({ url: location.href.split('#')[0] + ov({ a: 'x', b: 'z' }) }); // edit: no refresh
    expect(bridge.requestSourceRefresh).not.toHaveBeenCalled();
    bridge.handleSyncLocalOverridesFragment({ url: location.href.split('#')[0] + ov({ a: 'x' }) });          // b discarded
    expect(bridge.requestSourceRefresh).toHaveBeenCalledTimes(1);
    expect(location.hash).toBe(ov({ a: 'x' }));
  });
});

describe('gesture and IME guard (Layer 3, cases 21/22)', () => {
  let bridge: HarnessBridge;
  beforeEach(() => {
    resetHarnessDom(); bridge = mountBridgeForTest();
    document.body.innerHTML = P('3:1', 'v1', 'a', 'Hi');
  });
  afterEach(() => { vi.unstubAllGlobals(); });
  const fetched = () => vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;

  it('a refresh requested mid-gesture runs exactly once on pointerup', async () => {
    vi.stubGlobal('fetch', respond(P('3:1', 'v2', 'b', 'Hi')));
    document.dispatchEvent(new Event('pointerdown'));
    reload(); reload();
    await bridge._refreshDone;
    expect(fetched()).toBe(0);
    document.dispatchEvent(new Event('pointerup'));
    await new Promise(r => setTimeout(r, 5)); await bridge._refreshDone;
    expect(fetched()).toBe(1);
    expect(document.querySelector('p')!.className).toBe('b');
  });

  it('a refresh during IME composition runs on compositionend', async () => {
    vi.stubGlobal('fetch', respond(P('3:1', 'v2', 'b', 'Hi')));
    document.dispatchEvent(new Event('compositionstart'));
    reload(); await bridge._refreshDone;
    expect(fetched()).toBe(0);
    document.dispatchEvent(new Event('compositionend'));
    await new Promise(r => setTimeout(r, 5)); await bridge._refreshDone;
    expect(fetched()).toBe(1);
  });

  it('nothing runs while a flow drag is active', async () => {
    vi.stubGlobal('fetch', respond(P('3:1', 'v2', 'b', 'Hi')));
    (bridge as unknown as { _flowDrag: { _state: unknown } })._flowDrag = { _state: {} };
    reload(); await bridge._refreshDone;
    await new Promise(r => setTimeout(r, 300));
    expect(fetched()).toBe(0);
    (bridge as unknown as { _flowDrag: { _state: unknown } })._flowDrag._state = null;
    document.dispatchEvent(new Event('mouseup'));
    await new Promise(r => setTimeout(r, 5)); await bridge._refreshDone;
    expect(fetched()).toBe(1);
  });
});
