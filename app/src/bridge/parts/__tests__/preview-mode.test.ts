/**
 * Preview mode (task-116) — SET_MODE flips the bridge between design and
 * preview, and preview swaps every design interception for a single link
 * listener. Design: docs/plans/2026-07-16-preview-mode-design.md.
 *
 * The harness mounts the real BRIDGE_EVENTS + BRIDGE_STYLES strings, so what
 * runs here is what bridge.js ships.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

/** The harness stubs updateDesignModeStyles per instance; drop the own
 *  property so the real BRIDGE_STYLES prototype method runs. */
function useRealStyles(bridge: HarnessBridge): void {
  delete (bridge as unknown as Record<string, unknown>).updateDesignModeStyles;
}

const DESIGN_CURSOR_CSS = 'body * { cursor: pointer !important; } body { cursor: default !important; }';

function mountWithStyleElement(): HarnessBridge {
  const bridge = mountBridgeForTest();
  useRealStyles(bridge);
  const style = document.createElement('style');
  style.textContent = DESIGN_CURSOR_CSS;
  document.head.appendChild(style);
  bridge.styleElement = style;
  return bridge;
}

/** Fresh bridge already in preview mode with a cleared sendToParent mock. */
function mountPreview(): HarnessBridge {
  const bridge = mountWithStyleElement();
  bridge.handleSetMode({ mode: 'preview' });
  (bridge.sendToParent as ReturnType<typeof vi.fn>).mockClear();
  return bridge;
}

