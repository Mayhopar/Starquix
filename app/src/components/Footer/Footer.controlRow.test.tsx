/**
 * The bar is 🏠 | [AI · Terminal · Add · Design · Settings] | ▶ under the active tab's panel
 * (owner 2026-10-12; 🏠 moved here from the sidebar's top-left, owner 2026-11-11). Controls that make no sense are hidden: without a page
 * canvas (post/variables editor, Content/Database tab) there is no Design tab
 * and no ▶ — ▶ in the post editor previewed a canvas the user could not see;
 * preview shows only ⏸.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import React from 'react';
import { Footer } from './Footer';
import { footerOutlinePath } from './footerOutline';
import { PANEL_MOTION } from './footerMotion';

// the panel motion is requestAnimationFrame-driven: a timer-backed frame clock the fake timers can step
beforeEach(() => { vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as unknown as number); vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id)); });
afterEach(() => { vi.unstubAllGlobals(); });
/** Frames, one act() each, so every state update lands before the next frame. */
const frames = (ms: number) => { for (let t = 0; t < ms; t += 16) act(() => vi.advanceTimersByTime(16)); };

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
let toolState = { activeTool: 'select', isPreview: false };
vi.mock('@/context', () => ({
  useTool: () => ({ ...toolState, setActiveTool: vi.fn(), setPreview: vi.fn() }),
}));
vi.mock('@/hooks/useCoverCapture', () => ({ useCoverCapture: () => ({ captureScreenshot: vi.fn() }) }));
vi.mock('@/ai/AIContext', () => ({
  useAI: () => ({
    isGenerating: false,
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
let webDemo = false;
vi.mock('@/services/webDesktop', () => ({ isWebDemo: () => webDemo }));

const onHome = vi.fn();
function renderFooter(hideTools = false) {
  return render(
    <Footer projectId="browser_test" onOpenModal={vi.fn()} onExport={vi.fn()} onDeploy={vi.fn()} hideTools={hideTools} onHome={onHome} />,
  );
}
const controlRow = () => screen.getByTestId('footer-control-tab');

describe('footer control row', () => {
  beforeEach(() => { toolState = { activeTool: 'select', isPreview: false }; webDemo = false; });

  it('keeps Add in the web demo, where there is no Terminal: AI · Add · Design · Settings, no Publish', () => {
    webDemo = true;
    render(<Footer projectId="browser_test" onOpenModal={vi.fn()} onExport={vi.fn()} hideTools={false} onHome={onHome} />);
    const items = [...controlRow().querySelectorAll('[title], [data-testid="footer-divider"]')]
      .map(el => el.getAttribute('title') ?? '|')
      .map(t => (t.startsWith('Add component') ? 'Add' : t));
    expect(items).toEqual(['Back to projects', '|', 'AI', 'Add', 'Design', 'Settings', '|', 'Preview']);
    expect(screen.queryByTitle('Publish')).toBeNull();
  });

  it('reads 🏠 | [AI · Terminal · Add · Design · Settings] | ▶, below the Design tools (owner 2026-11-11)', () => {
    renderFooter();
    const items = [...controlRow().querySelectorAll('[title], [data-testid="footer-divider"]')]
      .map(el => el.getAttribute('title') ?? '|')
      .map(t => (t.startsWith('Add component') ? 'Add' : t));
    expect(items).toEqual(['Back to projects', '|', 'AI', 'Terminal', 'Add', 'Design', 'Settings', '|', 'Preview']);
    screen.getByTitle('Back to projects').click();
    expect(onHome).toHaveBeenCalledTimes(1);
    expect(screen.getByTitle(/^Undo \((⌘|Ctrl\+)Z\)$/)).toBeInTheDocument();
  });

  it('sits 8px above the bottom of the window (owner, 2026-10-12)', () => {
    const { container } = renderFooter();
    expect(container.querySelector('footer')).toHaveClass('fixed', 'bottom-2');
  });

  it('without a canvas: no Design tab, no tools, no ▶ — AI and Settings stay', () => {
    renderFooter(true);
    expect(screen.queryByRole('button', { name: 'Design' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();
    expect(screen.queryByTestId('footer-tools')).toBeNull();
    expect(screen.getByTitle('AI')).toBeInTheDocument();
    expect(screen.getByTitle('Settings')).toBeInTheDocument();
    expect(screen.getByTitle('Back to projects')).toBeInTheDocument(); // 🏠 | tabs — no divider without ▶
    expect(screen.getAllByTestId('footer-divider')).toHaveLength(1);
  });

  it('going to the MD editor closes the Design panel as ONE motion from the click, then removes it', () => {
    vi.useFakeTimers();
    try {
      const { rerender } = renderFooter();
      const panel = screen.getByTestId('footer-panel');
      rerender(<Footer projectId="browser_test" onOpenModal={vi.fn()} onExport={vi.fn()} onDeploy={vi.fn()} hideTools onHome={onHome} />);
      // from the click: the content blur+fades out while the panel (clipped) is already on its way
      expect(screen.getByTestId('footer-tools').parentElement!.parentElement).toHaveClass('opacity-0', 'blur-sm');
      expect(panel.className).toContain('overflow-hidden');
      expect(screen.getByTestId('footer-panel')).toBe(panel);
      frames(PANEL_MOTION.closeMs / 2);
      expect(screen.getByTestId('footer-panel')).toBe(panel); // mid-way: still there
      frames(PANEL_MOTION.closeMs);
      expect(screen.queryByTestId('footer-panel')).toBeNull();
      // the ONE outline rests on the bare bar's pill
      expect((screen.getByTestId('footer-outline').style as unknown as { d: string }).d)
        .toBe(`path("${footerOutlinePath({ bar: { w: 135, h: 38 }, panel: null })}")`);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preview shows only ⏸', () => {
    toolState = { activeTool: 'select', isPreview: true };
    renderFooter();
    expect(screen.getByRole('button', { name: 'Exit preview (Esc)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'AI' })).toBeNull();
    expect(screen.queryByTitle('Back to projects')).toBeNull();
    expect(screen.queryByTestId('footer-divider')).toBeNull();
    expect(screen.queryByTestId('footer-tools')).toBeNull();
  });

  it('leaving the canvas runs the panel\'s switch motion on the tab bar: blur+fade out, swap, ease the px width', () => {
    // owner 2026-10-12: Design → Content snapped the bar 130→68px while only
    // the panel animated; the bar must move like the panel does, not its own way
    vi.useFakeTimers();
    try {
      const { rerender } = renderFooter();
      const track = screen.getByTestId('footer-control-track');
      const row = track.firstElementChild as HTMLElement;
      // 🏠 28 + 4 + | 1 + 4 + AI 28 + 2 + Terminal 28 + 2 + Add 28 + 2 + Design 28 + 2 + Settings 28 + 4 + | 1 + 4 + ▶ 28
      expect(track.style.width).toBe('222px');
      expect(track).not.toHaveClass('overflow-hidden');
      rerender(<Footer projectId="browser_test" onOpenModal={vi.fn()} onExport={vi.fn()} onDeploy={vi.fn()} hideTools onHome={onHome} />);
      // out: the same controls blur+fade (SWITCH_FADE_MS = 100)
      expect(screen.getByTitle('Design')).toBeInTheDocument();
      expect(row).toHaveClass('opacity-0', 'blur-sm');
      act(() => vi.advanceTimersByTime(100));
      // swapped: no Design, no ▶; the track eases to [AI · Terminal · Settings], clipped while it moves, content fading in
      expect(screen.queryByTitle('Design')).toBeNull();
      expect(screen.queryByTestId('preview-toggle')).toBeNull();
      expect(track.style.width).toBe('125px'); // 🏠 28 + 4 + | 1 + 4 + [AI · Terminal · Settings] 88
      expect(track).toHaveClass('overflow-hidden');
      expect(row).toHaveClass('opacity-100', 'blur-none');
      // the collapsing panel lands on the bar (88 + border + p-1) and is gone
      frames(PANEL_MOTION.closeMs + 100);
      expect(screen.queryByTestId('footer-panel')).toBeNull();
      expect(track).not.toHaveClass('overflow-hidden');
    } finally {
      vi.useRealTimers();
    }
  });

  it('the Design panel hugs its tools including its own 1px borders (even padding all round)', () => {
    // owner 2026-10-12: 3px above the tools, 5px below — the panel was sized
    // to the bar's border box without its own two border pixels
    const RO = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(private cb: ResizeObserverCallback) {}
      observe(target: Element) {
        this.cb([{ target, borderBoxSize: [{ inlineSize: 335, blockSize: 44 }] } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    try {
      renderFooter();
      const panel = screen.getByTestId('footer-panel');
      expect(panel.style.height).toBe('46px');
      expect(panel.style.width).toBe('337px');
      // the boxes only hold content: ONE outline draws panel + bar + joint
      expect(panel).toHaveClass('bg-transparent', 'border-transparent');
      expect(screen.getByTestId('footer-control-tab')).toHaveClass('border-transparent');
      expect((screen.getByTestId('footer-outline').style as unknown as { d: string }).d)
        .toBe(`path("${footerOutlinePath({ bar: { w: 232, h: 38 }, panel: { w: 337, h: 46, squareTopLeft: false } })}")`);
    } finally {
      globalThis.ResizeObserver = RO;
    }
  });
});

/**
 * Add is one of the strip's tabs and part of their radio group: it never reads selected together with
 * another tab (owner 2026-11-16). It used to hide inside the Design tab's tools after Undo/Redo, so users
 * never found how to add a component. Its place in the strip is pinned by the first test of this file.
 */
function renderAdd(props: Partial<React.ComponentProps<typeof Footer>> = {}) {
  const onOpenModal = vi.fn();
  const onCloseAdd = vi.fn();
  const ui = (extra: Partial<React.ComponentProps<typeof Footer>> = {}) => (
    <Footer projectId="browser_test" onOpenModal={onOpenModal} onCloseAdd={onCloseAdd} onExport={vi.fn()} onDeploy={vi.fn()} {...props} {...extra} />
  );
  const result = render(ui());
  return { ...result, onOpenModal, onCloseAdd, again: (extra: Partial<React.ComponentProps<typeof Footer>>) => result.rerender(ui(extra)) };
}
const add = () => screen.getByTestId('add-component-button');
const tab = (title: string) => screen.getByTitle(title);

describe('footer Add tab', () => {
  beforeEach(() => { toolState = { activeTool: 'select', isPreview: false }; });

  it('is one click away, with no tab opened first, and opens the picker', () => {
    const { onOpenModal } = renderAdd();
    fireEvent.click(add());
    expect(onOpenModal).toHaveBeenCalledTimes(1);
  });

  it('exists exactly once — the Design tab no longer carries a second copy', () => {
    renderAdd();
    fireEvent.click(screen.getByTitle('Design'));
    expect(screen.getAllByTestId('add-component-button')).toHaveLength(1);
  });

  it('is hidden when there is no page canvas', () => {
    renderAdd({ hideTools: true });
    expect(screen.queryByTestId('add-component-button')).toBeNull();
  });

  it('is yellow only while the picker is open', () => {
    const { again } = renderAdd();
    // resting: a subtle light fill so it stands out from the plain tabs (owner 2026-11-16)
    expect(add().className).toContain('bg-bg-hover');
    expect(add().className).not.toContain('bg-btn-primary-fill-default');
    again({ addOpen: true });
    expect(add().className).not.toContain('bg-bg-hover');
    expect(add().className).toContain('bg-btn-primary-fill-default');
  });

  it('radio: pressing Add closes the open tab, and while Add is on no tab reads selected', () => {
    const { again } = renderAdd();
    fireEvent.click(tab('AI'));
    expect(tab('AI')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(add());
    expect(tab('AI')).toHaveAttribute('aria-pressed', 'false');
    again({ addOpen: true });
    for (const t of ['AI', 'Terminal', 'Design', 'Settings']) expect(tab(t)).toHaveAttribute('aria-pressed', 'false');
    expect(add()).toHaveAttribute('aria-pressed', 'true');
  });

  it('radio: picking a tab while Add is on closes the picker', () => {
    const { onCloseAdd, again } = renderAdd({ addOpen: true });
    fireEvent.click(tab('Terminal'));
    expect(onCloseAdd).toHaveBeenCalledTimes(1);
    again({ addOpen: false });
    expect(tab('Terminal')).toHaveAttribute('aria-pressed', 'true');
  });

  it('pressing Add again closes the picker and does not reopen it', () => {
    const { onCloseAdd, onOpenModal } = renderAdd({ addOpen: true });
    fireEvent.click(add());
    expect(onCloseAdd).toHaveBeenCalledTimes(1);
    expect(onOpenModal).not.toHaveBeenCalled();
  });
});
