/**
 * Owner 2026-11-05: (1) a second click on the open tab closes the panel — no tab selected, just the
 * [tabs] ▶ bar; (2) the surface must not GROW when the editor opens (it was born as the bare pill, icons
 * with no background, then eased into the T — probe: outline 129x37 at frame 0 → 338x82 over ~230ms).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { Footer } from './Footer';
import { footerOutlinePath } from './footerOutline';
import { PANEL_MOTION } from './footerMotion';

const { setActiveTool } = vi.hoisted(() => ({ setActiveTool: vi.fn() }));
let toolState = { activeTool: 'select', isPreview: false };
let aiState = { isGenerating: false };

vi.mock('@/assets/icons', () => {
  const Stub = (props: Record<string, unknown>) => React.createElement('span', props);
  return new Proxy({}, {
    get: (_t, prop) => (prop === 'then' ? undefined : Stub),
    has: () => true,
  });
});
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/hooks', () => ({ useTheme: () => ({ isDark: false, setTheme: vi.fn() }) }));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ undo: vi.fn(), redo: vi.fn() }) }));
vi.mock('@/context', () => ({
  useTool: () => ({ ...toolState, setActiveTool, setPreview: vi.fn() }),
}));
vi.mock('@/hooks/useCoverCapture', () => ({ useCoverCapture: () => ({ captureScreenshot: vi.fn() }) }));
vi.mock('@/ai/AIContext', () => ({
  useAI: () => ({
    ...aiState,
    error: null,
    contextElements: [],
    config: { apiKey: '' },
    messages: [],
    sessions: [{ id: 'chat-1', messages: [] }],
    activeSessionId: 'chat-1',
    removeContextElement: vi.fn(),
    clearContextElements: vi.fn(),
    newSession: vi.fn(),
    switchSession: vi.fn(),
    closeSession: vi.fn(),
  }),
}));
vi.mock('@/ai/hooks/useAIAgent', () => ({
  useAIAgent: () => ({ submitAgentPrompt: vi.fn(), cancelGeneration: vi.fn() }),
}));
vi.mock('@/utils/serverMode', () => ({
  getDevPreviewMode: () => 'wc',
  cycleDevPreviewMode: vi.fn(),
}));
vi.mock('./AISettings', () => ({ AISettings: () => null }));
vi.mock('./AISettingsButton', () => ({ AISettingsButton: () => null }));
vi.mock('@/components/Terminal/TerminalView', () => ({ TerminalView: () => null }));

function renderFooter() {
  return render(<Footer projectId="browser_test" onOpenModal={vi.fn()} onExport={vi.fn()} onDeploy={vi.fn()} onHome={vi.fn()} />);
}
const tab = (name: string) => screen.getByRole('button', { name });
const outlineD = () => (screen.getByTestId('footer-outline').style as unknown as { d: string }).d;
/** The wrapper that blur+fades the panel's content. */
const fade = () => screen.getByTestId('footer-tools').parentElement!.parentElement!;
/** Frames, one act() each, so every state update lands before the next frame (the motion is rAF-driven). */
const frames = (ms: number) => { for (let t = 0; t < ms; t += 16) act(() => vi.advanceTimersByTime(16)); };
const settle = () => frames(PANEL_MOTION.closeMs + PANEL_MOTION.openMs + 120);
const BAR = 232; // 🏠 | [AI · Terminal · Add · Design · Settings] | ▶ in its border box
const PILL = `path("${footerOutlinePath({ bar: { w: BAR, h: 38 }, panel: null })}")`;