describe('SET_MODE', () => {
  beforeEach(() => resetHarnessDom());

  it('preview detaches the design listeners and clears the cursor override', () => {
    const bridge = mountWithStyleElement();

    bridge.handleSetMode({ mode: 'preview' });

    expect(bridge.mode).toBe('preview');
    expect(bridge.removeDesignModeListeners).toHaveBeenCalledTimes(1);
    expect(bridge.addDesignModeListeners).not.toHaveBeenCalled();
    // Empty = "no interference with native behavior" (vs-design parity).
    // Blog cards get their preview pointer from their REAL <a> wrapper.
    expect(bridge.styleElement!.textContent).toBe('');
  });

  it('design re-attaches the listeners and restores the cursor override', () => {
    const bridge = mountWithStyleElement();

    bridge.handleSetMode({ mode: 'preview' });
    bridge.handleSetMode({ mode: 'design' });

    expect(bridge.mode).toBe('design');
    expect(bridge.addDesignModeListeners).toHaveBeenCalledTimes(1);
    expect(bridge.styleElement!.textContent).toBe(DESIGN_CURSOR_CSS);
  });

  it('repeat sends of the same mode are a no-op', () => {
    const bridge = mountWithStyleElement();

    bridge.handleSetMode({ mode: 'preview' });
    bridge.handleSetMode({ mode: 'preview' });
    bridge.handleSetMode({ mode: 'preview' });

    // The parent re-sends SET_MODE on every IFRAME_READY (each HMR full-reload),
    // so this fires for real — it must not stack listeners.
    expect(bridge.removeDesignModeListeners).toHaveBeenCalledTimes(1);
    expect(bridge.previewListenersActive).toBe(true);
  });

  it('a missing/empty payload falls back to design', () => {
    const bridge = mountWithStyleElement();
    bridge.handleSetMode({ mode: 'preview' });

    bridge.handleSetMode(null);

    expect(bridge.mode).toBe('design');
  });

  it('attaches the preview listeners on preview and detaches them on design', () => {
    const bridge = mountWithStyleElement();
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    bridge.handleSetMode({ mode: 'preview' });
    expect(bridge.previewListenersActive).toBe(true);
    expect(addSpy).toHaveBeenCalledWith('click', expect.any(Function), true);
    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);

    bridge.handleSetMode({ mode: 'design' });
    expect(bridge.previewListenersActive).toBe(false);
    // Same bound references both ways, or the listeners would leak.
    expect(removeSpy).toHaveBeenCalledWith('click', bridge.boundPreviewNavClick, true);
    expect(removeSpy).toHaveBeenCalledWith('keydown', bridge.boundPreviewKeyDown, true);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});

/**
 * REGRESSION (found live, 2026-07-16): Esc did nothing in preview. Once the
 * user clicks anything in the page — the whole point of preview — focus moves
 * INSIDE the iframe (parent document.activeElement becomes the IFRAME), so the
 * editor's own document keydown listener never sees the key. The bridge must
 * forward Escape up. jsdom cannot reproduce the focus move, so this pins the
 * forwarding contract instead.
 */
describe('preview Escape forwarding', () => {
  let bridge: HarnessBridge;

  beforeEach(() => {
    resetHarnessDom();
    bridge = mountWithStyleElement();
    bridge.handleSetMode({ mode: 'preview' });
    (bridge.sendToParent as ReturnType<typeof vi.fn>).mockClear();
  });

  function keydown(key: string): Array<{ type: string; payload?: { key?: string } }> {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    return (bridge.sendToParent as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
  }

  it('forwards Escape over the existing KEYBOARD_EVENT channel', () => {
    const sent = keydown('Escape');
    expect(sent).toEqual([
      expect.objectContaining({ type: 'KEYBOARD_EVENT', payload: expect.objectContaining({ key: 'Escape' }) }),
    ]);
  });

  it.each(['a', 'Enter', 'Backspace', 'Delete', 'v', 'Tab'])(
    'does NOT forward %s — preview is read-only and forms must type normally',
    (key) => {
      expect(keydown(key)).toEqual([]);
    },
  );

  it('stops forwarding Escape once back in design mode', () => {
    bridge.handleSetMode({ mode: 'design' });
    (bridge.sendToParent as ReturnType<typeof vi.fn>).mockClear();
    expect(keydown('Escape')).toEqual([]);
  });

  // Called directly so a broken wire-up and a broken handler fail separately.
  it('handlePreviewKeyDown sends a complete KEYBOARD_EVENT payload', () => {
    bridge.handlePreviewKeyDown({ key: 'Escape' } as KeyboardEvent);
    expect(bridge.sendToParent).toHaveBeenCalledWith({
      type: 'KEYBOARD_EVENT',
      payload: { key: 'Escape', code: 'Escape', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false },
    });
  });
});

describe('preview link interception', () => {
  let bridge: HarnessBridge;

  beforeEach(() => {
    resetHarnessDom();
    bridge = mountWithStyleElement();
    bridge.handleSetMode({ mode: 'preview' });
    (bridge.sendToParent as ReturnType<typeof vi.fn>).mockClear();
  });

  /** Click the anchor through the real listener and report whether it was blocked. */
  function clickLink(html: string): { navigated: boolean; href?: string; defaultPrevented: boolean } {
    document.body.innerHTML = html;
    const link = document.querySelector('a')!;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    // The listener is attached to `document`; jsdom dispatch reaches it.
    const calls = (bridge.sendToParent as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0] as { type: string; payload?: { href?: string } })
      .filter((m) => m.type === 'PREVIEW_NAVIGATE');
    return {
      navigated: calls.length > 0,
      href: calls[0]?.payload?.href,
      defaultPrevented: event.defaultPrevented,
    };
  }

  it('sends PREVIEW_NAVIGATE for an internal link and blocks the 404', () => {
    const r = clickLink('<a href="/about">About</a>');
    expect(r.navigated).toBe(true);
    expect(r.href).toBe('/about');
    // Without this the iframe navigates to a route that does not exist and the
    // bridge dies with it.
    expect(r.defaultPrevented).toBe(true);
  });

  it('sends PREVIEW_NAVIGATE for the home link', () => {
    expect(clickLink('<a href="/">Home</a>').href).toBe('/');
  });

  it('intercepts a click on an element nested inside the link', () => {
    document.body.innerHTML = '<a href="/about"><span>deep</span></a>';
    const span = document.querySelector('span')!;
    span.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const calls = (bridge.sendToParent as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0] as { type: string });
    expect(calls.some((m) => m.type === 'PREVIEW_NAVIGATE')).toBe(true);
  });

  it('drops a cross-page #anchor suffix so the parent matcher still hits', () => {
    expect(clickLink('<a href="/about#team">Team</a>').href).toBe('/about');
  });

  it.each([
    ['target=_blank', '<a href="/about" target="_blank">New tab</a>'],
    ['cross-origin', '<a href="https://example.com/about">External</a>'],
    ['mailto:', '<a href="mailto:hi@example.com">Mail</a>'],
    ['tel:', '<a href="tel:+15551234">Call</a>'],
    ['download', '<a href="/file.pdf" download>Download</a>'],
    ['in-page anchor', '<a href="#section">Section</a>'],
    ['empty href', '<a>No href</a>'],
  ])('leaves %s native', (_label, html) => {
    const r = clickLink(html);
    expect(r.navigated).toBe(false);
    expect(r.defaultPrevented).toBe(false);
  });

  it('ignores a click that is not on a link', () => {
    expect(clickLink('<div><a href="/about">x</a></div>')).toBeTruthy();
    document.body.innerHTML = '<button>Click</button>';
    document.querySelector('button')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    const calls = (bridge.sendToParent as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0] as { type: string })
      .filter((m) => m.type === 'PREVIEW_NAVIGATE');
    expect(calls).toHaveLength(1); // only the <a> above, not the button
  });

  it('stops intercepting once back in design mode', () => {
    bridge.handleSetMode({ mode: 'design' });
    expect(clickLink('<a href="/about">About</a>').navigated).toBe(false);
  });

  // REGRESSION (found live, 2026-07-24): blog cards were dead in preview.
  // Cards are wrapped in real <a> elements whose href is the PUBLISHED post
  // route — findPageByHref can't match it (posts are slug-driven), so a click
  // inside a[data-sq-post-slug] must send PREVIEW_NAVIGATE {postSlug, slotKey}
  // instead of the href. postLinkMode 'none' renders bare cards → inert.
  describe('blog-card clicks', () => {
    function cardNav(): { postSlug?: string; slotKey?: string } | undefined {
      return (bridge.sendToParent as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0] as { type: string; payload?: { postSlug?: string; slotKey?: string } })
        .find((m) => m.type === 'PREVIEW_NAVIGATE')?.payload;
    }

    it('sends postSlug + slotKey for a click deep inside a wrapped card (new-instance path)', () => {
      document.body.innerHTML =
        '<div data-key="el-slot1:div-0" data-blog-source="posts">' +
          '<a data-sq-post-link="true" data-key="el-slot1:post-link" data-sq-post-slug="my-post" href="/blog/posts/my-post">' +
            '<article data-key="el-card1:article-0"><h3 id="title">Title</h3></article>' +
          '</a>' +
        '</div>';
      const event = { target: document.getElementById('title'), preventDefault: vi.fn() } as unknown as MouseEvent;

      bridge.handlePreviewLinkClick(event);

      expect(event.preventDefault).toHaveBeenCalled();
      // slotKey comes from the :posts wrapper's key prefix, NOT the card's
      // own key (that's the card instance id, a different element).
      expect(cardNav()).toEqual({ postSlug: 'my-post', slotKey: 'el-slot1' });
    });

    it('handles the legacy drawn-slot shape (anchor inside the :posts wrapper)', () => {
      document.body.innerHTML =
        '<div data-key="el-slot1:posts">' +
          '<a data-key="el-slot1:post-link" data-sq-post-slug="my-post" href="/blog/my-post">' +
            '<article><h3 id="title">Title</h3></article>' +
          '</a>' +
        '</div>';
      const event = { target: document.getElementById('title'), preventDefault: vi.fn() } as unknown as MouseEvent;

      bridge.handlePreviewLinkClick(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(cardNav()).toEqual({ postSlug: 'my-post', slotKey: 'el-slot1' });
    });

    it('a bare card (postLinkMode none — no <a>) stays inert', () => {
      document.body.innerHTML =
        '<div data-key="el-slot1:div-0" data-blog-source="posts">' +
          '<article data-sq-post-slug="my-post"><h3 id="title">Title</h3></article>' +
        '</div>';
      const event = { target: document.getElementById('title'), preventDefault: vi.fn() } as unknown as MouseEvent;

      bridge.handlePreviewLinkClick(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(cardNav()).toBeUndefined();
    });

    it('fires through the real document listener in preview mode', () => {
      document.body.innerHTML =
        '<div data-key="el-slot1:div-0" data-blog-source="posts">' +
          '<a data-sq-post-link="true" data-sq-post-slug="my-post" href="/blog/posts/my-post">' +
            '<article><h3 id="title">T</h3></article>' +
          '</a>' +
        '</div>';
      document.getElementById('title')!.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
      expect(cardNav()).toEqual({ postSlug: 'my-post', slotKey: 'el-slot1' });
    });
  });

  // The cases above drive handlePreviewLinkClick through the real document
  // listener; this calls it directly so a broken wire-up and a broken handler
  // fail as separate tests.
  it('handlePreviewLinkClick resolves the anchor from a nested event target', () => {
    document.body.innerHTML = '<a href="/about"><span id="inner">deep</span></a>';
    const inner = document.getElementById('inner')!;
    const event = { target: inner, preventDefault: vi.fn() } as unknown as MouseEvent;

    bridge.handlePreviewLinkClick(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(bridge.sendToParent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'PREVIEW_NAVIGATE', payload: { href: '/about' } }),
    );
  });
});
