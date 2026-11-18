// app/src/bridge/parts/__tests__/streamPreview.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type PreviewBridge = HarnessBridge & {
  handleStreamPreview: (p: { mode: string; targetKey?: string; partial?: string }) => void;
  handleStreamPreviewEnd: (p?: { cancelled?: boolean }) => void;
  handleRender: (p: { components: unknown[] }) => void;
  handleSetPage: (p: { pageId: string | null }) => void;
  reportContentHeight: () => void;
  _sqPreviewFinalize: (trigger?: string) => void;
};

describe('handleStreamPreview', () => {
  let bridge: PreviewBridge;
  beforeEach(() => {
    resetHarnessDom();
    bridge = mountBridgeForTest() as PreviewBridge;
  });

  const container = () => document.querySelector('[data-sq-ai-preview]') as HTMLElement | null;

  it('section mode renders sanitized partial HTML into one preview container', () => {
    bridge.handleStreamPreview({ mode: 'section', partial: "<section class='py-16'><p>hi</p></section>" });
    expect(container()).not.toBeNull();
    expect(container()!.querySelector('p')!.textContent).toBe('hi');
    bridge.handleStreamPreview({ mode: 'section', partial: "<section class='py-16'><p>hi there</p></section>" });
    expect(document.querySelectorAll('[data-sq-ai-preview]')).toHaveLength(1); // reused, not stacked
  });

  it('strips script tags, on* handlers, javascript: hrefs, and scan/selection attrs', () => {
    bridge.handleStreamPreview({
      mode: 'section',
      partial: `<div data-key='k1' data-sq-source='s' data-with-props='true' onclick='x()'><script>bad()</script><a href='javascript:x()'>a</a></div>`,
    });
    const c = container()!;
    expect(c.querySelector('script')).toBeNull();
    expect(c.querySelector('[onclick]')).toBeNull();
    expect(c.querySelector('[data-key]')).toBeNull();
    expect(c.querySelector('[data-sq-source]')).toBeNull();
    expect(c.querySelector('[data-with-props]')).toBeNull();
    expect((c.querySelector('a') as HTMLAnchorElement).getAttribute('href') ?? '').not.toContain('javascript');
  });

  it('preview container is pointer-events:none', () => {
    bridge.handleStreamPreview({ mode: 'section', partial: '<div>x</div>' });
    expect(container()!.style.pointerEvents).toBe('none');
  });

  it('text mode types into the keyed element and marks it; stale key is a no-op', () => {
    document.body.innerHTML = `<h1 data-key='src/a.astro:1:1'>Old</h1>`;
    bridge.handleStreamPreview({ mode: 'text', targetKey: 'src/a.astro:1:1', partial: 'New tex' });
    const h1 = document.querySelector('h1')!;
    expect(h1.textContent).toBe('New tex');
    expect(h1.hasAttribute('data-sq-ai-typing')).toBe(true);
    expect(() => bridge.handleStreamPreview({ mode: 'text', targetKey: 'ghost', partial: 'x' })).not.toThrow();
  });

  // Render handshake (2026-07-23): the old fade-on-END removed the preview
  // BEFORE the committed section's RENDER arrived — visible blank gap
  // (appear → disappear → appear). END now holds the container; the next
  // RENDER (same synchronous pass as the real content) finalizes removal.
  // Regression (2026-07-23, live-caught via [SQ-BLINK] parent logs): some
  // providers emit the tool-call event only AFTER tool execution, so the
  // commit RENDER lands BEFORE the stream's END (RENDER@944489, END@944490).
  // endPending was false at RENDER time → the held-swap never fired → the
  // preview survived NEXT TO the committed content for 2s until the fallback
  // yanked it (doubled design + height snap = the user-visible blink).
  // Regression (2026-07-14): the container inflated the reported content height;
  // nothing re-measured after removal (RENDER measures during the fade, the
  // ResizeObserver path can't shrink) → permanent white gap under new sections.
  it('re-reports content height on preview render and after removal (fallback path)', () => {
    vi.useFakeTimers();
    try {
      const spy = vi.fn();
      bridge.reportContentHeight = spy;
      bridge.handleStreamPreview({ mode: 'section', partial: '<div>x</div>' });
      expect(spy).toHaveBeenCalledTimes(1); // frame grows while streaming
      bridge.handleStreamPreviewEnd();
      vi.advanceTimersByTime(2000); // no RENDER arrives → fallback finalizes
      expect(container()).toBeNull(); // removal completed
      expect(spy).toHaveBeenCalledTimes(2); // fresh measure AFTER removal
    } finally {
      vi.useRealTimers();
    }
  });

  // Regression (2026-07-23): skeleton paint styled EVERY descendant as a gray
  // block — full-width bars, more blocks than real elements. Streamed content
  // now renders real and dissolves in (opacity 0 + blur), with an orbiting
  // stroke on the container (the ring can't live on active-highlight overlays
  // for NEW sections — no element key exists until commit).
  it('renders real content with dissolve-in, no skeleton paint, no badge', () => {
    bridge.handleStreamPreview({ mode: 'section', partial: '<div>a</div><div>b</div>' });
    expect(container()!.querySelector('[data-sq-ai-preview-badge]')).toBeNull();
    expect(container()!.querySelectorAll('[data-sq-ai-preview-content] > div')).toHaveLength(2);
    const css = document.getElementById('sq-ai-preview-style')!.textContent!;
    expect(css).not.toContain('color:transparent');    // skeleton paint is gone
    expect(css).toContain('blur(10px)');               // dissolve-in
  });

  // Regression (2026-07-26): the ring was drawn INSIDE the iframe around this
  // container. It paints outside its own box and the container spans the page
  // width, so both side strokes died at the frame edge; giving the container a
  // margin to make room shoved the streaming section itself inward — visible as
  // a fat padding around live content. The container now carries NO ring and NO
  // margin; its box is reported to the canvas, which rings it.
  /** jsdom measures everything 0x0, and a 0-height box reports as "no ring". */
  const stubContainerRect = () => {
    const orig = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      return this.hasAttribute('data-sq-ai-preview')
        ? ({ top: 40, left: 0, width: 800, height: 120, right: 800, bottom: 160, x: 0, y: 40, toJSON: () => ({}) } as DOMRect)
        : orig.call(this);
    };
    return () => { HTMLElement.prototype.getBoundingClientRect = orig; };
  };

  /** Payloads of every AI_PREVIEW_RECT the bridge sent, oldest first. */
  const previewRects = () =>
    (bridge.sendToParent as ReturnType<typeof vi.fn>).mock.calls
      .map(call => call[0] as { type: string; payload?: { rect: unknown } })
      .filter(m => m.type === 'AI_PREVIEW_RECT')
      .map(m => m.payload!.rect);

  it('carries no ring and no margin — the box is reported to the parent instead', () => {
    const restore = stubContainerRect();
    bridge.handleStreamPreview({ mode: 'section', partial: '<div>a</div>' });
    const c = container()!;
    expect(c.querySelectorAll('.sq-ai-glow')).toHaveLength(0);
    expect((c as HTMLElement).style.margin).toBe('');
    expect(previewRects()).toEqual([{ top: 40, left: 0, width: 800, height: 120 }]);
    // Re-reported only when the box MOVES — a paint that doesn't reflow the
    // container would otherwise re-render the parent for nothing.
    bridge.handleStreamPreview({ mode: 'section', partial: '<div>a</div><div>b</div>' });
    expect(previewRects()).toHaveLength(1);
    restore();
  });

  it('clears the parent ring when the preview is removed', () => {
    const restore = stubContainerRect();
    bridge.handleStreamPreview({ mode: 'section', partial: '<div>a</div>' });
    restore();
    (bridge as unknown as { _sqPreviewFinalize: (t: string) => void })._sqPreviewFinalize('test');
    expect(previewRects().at(-1)).toBeNull();
  });

  it('watchdog removes a stuck preview when END never arrives', () => {
    vi.useFakeTimers();
    try {
      bridge.handleStreamPreview({ mode: 'section', partial: '<div>a</div>' });
      expect(container()).not.toBeNull();
      vi.advanceTimersByTime(8000 + 2000); // watchdog fires END + fallback finalize
      expect(container()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // Invariant pin (2026-07-23): during an AI run the PREVIOUS tool's commit
  // posts a RENDER while the NEXT tool's args are still streaming. That RENDER
  // must not touch the live container — only an END-pending preview may be
  // finalized by RENDER.
  // Regression (2026-07-23): SET_PAGE never cleaned the preview — a container
  // leaked across page switches and hung at the body end ("artifacts below the
  // section"), and its stale element counter suppressed the dissolve-in for
  // the next run's first elements.
  it('SET_PAGE finalizes a live preview (no cross-page leak)', () => {
    bridge.handleStreamPreview({ mode: 'section', partial: '<div>a</div>' });
    expect(container()).not.toBeNull();
    bridge.handleSetPage({ pageId: 'p2' });
    expect(container()).toBeNull();
  });

  it('a stream after a finalize-without-END starts the dissolve counter at zero', () => {
    bridge.handleStreamPreview({ mode: 'section', partial: '<div>a</div><div>b</div><div>c</div>' });
    bridge.handleSetPage({ pageId: 'p2' }); // finalize path that never went through END
    bridge.handleStreamPreview({ mode: 'section', partial: '<div>x</div>' });
    expect((container()!.querySelector('[data-sq-ai-preview-content] > div') as HTMLElement)
      .classList.contains('sq-ai-new')).toBe(true);
  });

  // task-128: busy pulse for class-only edits, orig-text restore, generalized watchdog
  it('busy mode pulses the target and END clears it; stale key is a no-op', () => {
    document.body.innerHTML = `<h1 data-key='k:1:1'>x</h1>`;
    const el = document.querySelector('h1')!;
    bridge.handleStreamPreview({ mode: 'busy', targetKey: 'k:1:1' });
    expect(el.getAttribute('data-sq-ai-busy')).toBe('true');
    expect(document.getElementById('sq-ai-preview-style')!.textContent).toContain('sq-busy');
    bridge.handleStreamPreviewEnd();
    expect(el.hasAttribute('data-sq-ai-busy')).toBe(false);
    expect(() => bridge.handleStreamPreview({ mode: 'busy', targetKey: 'ghost' })).not.toThrow();
  });

  it('text paint clears a prior busy pulse on the same target (upgrade path)', () => {
    document.body.innerHTML = `<h1 data-key='k:1:1'>x</h1>`;
    const el = document.querySelector('h1')!;
    bridge.handleStreamPreview({ mode: 'busy', targetKey: 'k:1:1' });
    bridge.handleStreamPreview({ mode: 'text', targetKey: 'k:1:1', partial: 'Hi' });
    expect(el.hasAttribute('data-sq-ai-busy')).toBe(false);
    expect(el.hasAttribute('data-sq-ai-typing')).toBe(true);
  });

  it('text paint saves original and finalize restores it (no commit)', () => {
    document.body.innerHTML = `<h1 data-key='k:1:1'>original</h1>`;
    const el = document.querySelector('h1')!;
    bridge.handleStreamPreview({ mode: 'text', targetKey: 'k:1:1', partial: 'part' });
    expect(el.getAttribute('data-sq-ai-orig')).toBe('original');
    bridge.handleStreamPreview({ mode: 'text', targetKey: 'k:1:1', partial: 'partia' });
    expect(el.getAttribute('data-sq-ai-orig')).toBe('original'); // first paint wins
    bridge._sqPreviewFinalize('fallback-2s');
    expect(el.textContent).toBe('original');
    expect(el.hasAttribute('data-sq-ai-orig')).toBe(false);
    expect(el.hasAttribute('data-sq-ai-typing')).toBe(false);
  });

  it('END keeps streamed text (commit path) but drops the orig attr', () => {
    document.body.innerHTML = `<h1 data-key='k:1:1'>original</h1>`;
    const el = document.querySelector('h1')!;
    bridge.handleStreamPreview({ mode: 'text', targetKey: 'k:1:1', partial: 'part' });
    bridge.handleStreamPreviewEnd();
    expect(el.textContent).toBe('part'); // commit RENDER overwrites moments later
    expect(el.hasAttribute('data-sq-ai-orig')).toBe(false);
  });

  it('cancelled END restores original text (no commit will follow)', () => {
    document.body.innerHTML = `<h1 data-key='k:1:1'>original</h1>`;
    const el = document.querySelector('h1')!;
    bridge.handleStreamPreview({ mode: 'text', targetKey: 'k:1:1', partial: 'part' });
    bridge.handleStreamPreviewEnd({ cancelled: true });
    expect(el.textContent).toBe('original');
    expect(el.hasAttribute('data-sq-ai-orig')).toBe(false);
    expect(el.hasAttribute('data-sq-ai-typing')).toBe(false);
  });

  it('watchdog is armed by text and busy paints', () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = `<h1 data-key='k:1:1'>orig</h1><h2 data-key='k:2:1'>y</h2>`;
      bridge.handleStreamPreview({ mode: 'text', targetKey: 'k:1:1', partial: 'x' });
      bridge.handleStreamPreview({ mode: 'busy', targetKey: 'k:2:1' });
      vi.advanceTimersByTime(8000); // watchdog fires END
      expect(document.querySelector('[data-sq-ai-typing]')).toBeNull();
      expect(document.querySelector('[data-sq-ai-busy]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks only newly streamed elements with the pop-in class (staggered)', () => {
    bridge.handleStreamPreview({ mode: 'section', partial: '<div>a</div>' });
    bridge.handleStreamPreview({ mode: 'section', partial: '<div>a</div><div>b</div><div>c</div>' });
    const divs = container()!.querySelectorAll('[data-sq-ai-preview-content] > div');
    // second render re-creates div a WITHOUT the class (it already animated);
    // only b and c — the new tail — get the pop-in
    expect(divs[0].classList.contains('sq-ai-new')).toBe(false);
    expect((divs[1] as HTMLElement).style.animationDelay).toBe('0ms');
    expect((divs[2] as HTMLElement).style.animationDelay).toBe('70ms');
    // END resets the counter for the next tool call
    bridge.handleStreamPreviewEnd();
    bridge.handleStreamPreview({ mode: 'section', partial: '<div>x</div>' });
    expect((container()!.querySelector('[data-sq-ai-preview-content] > div') as HTMLElement)
      .classList.contains('sq-ai-new')).toBe(true);
  });
});
