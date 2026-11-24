import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  handleEditModeExited,
  handleTextSelectionChanged,
  handleMarkupChanged,
  handleKeyboardEvent,
} from '../textEditing';
import { makeFakeCtx } from './fakeContext';
import { viteTextWriter } from '@/services/ViteTextWriter';

vi.mock('@/services/ViteTextWriter', () => ({
  viteTextWriter: {
    writeTextUpdate: vi.fn(() => Promise.resolve()),
    isAvailable: vi.fn(() => true),
  },
}));

beforeEach(() => {
  vi.mocked(viteTextWriter.writeTextUpdate).mockClear();
  vi.mocked(viteTextWriter.isAvailable).mockReturnValue(true);
});

describe('EDIT_MODE_EXITED', () => {
  it('always exits edit mode and clears text selection', () => {
    const ctx = makeFakeCtx();
    handleEditModeExited(ctx, { key: 'k', textContent: 'same', originalText: 'same' });
    expect(ctx.actions.exitEditMode).toHaveBeenCalled();
    expect(ctx.actions.clearTextSelection).toHaveBeenCalled();
    expect(ctx.actions.dispatch).not.toHaveBeenCalled();
  });

  it('dispatches UPDATE_INSTANCE_OVERRIDE for instance keys when text changed', () => {
    const ctx = makeFakeCtx();
    handleEditModeExited(ctx, { key: 'el-1:h1-0', textContent: 'new', originalText: 'old' });
    expect(ctx.actions.dispatch).toHaveBeenCalledWith({
      type: 'UPDATE_INSTANCE_OVERRIDE',
      instanceId: 'el-1',
      childId: 'h1-0',
      updates: { text: 'new' },
    });
  });

  it('dispatches UPDATE_SOURCE_TEXT for drawn elements', () => {
    const ctx = makeFakeCtx();
    handleEditModeExited(ctx, { key: 'drawn-abc', textContent: 'new', originalText: 'old' });
    expect(ctx.actions.dispatch).toHaveBeenCalledWith({
      type: 'UPDATE_SOURCE_TEXT',
      sourceKey: 'drawn-abc',
      textContent: 'new',
      originalText: 'old',
    });
  });

  it('writes to source file when the scanned element has a sourceLocation', () => {
    const loc = { file: 'src/pages/index.astro', line: 5, column: 1 };
    const ctx = makeFakeCtx({
      refs: {
        scannedElements: {
          current: [{ key: 'src/pages/index.astro:5:1', sourceLocation: loc }] as never,
        },
      },
    });
    handleEditModeExited(ctx, {
      key: 'src/pages/index.astro:5:1', textContent: 'new', originalText: 'old',
    });
    expect(viteTextWriter.writeTextUpdate).toHaveBeenCalledWith(loc, 'new');
  });

  /**
   * Sibling-tier pin for the class-tier first-edit fix (2026-08-03).
   *
   * The CLASS tier dropped a user's very first edit on an element because its
   * Yjs observer inferred "was this edited?" from a prev/next classes diff, and
   * an edit that CREATES the key looks the same as a registration baseline.
   * The TEXT tier is immune by construction: it writes straight from this
   * commit handler with no prev tier consulted, so a scanned element the doc
   * has never seen writes on the first commit. Pinned so a future "unify the
   * tiers" refactor can't hand text the class tier's bug.
   */
  it('FIRST text commit writes even though the doc has no prior entry for the key', () => {
    const loc = { file: 'src/pages/index.astro', line: 9, column: 3 };
    const ctx = makeFakeCtx({
      refs: {
        scannedElements: {
          current: [{ key: 'src/pages/index.astro:9:3', sourceLocation: loc }] as never,
        },
      },
    });
    expect(ctx.env.doc.getMap('sourceText').has('src/pages/index.astro:9:3')).toBe(false);

    handleEditModeExited(ctx, {
      key: 'src/pages/index.astro:9:3', textContent: 'first', originalText: 'old',
    });

    expect(viteTextWriter.writeTextUpdate).toHaveBeenCalledWith(loc, 'first');
  });
});

describe('TEXT_SELECTION_CHANGED', () => {
  it('sets text selection when there is a selection', () => {
    const ctx = makeFakeCtx();
    handleTextSelectionChanged(ctx, {
      hasSelection: true, selectedText: 'hi', isInsideLink: false,
      existingHref: undefined, existingTarget: undefined, linkKey: undefined,
    });
    expect(ctx.actions.setTextSelection).toHaveBeenCalledWith(expect.objectContaining({
      hasTextSelection: true, selectedText: 'hi',
    }));
  });

  it('clears selection only when LinkBlock is not being interacted with', () => {
    const interacting = makeFakeCtx({ refs: { isLinkInteracting: { current: true } } });
    handleTextSelectionChanged(interacting, { hasSelection: false, isInsideLink: false });
    expect(interacting.actions.clearTextSelection).not.toHaveBeenCalled();

    const idle = makeFakeCtx();
    handleTextSelectionChanged(idle, { hasSelection: false, isInsideLink: false });
    expect(idle.actions.clearTextSelection).toHaveBeenCalled();
  });
});

