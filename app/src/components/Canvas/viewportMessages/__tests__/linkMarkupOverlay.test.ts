/**
 * WC/local parity — inline link create/unwrap persistence (gap: MARKUP_CHANGED
 * had no doc-overlay tier) and the sourceLinkAttributes scan re-apply (gap:
 * any preview reload dropped link overrides from the DOM).
 *
 * Both halves fail before the fix:
 * - handleMarkupChanged's source branch wrote ONLY through viteTextWriter
 *   (a silent no-op in WC) — no doc dispatch, so the link vanished on reload.
 * - handleElementsScanned re-applied sourceText/sourceClasses/
 *   sourceImageAttributes but never sourceLinkAttributes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleMarkupChanged } from '../textEditing';
import { handleElementsScanned } from '../scanning';
import { makeFakeCtx, makeFakeIframe } from './fakeContext';
import { applyCommand } from '@/store/commands';
import { viteTextWriter } from '@/services/ViteTextWriter';
import { noteLinkKeyMove } from '@/utils/linkSource';

vi.mock('@/services/ViteTextWriter', () => ({
  viteTextWriter: {
    writeTextUpdate: vi.fn(() => Promise.resolve()),
    isAvailable: vi.fn(() => true),
  },
}));

beforeEach(() => {
  vi.mocked(viteTextWriter.writeTextUpdate).mockClear();
});

const KEY = 'src/components/Hero.astro:5:1';
const MARKUP = 'Visit <a href="/about">our team</a> today';

const el = (key: string) => ({
  key, parentKey: null, tagName: 'p', classes: '',
  rect: { top: 0, left: 0, width: 10, height: 10 },
});

describe('MARKUP_CHANGED source branch (doc overlay tier)', () => {
  it('dispatches UPDATE_SOURCE_MARKUP even when the element has no sourceLocation (WC)', () => {
    const ctx = makeFakeCtx();
    handleMarkupChanged(ctx, { key: KEY, innerHTML: MARKUP });
    expect(ctx.actions.takeSnapshot).toHaveBeenCalled();
    expect(ctx.actions.dispatch).toHaveBeenCalledWith({
      type: 'UPDATE_SOURCE_MARKUP', sourceKey: KEY, markup: MARKUP,
    });
    // No sourceLocation → no file write attempted
    expect(viteTextWriter.writeTextUpdate).not.toHaveBeenCalled();
  });

  it('dispatches the overlay AND still writes the file when a sourceLocation exists (local/server)', () => {
    const loc = { file: 'src/components/Hero.astro', line: 5, column: 1 };
    const ctx = makeFakeCtx({
      refs: { scannedElements: { current: [{ ...el(KEY), sourceLocation: loc }] } as never },
    });
    handleMarkupChanged(ctx, { key: KEY, innerHTML: MARKUP });
    expect(ctx.actions.dispatch).toHaveBeenCalledWith({
      type: 'UPDATE_SOURCE_MARKUP', sourceKey: KEY, markup: MARKUP,
    });
    expect(viteTextWriter.writeTextUpdate).toHaveBeenCalledWith(loc, MARKUP);
  });
});

describe('ELEMENTS_SCANNED sourceLinkAttributes re-apply', () => {
  it('never repaints a stored link attribute: the file is the link, an old doc value would shadow it', () => {
    const { iframe, postMessage } = makeFakeIframe();
    const ctx = makeFakeCtx({ refs: { iframe } });
    applyCommand(ctx.env.doc, {
      type: 'UPDATE_LINK_ATTRIBUTE', elementId: KEY, attribute: 'href', value: '/pricing',
    });

    handleElementsScanned(ctx, { elements: [el(KEY)] });

    const sent = postMessage.mock.calls.map((c) => c[0] as { type: string });
    expect(sent.some((m) => m.type === 'UPDATE_LINK_ATTRIBUTE')).toBe(false);
  });

  it('re-posts a stored markup override as UPDATE_SOURCE_MARKUP', () => {
    const { iframe, postMessage } = makeFakeIframe();
    const ctx = makeFakeCtx({ refs: { iframe } });
    applyCommand(ctx.env.doc, { type: 'UPDATE_SOURCE_MARKUP', sourceKey: KEY, markup: MARKUP });

    handleElementsScanned(ctx, { elements: [el(KEY)] });

    expect(postMessage).toHaveBeenCalledWith(
      { type: 'UPDATE_SOURCE_MARKUP', payload: { key: KEY, markup: MARKUP } },
      '*',
    );
  });

  it('skips entries whose key is not in the scan (stale/other page) and never posts the bookkeeping field as an attribute', () => {
    const { iframe, postMessage } = makeFakeIframe();
    const ctx = makeFakeCtx({ refs: { iframe } });
    applyCommand(ctx.env.doc, { type: 'UPDATE_SOURCE_MARKUP', sourceKey: KEY, markup: MARKUP });
    applyCommand(ctx.env.doc, {
      type: 'UPDATE_LINK_ATTRIBUTE',
      elementId: 'src/pages/other.astro:9:1', attribute: 'href', value: '/gone',
    });

    handleElementsScanned(ctx, { elements: [el(KEY)] });

    const sent = postMessage.mock.calls.map((c) => c[0] as { type: string; payload?: { key?: string; attribute?: string } });
    expect(sent.some((m) => m.payload?.key === 'src/pages/other.astro:9:1')).toBe(false);
    expect(sent.some((m) => m.type === 'UPDATE_LINK_ATTRIBUTE' && m.payload?.key === KEY)).toBe(false);
  });

  it('suppresses the markup re-apply during a live text-edit session (never clobber the caret)', () => {
    const { iframe, postMessage } = makeFakeIframe();
    const ctx = makeFakeCtx({ refs: { iframe, isEditingText: { current: true } } });
    applyCommand(ctx.env.doc, { type: 'UPDATE_SOURCE_MARKUP', sourceKey: KEY, markup: MARKUP });

    handleElementsScanned(ctx, { elements: [el(KEY)] });

    const sent = postMessage.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(sent).not.toContain('UPDATE_SOURCE_MARKUP');
  });
});

describe('a link edit moves the selected element', () => {
  const OLD = 'src/pages/zz.astro:7:5';
  const NEW = 'src/pages/zz.astro:7:17';

  it('the new <a> takes its key: the selection stays on the element, not on the <a>', () => {
    noteLinkKeyMove(OLD, NEW, 'p');
    const select = vi.fn();
    const ctx = makeFakeCtx({ refs: { selectedKey: { current: OLD }, selectInContext: { current: select } } as never });
    handleElementsScanned(ctx, { elements: [{ ...el(OLD), tagName: 'a' }, el(NEW)] });
    expect(select).toHaveBeenCalledWith(NEW, expect.objectContaining({ tagName: 'p' }));
  });

  it('⌘Z takes the key away: the selection comes back with the element', () => {
    noteLinkKeyMove(OLD, NEW, 'p');
    const select = vi.fn();
    const ctx = makeFakeCtx({ refs: { selectedKey: { current: NEW }, selectInContext: { current: select } } as never });
    handleElementsScanned(ctx, { elements: [el(OLD)] });
    expect(select).toHaveBeenCalledWith(OLD, expect.objectContaining({ tagName: 'p' }));
  });
});
