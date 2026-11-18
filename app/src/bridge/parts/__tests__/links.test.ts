/**
 * Harness tests for BRIDGE_LINKS (invariant LI-3, task-049).
 *
 * Every early-return branch of handleWrapSelectionInLink is exercised
 * directly; the contract under test is: a failed wrap sends NO
 * MARKUP_CHANGED (so the parent never takes an undo snapshot — see
 * design D1 / the deferred-snapshot fix in ViewportFrame), and a
 * successful wrap/unwrap sends exactly one.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

function sentTypes(bridge: HarnessBridge): string[] {
  return (bridge.sendToParent as ReturnType<typeof vi.fn>).mock.calls.map(
    (c) => (c[0] as { type: string }).type,
  );
}

function markupChangedCalls(bridge: HarnessBridge) {
  return (bridge.sendToParent as ReturnType<typeof vi.fn>).mock.calls
    .map((c) => c[0] as { type: string; payload: Record<string, unknown> })
    .filter((m) => m.type === 'MARKUP_CHANGED');
}

function selectRange(range: Range) {
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

describe('handleWrapSelectionInLink early returns (LI-3)', () => {
  let bridge: HarnessBridge;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetHarnessDom();
    window.getSelection()?.removeAllRanges();
    bridge = mountBridgeForTest();
    // ELEMENT_CLICK re-selection (rAF inside scanThen) is not under test here.
    bridge.scanThen = vi.fn();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('no selection and no saved range → no MARKUP_CHANGED', () => {
    document.body.innerHTML = '<p data-key="el-abc:p-0">hello world</p>';

    bridge.handleWrapSelectionInLink({ key: 'el-abc:p-0', href: '/x' });

    expect(sentTypes(bridge)).toEqual([]);
    expect(warn).toHaveBeenCalledWith('[Link] No valid range available');
  });

  it('cross-boundary selection (disjoint parents) → no MARKUP_CHANGED', () => {
    document.body.innerHTML =
      '<p data-key="el-abc:p-0"><b>bold</b><i>italic</i></p>';
    const b = document.querySelector('b')!.firstChild!;
    const i = document.querySelector('i')!.firstChild!;
    const range = document.createRange();
    range.setStart(b, 1);
    range.setEnd(i, 3);
    selectRange(range);

    bridge.handleWrapSelectionInLink({ key: 'el-abc:p-0', href: '/x' });

    expect(sentTypes(bridge)).toEqual([]);
  });

  it('element not found for key → no MARKUP_CHANGED', () => {
    document.body.innerHTML = '<p data-key="el-other:p-0">hello world</p>';
    const text = document.querySelector('p')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 5);
    selectRange(range);

    bridge.handleWrapSelectionInLink({ key: 'el-missing:p-0', href: '/x' });

    expect(sentTypes(bridge)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      '[Link] Parent element not found for key:',
      'el-missing:p-0',
    );
  });

  it('surroundContents throws (partially-selected non-text node) → no MARKUP_CHANGED, contentEditable restored', () => {
    document.body.innerHTML =
      '<p data-key="el-abc:p-0"><b>bold</b> tail text</p>';
    const p = document.querySelector('p')!;
    const boldText = p.querySelector('b')!.firstChild!;
    const tailText = p.childNodes[1]!;
    // Starts inside <b>, ends outside it: surroundContents must throw per
    // spec (partially selected non-Text node). Parent containment keeps the
    // cross-boundary guard from short-circuiting first.
    const range = document.createRange();
    range.setStart(boldText, 1);
    range.setEnd(tailText, 4);
    selectRange(range);

    bridge.handleWrapSelectionInLink({ key: 'el-abc:p-0', href: '/x' });

    expect(sentTypes(bridge)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      '[Link] surroundContents failed:',
      expect.any(String),
    );
    expect((p as HTMLElement).contentEditable).toBe('false');
    expect(p.querySelector('a')).toBeNull();
  });
});

describe('handleWrapSelectionInLink happy path (LI-3)', () => {
  let bridge: HarnessBridge;

  beforeEach(() => {
    resetHarnessDom();
    window.getSelection()?.removeAllRanges();
    bridge = mountBridgeForTest();
    bridge.scanThen = vi.fn();
  });

  it('wraps the range, mints <instanceId>:a-N key, sends MARKUP_CHANGED with linkKey/href/target', () => {
    document.body.innerHTML = '<p data-key="el-abc:p-0">hello world</p>';
    const text = document.querySelector('p')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 5);
    selectRange(range);

    bridge.handleWrapSelectionInLink({
      key: 'el-abc:p-0',
      href: '/about',
      target: '_blank',
    });

    const link = document.querySelector('a')!;
    expect(link).not.toBeNull();
    expect(link.getAttribute('data-key')).toBe('el-abc:a-0');
    expect(link.textContent).toBe('hello');

    const changed = markupChangedCalls(bridge);
    expect(changed).toHaveLength(1);
    expect(changed[0].payload).toMatchObject({
      key: 'el-abc:p-0',
      linkKey: 'el-abc:a-0',
      href: '/about',
      target: '_blank',
    });
    // sanitizeLinkHtml strips class from <a> but keeps the wrap
    expect(changed[0].payload.innerHTML).toContain('<a');
  });

  it('mints the next free a-N index when links already exist', () => {
    document.body.innerHTML =
      '<p data-key="el-abc:p-0"><a data-key="el-abc:a-0" href="/old">one</a> hello world</p>';
    const tail = document.querySelector('p')!.childNodes[1]!;
    const range = document.createRange();
    range.setStart(tail, 1);
    range.setEnd(tail, 6);
    selectRange(range);

    bridge.handleWrapSelectionInLink({ key: 'el-abc:p-0', href: '/new' });

    const changed = markupChangedCalls(bridge);
    expect(changed).toHaveLength(1);
    expect(changed[0].payload.linkKey).toBe('el-abc:a-1');
  });
});

describe('handleUnwrapLink (LI-3)', () => {
  let bridge: HarnessBridge;

  beforeEach(() => {
    resetHarnessDom();
    window.getSelection()?.removeAllRanges();
    bridge = mountBridgeForTest();
  });

  it('removes the <a>, keeps its children, sends exactly one MARKUP_CHANGED', () => {
    document.body.innerHTML =
      '<p data-key="el-abc:p-0">before <a data-key="el-abc:a-0" href="/x"><b>kept</b></a> after</p>';

    bridge.handleUnwrapLink({ key: 'el-abc:p-0', linkSelector: 'el-abc:a-0' });

    const p = document.querySelector('p')!;
    expect(p.querySelector('a')).toBeNull();
    expect(p.querySelector('b')!.textContent).toBe('kept');

    const changed = markupChangedCalls(bridge);
    expect(changed).toHaveLength(1);
    expect(changed[0].payload.key).toBe('el-abc:p-0');
    expect(String(changed[0].payload.innerHTML)).not.toContain('<a');
  });

  it('element not found → no MARKUP_CHANGED', () => {
    document.body.innerHTML = '<p data-key="el-abc:p-0">text</p>';

    bridge.handleUnwrapLink({ key: 'el-missing:p-0' });

    expect(sentTypes(bridge)).toEqual([]);
  });

  it('no link inside the element → no MARKUP_CHANGED', () => {
    document.body.innerHTML = '<p data-key="el-abc:p-0">no links here</p>';

    bridge.handleUnwrapLink({ key: 'el-abc:p-0', linkSelector: 'el-abc:a-0' });

    expect(sentTypes(bridge)).toEqual([]);
  });
});

describe('sanitizeLinkHtml (defense-in-depth used by both senders)', () => {
  let bridge: HarnessBridge;

  beforeEach(() => {
    resetHarnessDom();
    bridge = mountBridgeForTest();
  });

  it('strips event handlers, javascript: hrefs, link classes, and <script>', () => {
    const out = bridge.sanitizeLinkHtml(
      '<a class="x" href="javascript:alert(1)" onclick="evil()">a</a><script>evil()</script><span onfocus="evil()">s</span>',
    );
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('onfocus');
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('class=');
    expect(out).toContain('<a>a</a>');
  });
});
