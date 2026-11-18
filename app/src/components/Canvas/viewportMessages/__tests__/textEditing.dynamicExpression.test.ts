/**
 * A text edit on an element whose source is an Astro expression
 * (`<p>{work.data.description}</p>`, shown as a stub in the component view)
 * is REFUSED by the plugin. Before 2026-09-10 the refusal was a console.error:
 * the canvas kept the typed text, the doc kept it as an override (which the
 * page view's scan re-apply would paint over the real value), and the user
 * learned nothing. Now: the reason is toasted (it names the Source tab), the
 * override is dropped, the frame restores the rendered value.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';
import toast from 'react-hot-toast';
import { handleEditModeExited } from '../textEditing';
import { makeFakeCtx, makeFakeIframe } from './fakeContext';
import { applyCommand } from '@/store/commands';
import { viteTextWriter } from '@/services/ViteTextWriter';

vi.mock('@/services/ViteTextWriter', () => ({
  viteTextWriter: { writeTextUpdate: vi.fn(), isAvailable: vi.fn(() => true) },
}));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { default: t };
});

const KEY = 'src/components/FeaturedWork.astro:60:17';
const LOC = { file: 'src/components/FeaturedWork.astro', line: 60, column: 17 };
const STUB = 'Sample description text for this placeholder entry.';
const REASON = 'text is a dynamic expression ({…}) — edit it in the Source tab';
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.mocked(viteTextWriter.writeTextUpdate).mockReset();
  vi.mocked(toast.error).mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

function setup() {
  const doc = new Y.Doc();
  const { iframe, postMessage } = makeFakeIframe();
  const ctx = makeFakeCtx({
    env: { doc, projectId: 'browser_lf_dyn' },
    refs: { iframe, scannedElements: { current: [{ key: KEY, parentKey: null, tagName: 'p', classes: '', rect: { top: 0, left: 0, width: 1, height: 1 }, sourceLocation: LOC }] } as never },
    actions: { dispatch: vi.fn((cmd) => applyCommand(doc, cmd as never)) },
  });
  return { doc, ctx, postMessage };
}

describe('EDIT_MODE_EXITED on a dynamic-expression element', () => {
  it('toasts the reason, drops the override and restores the frame text', async () => {
    vi.mocked(viteTextWriter.writeTextUpdate).mockRejectedValue(new Error(REASON));
    const { doc, ctx, postMessage } = setup();
    handleEditModeExited(ctx, { key: KEY, textContent: `${STUB} ZZQ`, originalText: STUB });
    expect(doc.getMap('sourceText').has(KEY)).toBe(true); // carrier until the write settles
    await flush();
    expect(toast.error).toHaveBeenCalledWith(REASON);
    expect(doc.getMap('sourceText').has(KEY)).toBe(false);
    expect(postMessage).toHaveBeenCalledWith({ type: 'RESTORE_ORIGINAL_TEXT', payload: { key: KEY } }, '*');
  });

  it('any other write failure stays a console error with the override kept (unchanged behaviour)', async () => {
    vi.mocked(viteTextWriter.writeTextUpdate).mockRejectedValue(new Error('Could not find closing tag for p'));
    const { doc, ctx, postMessage } = setup();
    handleEditModeExited(ctx, { key: KEY, textContent: 'New', originalText: STUB });
    await flush();
    expect(toast.error).not.toHaveBeenCalled();
    expect(doc.getMap('sourceText').has(KEY)).toBe(true);
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'RESTORE_ORIGINAL_TEXT' }), '*');
  });
});
