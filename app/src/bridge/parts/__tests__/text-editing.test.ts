/**
 * Harness tests for BRIDGE_TEXT_EDITING (invariants TI-1/TI-2, task-049).
 *
 * Chosen semantics (design §8 Q3 addendum, 2026-06-11): the baseline used
 * by RESTORE_ORIGINAL_TEXT is the SOURCE text. The parent passes the
 * authoritative pre-override text as `originalText` in the ENTER_EDIT_MODE
 * payload (it owns staticMarkup); the bridge stores it unconditionally.
 * First-seen-DOM capture survives only as a fallback when the parent
 * cannot resolve a source baseline (e.g. drawn elements).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';
import { BRIDGE_HEAD_CONSTANTS } from '../head';

describe('originalTextByKey baseline (TI-1/TI-2)', () => {
  let bridge: HarnessBridge;

  beforeEach(() => {
    resetHarnessDom();
    window.getSelection()?.removeAllRanges();
    bridge = mountBridgeForTest();
  });

  function exitEditMode() {
    // The harness stubs exitEditModeCleanup; reset the state it would clear.
    bridge.editingElement = null;
    bridge.originalTextContent = null;
  }

  it('TI-1: baseline reflects source text even when first edit happens on an already-overridden DOM', () => {
    // Reload-with-override scenario: DOM already shows the overridden text
    // when the first edit session starts.
    document.body.innerHTML = '<p data-key="el-abc:p-0">OVERRIDDEN text</p>';
    const p = document.querySelector('p')! as HTMLElement;

    bridge.handleEnterEditMode({ key: 'el-abc:p-0', originalText: 'source text' });
    exitEditMode();

    p.textContent = 'OVERRIDDEN text';
    bridge.handleRestoreOriginalText({ key: 'el-abc:p-0' });

    expect(p.textContent).toBe('source text');
  });

  it('TI-2: second edit session does not clobber the baseline with mid-edit text', () => {
    document.body.innerHTML = '<p data-key="el-abc:p-0">source text</p>';
    const p = document.querySelector('p')! as HTMLElement;

    bridge.handleEnterEditMode({ key: 'el-abc:p-0', originalText: 'source text' });
    exitEditMode();
    p.textContent = 'first edit';

    // Second session: DOM shows the first edit; parent still knows the source.
    bridge.handleEnterEditMode({ key: 'el-abc:p-0', originalText: 'source text' });
    exitEditMode();
    p.textContent = 'second edit';

    bridge.handleRestoreOriginalText({ key: 'el-abc:p-0' });
    expect(p.textContent).toBe('source text');
  });

  it('TI-2: a refreshed parent baseline (source changed between sessions) replaces the stale one', () => {
    document.body.innerHTML = '<p data-key="el-abc:p-0">old source</p>';
    const p = document.querySelector('p')! as HTMLElement;

    bridge.handleEnterEditMode({ key: 'el-abc:p-0', originalText: 'old source' });
    exitEditMode();

    // Source itself changed (e.g. push-to-source); parent sends the new baseline.
    bridge.handleEnterEditMode({ key: 'el-abc:p-0', originalText: 'new source' });
    exitEditMode();

    p.textContent = 'edited';
    bridge.handleRestoreOriginalText({ key: 'el-abc:p-0' });
    expect(p.textContent).toBe('new source');
  });

  it('fallback: without originalText in the payload, first-seen DOM text is captured once (legacy behavior pinned)', () => {
    document.body.innerHTML = '<p data-key="drawn-1">drawn text</p>';
    const p = document.querySelector('p')! as HTMLElement;

    bridge.handleEnterEditMode({ key: 'drawn-1' });
    exitEditMode();

    p.textContent = 'edited drawn';
    bridge.handleRestoreOriginalText({ key: 'drawn-1' });
    expect(p.textContent).toBe('drawn text');
  });

  it('RESTORE_ORIGINAL_TEXT is a no-op for keys with no captured baseline', () => {
    document.body.innerHTML = '<p data-key="el-abc:p-0">untouched</p>';
    const p = document.querySelector('p')! as HTMLElement;

    bridge.handleRestoreOriginalText({ key: 'el-abc:p-0' });
    expect(p.textContent).toBe('untouched');
  });

  it('handleEnterEditMode still sets per-session originalTextContent from the DOM (change detection)', () => {
    document.body.innerHTML = '<p data-key="el-abc:p-0">current dom text</p>';

    bridge.handleEnterEditMode({ key: 'el-abc:p-0', originalText: 'source text' });

    // Per-session change detection (EDIT_MODE_EXITED textContent !== originalText)
    // must keep using the session-start DOM text, NOT the source baseline.
    expect(bridge.originalTextContent).toBe('current dom text');
    expect(bridge.originalTextByKey['el-abc:p-0']).toBe('source text');
  });
});

describe('line breaks inside edited text (personal-site hero, 2026-09-14)', () => {
  let bridge: HarnessBridge;
  beforeEach(() => { resetHarnessDom(); bridge = mountBridgeForTest(); });

  it('the scanner never keys a <br>, so a line-break paragraph is a text leaf, not a container', () => {
    // The harness scan stamps no keys; assert the skip list contract directly.
    expect(BRIDGE_HEAD_CONSTANTS).toMatch(/var SKIP_TAGS = \['br', 'wbr',/);
    document.body.innerHTML = '<p data-key="src/pages/about.astro:45:5">Oleg.<br>Designer.</p>';
    expect(bridge.hasBlockChildren(document.querySelector('p')!)).toBe(false);
    document.body.innerHTML = '<div data-key="a"><p data-key="a:p-0">x</p></div>';
    expect(bridge.hasBlockChildren(document.querySelector('div')!)).toBe(true);
  });

  it('undo restores the line-break markup, not flattened text', () => {
    document.body.innerHTML = '<p data-key="k">Oleg.<br>Designer.</p>';
    bridge.handleEnterEditMode({ key: 'k', originalText: 'Oleg.Designer.' });
    bridge.editingElement = null; bridge.originalTextContent = null;
    const p = document.querySelector('p')! as HTMLElement;
    p.innerHTML = 'Oleg.<br>Designer. Hi';
    bridge.handleRestoreOriginalText({ key: 'k' });
    expect(p.innerHTML).toBe('Oleg.<br>Designer.');
  });

  it('committing such a paragraph sends its inner markup (line breaks kept, editor attributes stripped) and no plain-text write', () => {
    document.body.innerHTML = '<p data-key="src/pages/about.astro:45:5">Oleg.<br data-key="src/pages/about.astro:46:22" data-sq-source="x">Designer.</p>';
    const p = document.querySelector('p')! as HTMLElement;
    expect(bridge.editedInlineMarkup(p)).toBe('Oleg.<br>Designer.');
    // Outside local projects (WC) a link-bearing element keeps its link-carrier path; plain text stays exact.
    document.body.innerHTML = '<p data-key="k">Hi <a href="/x">there</a></p>';
    expect(bridge.editedInlineMarkup(document.querySelector('p')!)).toBeNull();
    document.body.innerHTML = '<p data-key="k">plain</p>';
    expect(bridge.editedInlineMarkup(document.querySelector('p')!)).toBeNull();
  });
});

describe('inline editing edits text, never structure (audit #3, #38, #40)', () => {
  type Bridge = HarnessBridge & { exitEditModeCleanup: () => void; handleMouseDown: (e: MouseEvent) => void };
  let bridge: Bridge;
  beforeEach(() => { resetHarnessDom(); bridge = mountBridgeForTest() as Bridge; });
  const sent = (type: string) => (bridge.sendToParent as ReturnType<typeof vi.fn>).mock.calls
    .map((c) => c[0] as { type: string; payload: Record<string, unknown> }).filter((m) => m.type === type);
  const HEADING = '<h1 data-key="src/pages/index.astro:8:5">Build <span class="text-indigo-600" data-sq-source="src/pages/index.astro:8:15">faster</span> sites</h1>';

  it('#3: typing in text with an inline <span> commits its markup, span kept, and no flattened text write', () => {
    document.body.innerHTML = HEADING;
    const h1 = document.querySelector('h1')!;
    bridge.handleEnterEditMode({ key: 'src/pages/index.astro:8:5' });
    h1.lastChild!.textContent = ' sites today'; // the user types at the end
    bridge.exitEditModeCleanup();
    expect(sent('MARKUP_CHANGED').map((m) => m.payload)).toEqual([
      { key: 'src/pages/index.astro:8:5', innerHTML: 'Build <span class="text-indigo-600">faster</span> sites today' },
    ]);
    const exited = sent('EDIT_MODE_EXITED')[0].payload;
    expect(exited.originalText).toBe(exited.textContent); // reports unchanged: no plain-text copy written over it
  });

  it('#3: undo of such an edit puts the inline markup back, not flattened text', () => {
    document.body.innerHTML = HEADING;
    const h1 = document.querySelector('h1')!;
    bridge.handleEnterEditMode({ key: 'src/pages/index.astro:8:5', originalText: 'Build faster sites' });
    bridge.editingElement = null; bridge.originalTextContent = null;
    h1.textContent = 'Build faster sites today';
    bridge.handleRestoreOriginalText({ key: 'src/pages/index.astro:8:5' });
    expect(h1.querySelector('span.text-indigo-600')?.textContent).toBe('faster');
  });

  it('#3: a link inside edited text keeps its exact markup, class included (local projects)', () => {
    (window as { __SQ_LOCAL_MODE__?: boolean }).__SQ_LOCAL_MODE__ = true;
    try {
      document.body.innerHTML = '<p data-key="src/pages/index.astro:9:5">Read <a href="/docs" class="underline" data-sq-source="src/pages/index.astro:9:13">docs</a> now</p>';
      const p = document.querySelector('p')!;
      bridge.handleEnterEditMode({ key: 'src/pages/index.astro:9:5' });
      p.lastChild!.textContent = ' now please';
      bridge.exitEditModeCleanup();
      expect(sent('MARKUP_CHANGED').map((m) => m.payload)).toEqual([
        { key: 'src/pages/index.astro:9:5', innerHTML: 'Read <a href="/docs" class="underline">docs</a> now please' },
      ]);
    } finally {
      delete (window as { __SQ_LOCAL_MODE__?: boolean }).__SQ_LOCAL_MODE__;
    }
  });

  it('#38: the edited element accepts plain text only, so ⌘B/⌘I cannot add formatting that is never saved', () => {
    document.body.innerHTML = HEADING;
    bridge.handleEnterEditMode({ key: 'src/pages/index.astro:8:5' });
    expect(document.querySelector('h1')!.contentEditable).toBe('plaintext-only');
  });

  it('#40: the second mousedown of a double-click outside edit mode starts no word selection; inside it, it does', () => {
    document.body.innerHTML = HEADING;
    const dbl = () => new MouseEvent('mousedown', { detail: 2, cancelable: true, clientX: 1, clientY: 1 });
    const outside = dbl();
    bridge.handleMouseDown(outside);
    expect(outside.defaultPrevented).toBe(true);
    bridge.handleEnterEditMode({ key: 'src/pages/index.astro:8:5' });
    const inside = dbl();
    bridge.handleMouseDown(inside);
    expect(inside.defaultPrevented).toBe(false);
  });
});