describe('MARKUP_CHANGED', () => {
  it('instance-child key: takes snapshot and dispatches UPDATE_MARKUP_OVERRIDE', () => {
    const doc = new Y.Doc();
    const ctx = makeFakeCtx({ env: { doc } });
    handleMarkupChanged(ctx, { key: 'el-1:p-0', innerHTML: '<b>x</b>' });
    expect(ctx.actions.takeSnapshot).toHaveBeenCalled();
    expect(ctx.actions.dispatch).toHaveBeenCalledWith({
      type: 'UPDATE_MARKUP_OVERRIDE',
      instanceId: 'el-1',
      selector: 'p-0',
      markup: '<b>x</b>',
    });
  });

  it('source key without sourceLocation: warns about the missing write target, but the doc overlay still persists (snapshot + UPDATE_SOURCE_MARKUP)', () => {
    // Pre-overlay this asserted "no snapshot" — nothing was persisted at all,
    // which was the WC link-loss gap. The doc overlay tier now makes this an
    // undoable doc edit even when no file write is possible.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx = makeFakeCtx();
    handleMarkupChanged(ctx, { key: 'src/pages/index.astro:5:1', innerHTML: '<b>x</b>' });
    expect(ctx.actions.takeSnapshot).toHaveBeenCalled();
    expect(ctx.actions.dispatch).toHaveBeenCalledWith({
      type: 'UPDATE_SOURCE_MARKUP',
      sourceKey: 'src/pages/index.astro:5:1',
      markup: '<b>x</b>',
    });
    expect(viteTextWriter.writeTextUpdate).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('source key with sourceLocation: snapshot + write', () => {
    const loc = { file: 'src/pages/index.astro', line: 5, column: 1 };
    const ctx = makeFakeCtx({
      refs: {
        scannedElements: {
          current: [{ key: 'src/pages/index.astro:5:1', sourceLocation: loc }] as never,
        },
      },
    });
    handleMarkupChanged(ctx, { key: 'src/pages/index.astro:5:1', innerHTML: '<b>x</b>' });
    expect(ctx.actions.takeSnapshot).toHaveBeenCalled();
    expect(viteTextWriter.writeTextUpdate).toHaveBeenCalledWith(loc, '<b>x</b>');
  });
});

describe('KEYBOARD_EVENT', () => {
  it('Escape exits context when in a context', () => {
    const ctx = makeFakeCtx({ refs: { contextKey: { current: 'ctx-1' } } });
    handleKeyboardEvent(ctx, { key: 'Escape' });
    expect(ctx.refs.exitContext.current).toHaveBeenCalled();
  });

  it('Enter on selected leaf enters edit mode', () => {
    const ctx = makeFakeCtx({ refs: { selectedKey: { current: 'k1' } } });
    handleKeyboardEvent(ctx, { key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(ctx.actions.sendEnterEditMode).toHaveBeenCalledWith('k1');
  });

  it('Enter on selected parent drills down to first child', () => {
    const child = { key: 'k1:div-0', parentKey: 'k1', tagName: 'div', classes: '', rect: {} };
    const ctx = makeFakeCtx({
      refs: { selectedKey: { current: 'k1' }, scannedElements: { current: [child] as never } },
    });
    handleKeyboardEvent(ctx, { key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(ctx.refs.enterContext.current).toHaveBeenCalledWith('k1');
    expect(ctx.refs.selectInContext.current).toHaveBeenCalledWith('k1:div-0', expect.anything());
  });

  it('other keys re-dispatch a synthetic keydown on document', () => {
    const ctx = makeFakeCtx();
    const spy = vi.fn();
    document.addEventListener('keydown', spy, { once: true });
    handleKeyboardEvent(ctx, { key: 'z', code: 'KeyZ', metaKey: true, shiftKey: false, ctrlKey: false, altKey: false });
    expect(spy).toHaveBeenCalled();
    expect((spy.mock.calls[0][0] as KeyboardEvent).metaKey).toBe(true);
  });

  it('keeps an auto-repeat an auto-repeat (a held ⌘\\ toggles the sidebars once)', () => {
    const ctx = makeFakeCtx();
    const spy = vi.fn();
    document.addEventListener('keydown', spy, { once: true });
    handleKeyboardEvent(ctx, { key: '\\', code: 'Backslash', metaKey: true, shiftKey: false, ctrlKey: false, altKey: false, repeat: true });
    expect((spy.mock.calls[0][0] as KeyboardEvent).repeat).toBe(true);
  });
});

describe('writer gating (dev: legacy file write is dead — design 2026-06-11 §1.3)', () => {
  // The availability gate lives INSIDE writeTextUpdate (one place, not per
  // call site) — see ViteTextWriter.bugfixes.test.ts for the writer-level
  // proof that an unavailable writer never sends. Handlers just delegate.
  it('delegates to the self-gating writer even when unavailable', () => {
    vi.mocked(viteTextWriter.isAvailable).mockReturnValue(false);
    const loc = { file: 'src/pages/index.astro', line: 5, column: 1 };
    const ctx = makeFakeCtx({
      refs: {
        scannedElements: {
          current: [{ key: 'src/pages/index.astro:5:1', sourceLocation: loc }] as never,
        },
      },
    });
    handleEditModeExited(ctx, {
      key: 'src/pages/index.astro:5:1', textContent: 'new', originalText: 'old',
    });
    expect(viteTextWriter.writeTextUpdate).toHaveBeenCalledWith(loc, 'new');
    // Yjs persistence happens regardless of writer availability
    expect(ctx.actions.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'UPDATE_SOURCE_TEXT' }),
    );
  });

  it('MARKUP_CHANGED also delegates to the self-gating writer', () => {
    vi.mocked(viteTextWriter.isAvailable).mockReturnValue(false);
    const loc = { file: 'src/pages/index.astro', line: 5, column: 1 };
    const ctx = makeFakeCtx({
      refs: {
        scannedElements: {
          current: [{ key: 'src/pages/index.astro:5:1', sourceLocation: loc }] as never,
        },
      },
    });
    handleMarkupChanged(ctx, { key: 'src/pages/index.astro:5:1', innerHTML: '<b>x</b>' });
    expect(viteTextWriter.writeTextUpdate).toHaveBeenCalledWith(loc, '<b>x</b>');
  });
});
