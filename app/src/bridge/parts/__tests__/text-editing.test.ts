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
    // A link-bearing element keeps its link-carrier path; plain text stays exact.
    document.body.innerHTML = '<p data-key="k">Hi <a href="/x">there</a></p>';
    expect(bridge.editedInlineMarkup(document.querySelector('p')!)).toBeNull();
    document.body.innerHTML = '<p data-key="k">plain</p>';
    expect(bridge.editedInlineMarkup(document.querySelector('p')!)).toBeNull();
  });
});
