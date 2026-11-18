/**
 * Agent edits on the canvas (docs/plans/2026-11-10-agent-canvas-flash-design.md,
 * ledger A): after a source refresh the bridge reports WHICH elements the
 * morph changed (SOURCE_CHANGED { keys }). It never decides whose edit
 * it was — the editor does.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

const page = (body: string) => `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;
const reload = () => (window as unknown as { __SQ_VITE_RELOAD__: (r: string) => boolean }).__SQ_VITE_RELOAD__('reload');
const el = (tag: string, src: string, attrs: string, inner: string, usage = '') =>
  `<${tag} data-sq-source="${src}" data-sq-placement="" data-sq-usage="${usage}" ${attrs}>${inner}</${tag}>`;
const I = (line: number) => `src/pages/index.astro:${line}:1`;

type Sent = { type: string; payload?: { keys: string[] } };
const changed = (b: HarnessBridge) => (b.sendToParent as ReturnType<typeof vi.fn>).mock.calls
  .map(c => c[0] as Sent).filter(m => m.type === 'SOURCE_CHANGED').map(m => m.payload!);

describe('SOURCE_CHANGED — what the morph changed', () => {
  let bridge: HarnessBridge;
  const serve = (body: string) => vi.stubGlobal('fetch', vi.fn(async () => new Response(page(body))));
  const refresh = async (body: string) => { serve(body); reload(); await bridge._refreshDone; };

  beforeEach(() => {
    resetHarnessDom();
    bridge = mountBridgeForTest();
    (window as unknown as { __SQ_LOCAL_MODE__: boolean }).__SQ_LOCAL_MODE__ = true;
    // The real scan stamps a data-key on every tagged element; stand in for it.
    (bridge.scanElements as ReturnType<typeof vi.fn>).mockImplementation(() => {
      document.querySelectorAll('[data-sq-source]:not([data-key])').forEach(n => n.setAttribute('data-key', n.getAttribute('data-sq-source')!));
    });
  });
  afterEach(() => {
    if (bridge._refreshRetry) clearTimeout(bridge._refreshRetry);
    vi.unstubAllGlobals();
  });

  it('A1: a text change reports its element', async () => {
    document.body.innerHTML = el('section', I(1), '', el('h1', I(2), '', 'Old')) ;
    bridge.scanElements();
    await refresh(el('section', I(1), '', el('h1', I(2), '', 'New')));
    expect(changed(bridge)).toEqual([{ keys: [I(2)] }]);
  });

  it('A2: a class change reports the element', async () => {
    document.body.innerHTML = el('p', I(3), 'class="a"', 'Hi');
    bridge.scanElements();
    await refresh(el('p', I(3), 'class="a b"', 'Hi'));
    expect(changed(bridge)[0].keys).toEqual([I(3)]);
  });

  it('A3: line shifts, version stamps and astro scope ids are not changes', async () => {
    document.body.innerHTML = el('p', I(3), 'data-sq-source-version="v1" data-astro-cid-aaa=""', 'Hi');
    bridge.scanElements();
    await refresh(el('p', I(4), 'data-sq-source-version="v2" data-astro-cid-bbb=""', 'Hi'));
    expect(changed(bridge)).toEqual([]);
  });

  it('A3: our own dissolve class is not a change, and the refresh keeps it (live 2026-11-10)', async () => {
    document.body.innerHTML = el('h1', I(6), 'class="text-4xl sq-ai-appear"', 'Hi');
    bridge.scanElements();
    await refresh(el('h1', I(6), 'class="text-4xl"', 'Hi'));
    expect(changed(bridge)).toEqual([]);
    expect(document.querySelector('h1')!.className).toBe('text-4xl sq-ai-appear'); // self-cleans on animationend
  });

  it('A3: an empty style left by an editor animation is not a change (live 2026-11-10)', async () => {
    document.body.innerHTML = el('p', I(8), 'class="mt-4" style=""', 'Hi');
    bridge.scanElements();
    await refresh(el('p', I(8), 'class="mt-4"', 'Hi'));
    expect(changed(bridge)).toEqual([]);
    expect(document.querySelector('p')!.hasAttribute('style')).toBe(false);
  });

  it('A9: nothing changed → no report', async () => {
    document.body.innerHTML = el('p', I(3), '', 'Hi');
    bridge.scanElements();
    await refresh(el('p', I(3), '', 'Hi'));
    expect(changed(bridge)).toEqual([]);
  });

  it('A4: an inserted element reports itself', async () => {
    document.body.innerHTML = el('section', I(1), '', el('p', I(2), '', 'A'));
    bridge.scanElements();
    await refresh(el('section', I(1), '', el('p', I(2), '', 'A') + el('p', I(3), '', 'B')));
    expect(changed(bridge)[0].keys).toEqual([I(3)]);
  });

  it('A5: a removed element reports its parent', async () => {
    document.body.innerHTML = el('section', I(1), '', el('p', I(2), '', 'A') + el('p', I(3), '', 'B'));
    bridge.scanElements();
    await refresh(el('section', I(1), '', el('p', I(2), '', 'A')));
    expect(changed(bridge)[0].keys).toEqual([I(1)]);
  });

  it('A6: a reorder reports the moved element, not its neighbours', async () => {
    const kids = (order: number[]) => order.map(n => el('p', I(n), '', `P${n}`)).join('');
    document.body.innerHTML = el('section', I(1), '', kids([2, 3, 4, 5]));
    bridge.scanElements();
    await refresh(el('section', I(1), '', kids([3, 4, 5, 2])));
    expect(changed(bridge)[0].keys).toEqual([I(2)]);
  });

  it('A6: a removal is not reported as a move of the next sibling', async () => {
    const kids = (order: number[]) => order.map(n => el('p', I(n), '', `P${n}`)).join('');
    document.body.innerHTML = el('section', I(1), '', kids([2, 3, 4]));
    bridge.scanElements();
    await refresh(el('section', I(1), '', kids([2, 4])));
    expect(changed(bridge)[0].keys).toEqual([I(1)]);
  });

  it('a prop changed at the page reports the component element it renders', async () => {
    const C = 'src/components/Hero.astro:5:3';
    document.body.innerHTML = el('h1', C, '', 'Old', I(7));
    bridge.scanElements();
    await refresh(el('h1', C, '', 'New', I(7)));
    expect(changed(bridge)[0]).toEqual({ keys: [C] });
  });

  it('D5: at most 200 keys', async () => {
    const many = (t: string) => Array.from({ length: 250 }, (_, i) => el('p', I(i + 10), '', `${t}${i}`)).join('');
    document.body.innerHTML = many('a');
    bridge.scanElements();
    await refresh(many('b'));
    expect(changed(bridge)[0].keys).toHaveLength(200);
  });

  it('A7: the element being typed in is never reported', async () => {
    document.body.innerHTML = el('p', I(3), '', 'Typing') + el('p', I(4), '', 'Other');
    bridge.scanElements();
    const typing = document.querySelector('p')!;
    (bridge as unknown as { editingElement: Element | null }).editingElement = typing;
    (typing as HTMLElement).setAttribute('data-sq-source-version', 'v1');
    await refresh(el('p', I(3), 'data-sq-source-version="v1"', 'Typing') + el('p', I(4), '', 'Changed'));
    (bridge as unknown as { editingElement: Element | null }).editingElement = null;
    for (const report of changed(bridge)) expect(report.keys).not.toContain(I(3));
  });
});