beforeEach(() => {
  // a timer-backed frame clock the fake timers can step
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as unknown as number);
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  setActiveTool.mockClear();
  toolState = { activeTool: 'select', isPreview: false };
  aiState = { isGenerating: false };
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('the open tab is visible in the light theme', () => {
  it('it wears the footer\'s "on" fill (the one the tools use), never a Bg-Contrast pill: white on the light Bg is 1.04:1', () => {
    renderFooter();
    const on = tab('Design');
    expect(on).toHaveAttribute('aria-pressed', 'true');
    expect(on.className).toContain('bg-btn-primary-fill-default');
    expect(on.className).toContain('text-btn-primary-text-default');
    expect(on.className).not.toContain('bg-bg-contrast');
    expect(tab('AI').className).not.toContain('bg-btn-primary-fill-default'); // the others stay plain
  });
});

describe('a second click on the open tab closes the panel', () => {
  it('Design: the tab lets go at once, the content fades while the panel is already moving, then it unmounts', () => {
    vi.useFakeTimers();
    try {
      renderFooter();
      expect(tab('Design')).toHaveAttribute('aria-pressed', 'true');
      const panel = screen.getByTestId('footer-panel');
      fireEvent.click(tab('Design'));
      // no tab selected, no tool left armed behind a hidden panel
      expect(tab('Design')).toHaveAttribute('aria-pressed', 'false');
      expect(tab('AI')).toHaveAttribute('aria-pressed', 'false');
      expect(tab('Settings')).toHaveAttribute('aria-pressed', 'false');
      expect(setActiveTool).toHaveBeenLastCalledWith('select');
      // from the CLICK (no dead time): the content blur+fades and the panel is clipped
      expect(fade()).toHaveClass('opacity-0', 'blur-sm');
      expect(panel.className).toContain('overflow-hidden');
      frames(PANEL_MOTION.closeMs / 2);
      expect(screen.getByTestId('footer-panel')).toBe(panel);
      frames(PANEL_MOTION.closeMs);
      expect(screen.queryByTestId('footer-panel')).toBeNull();
      expect(outlineD()).toBe(PILL);
      expect(screen.getByTestId('footer-control-tab')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a click on any tab opens its panel again — the one just closed, or another', () => {
    vi.useFakeTimers();
    try {
      renderFooter();
      fireEvent.click(tab('Design'));
      settle();
      expect(screen.queryByTestId('footer-panel')).toBeNull();

      fireEvent.click(tab('Design')); // the same tab again
      settle();
      expect(tab('Design')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTitle(/^Undo \((⌘|Ctrl\+)Z\)$/)).toBeInTheDocument();

      fireEvent.click(tab('Design'));
      settle();
      fireEvent.click(tab('Settings')); // another tab opens ITS panel, never a flash of the old one
      settle();
      expect(tab('Settings')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTitle('Export project')).toBeInTheDocument();
      expect(screen.queryByTitle(/^Undo \((⌘|Ctrl\+)Z\)$/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a double-click (close, then open within the fade) leaves the content visible, not faded out for good', () => {
    // useSwitchMotion cleared its swap timer on the flip back and stayed in 'out' forever
    vi.useFakeTimers();
    try {
      renderFooter();
      fireEvent.click(tab('Settings'));
      act(() => vi.advanceTimersByTime(40));
      fireEvent.click(tab('Design')); // back to the displayed tab before the swap
      settle();
      expect(tab('Design')).toHaveAttribute('aria-pressed', 'true');
      expect(fade()).toHaveClass('opacity-100', 'blur-none');
      expect(screen.getByTitle(/^Undo \((⌘|Ctrl\+)Z\)$/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('AI: closing leaves AI mode, and a run in progress keeps its badge on the tab', () => {
    vi.useFakeTimers();
    try {
      toolState = { activeTool: 'ai', isPreview: false };
      aiState = { isGenerating: true };
      renderFooter();
      expect(screen.queryByTestId('ai-run-badge')).toBeNull(); // the chat is open: it shows the run
      fireEvent.click(tab('AI'));
      expect(setActiveTool).toHaveBeenLastCalledWith('select');
      settle();
      expect(screen.queryByTestId('footer-panel')).toBeNull();
      expect(screen.getByTestId('ai-run-badge')).toBeInTheDocument(); // the chat is closed: the badge shows it
    } finally {
      vi.useRealTimers();
    }
  });

  it('opening a tab still arms its tool: AI → setActiveTool(ai), others → select', () => {
    renderFooter();
    fireEvent.click(tab('AI'));
    expect(setActiveTool).toHaveBeenLastCalledWith('ai');
    fireEvent.click(tab('Settings'));
    expect(setActiveTool).toHaveBeenLastCalledWith('select');
  });
});

describe('the panel never passes through a hammer: height starts early, the rest follows once the width is the bar\'s', () => {
  const ro = globalThis.ResizeObserver;
  const FULL = { w: 337, h: 46 }; // the tools (335x44) + the panel's 1px borders
  const size = () => { const p = screen.queryByTestId('footer-panel'); return p ? { w: parseFloat(p.style.width), h: parseFloat(p.style.height) } : null; };
  /** The panel's size after every 16ms frame until `ms` have passed (null once it is gone). */
  const track = (ms: number) => { const out: Array<{ w: number; h: number } | null> = []; for (let t = 0; t < ms; t += 16) { act(() => vi.advanceTimersByTime(16)); out.push(size()); } return out; };
  beforeEach(() => {
    globalThis.ResizeObserver = class {
      constructor(private cb: ResizeObserverCallback) {}
      observe(target: Element) { this.cb([{ target, borderBoxSize: [{ inlineSize: 335, blockSize: 44 }] } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver); }
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });
  afterEach(() => { globalThis.ResizeObserver = ro; });

  it('closing: the width narrows at once, the height starts while it does, the rest of the height comes after', () => {
    vi.useFakeTimers();
    try {
      renderFooter();
      act(() => vi.advanceTimersByTime(100)); // armed
      expect(size()).toEqual(FULL);
      fireEvent.click(tab('Design'));
      const t = track(PANEL_MOTION.closeMs + 40).filter((s): s is { w: number; h: number } => !!s);
      // answers at once: two frames in, the width is already well on its way
      expect(t[1].w).toBeLessThan(FULL.w - 20);
      // both only ever shrink
      t.forEach((s, i) => { if (i) { expect(s.w).toBeLessThanOrEqual(t[i - 1].w + 0.01); expect(s.h).toBeLessThanOrEqual(t[i - 1].h + 0.01); } });
      // the height starts while the width is still shrinking …
      expect(t.some(s => s.h < FULL.h - 0.5 && s.w > BAR + 1)).toBe(true);
      // … but it is never mostly gone while the width is still wider than the bar
      expect(t.every(s => !(s.h < FULL.h / 2 && s.w > BAR + 0.5))).toBe(true);
      // and the rest of the shrinking happens AFTER the width is the bar's
      const widthDone = t.findIndex(s => s.w <= BAR + 0.5);
      expect(widthDone).toBeGreaterThan(0);
      expect(t[widthDone].h).toBeGreaterThan(FULL.h * 0.3);
      expect(t[widthDone].h).toBeLessThan(FULL.h);
    } finally {
      vi.useRealTimers();
    }
  });

  it('opening is the same path backwards: the height comes up at the bar\'s width, the width widens while it finishes', () => {
    vi.useFakeTimers();
    try {
      renderFooter();
      act(() => vi.advanceTimersByTime(100));
      fireEvent.click(tab('Design'));
      settle();
      expect(screen.queryByTestId('footer-panel')).toBeNull();
      fireEvent.click(tab('Design'));
      const t = track(PANEL_MOTION.openMs + 40).filter((s): s is { w: number; h: number } => !!s);
      t.forEach((s, i) => { if (i) { expect(s.w).toBeGreaterThanOrEqual(t[i - 1].w - 0.01); expect(s.h).toBeGreaterThanOrEqual(t[i - 1].h - 0.01); } });
      // rises first, out of the bar, at the bar's width …
      expect(t.some(s => s.h > FULL.h / 2 && s.w <= BAR + 0.5)).toBe(true);
      // … never wide and short (the hammer) …
      expect(t.every(s => !(s.h < FULL.h / 2 && s.w > BAR + 0.5))).toBe(true);
      // … and ends at the full size
      expect(t[t.length - 1]).toEqual(FULL);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reversing mid-motion carries on from where it is: no jump', () => {
    vi.useFakeTimers();
    try {
      renderFooter();
      act(() => vi.advanceTimersByTime(100));
      fireEvent.click(tab('Design'));
      const before = track(80).filter((s): s is { w: number; h: number } => !!s);
      const at = before[before.length - 1];
      fireEvent.click(tab('Design')); // open again, mid-close
      const after = track(PANEL_MOTION.openMs).filter((s): s is { w: number; h: number } => !!s);
      expect(Math.abs(after[0].w - at.w)).toBeLessThan(FULL.w * 0.25);
      expect(Math.abs(after[0].h - at.h)).toBeLessThan(FULL.h * 0.25);
      expect(after[after.length - 1]).toEqual(FULL);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the CSS transitions are off while the motion owns the numbers, and back for the tab ↔ tab resizes', () => {
    vi.useFakeTimers();
    try {
      renderFooter();
      act(() => vi.advanceTimersByTime(100));
      const both = () => [screen.getByTestId('footer-outline'), screen.getByTestId('footer-panel')].map(el => el.style.transitionDuration);
      expect(both()).toEqual(['250ms', '250ms']);
      fireEvent.click(tab('Settings')); fireEvent.click(tab('Settings'));
      expect(both()).toEqual(['0ms', '0ms']);
      settle(); fireEvent.click(tab('Design')); settle();
      expect(both()).toEqual(['250ms', '250ms']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('opening the editor does not animate the footer in', () => {
  const ro = globalThis.ResizeObserver;
  const rect = HTMLElement.prototype.getBoundingClientRect;

  it('the first paint is already the T: the bar is measured in the commit, not by the observer a frame later', () => {
    // an observer that never calls back = "its first callback has not landed yet"
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
    HTMLElement.prototype.getBoundingClientRect = function () {
      return { width: 335, height: 44, top: 0, left: 0, right: 335, bottom: 44, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    };
    try {
      renderFooter();
      const panel = screen.getByTestId('footer-panel');
      expect(panel.style.width).toBe('337px');
      expect(panel.style.height).toBe('46px');
      expect(outlineD()).toBe(`path("${footerOutlinePath({ bar: { w: BAR, h: 38 }, panel: { w: 337, h: 46, squareTopLeft: false } })}")`);
    } finally {
      globalThis.ResizeObserver = ro;
      HTMLElement.prototype.getBoundingClientRect = rect;
    }
  });

  it('transitions arm only after the first paint: none at mount, the switch motion afterwards', async () => {
    renderFooter();
    expect(screen.getByTestId('footer-outline').style.transitionDuration).toBe('0ms');
    expect(screen.getByTestId('footer-panel').style.transitionDuration).toBe('0ms');
    await waitFor(() => expect(screen.getByTestId('footer-outline').style.transitionDuration).toBe('250ms'));
    expect(screen.getByTestId('footer-panel').style.transitionDuration).toBe('250ms');
  });
});
