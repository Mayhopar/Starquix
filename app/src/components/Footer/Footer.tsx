import { ArrowUpRightIcon as SharedArrowUpRightIcon, CircleIcon as SharedCircleIcon, HomeFilledIcon, LineIcon as SharedLineIcon, PauseIcon as SharedPauseIcon, PencilIcon as SharedPencilIcon, PlayIcon as SharedPlayIcon, PolygonIcon as SharedPolygonIcon, RectangleIcon as SharedRectangleIcon } from '@/assets/icons';
import { footerOutlinePath, type FooterOutlineGeometry } from './footerOutline';
import { PANEL_MOTION, RESIZE_EASE, easeOut, lerpPath, shapeProgress } from './footerMotion';
// src/components/Footer/Footer.tsx
import { useOptionalEditorDoc } from '@/store/EditorContext';
import React, { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { useTheme } from '@/hooks';
import { useUndoContext } from '@/context/UndoContext';
import { useTool } from '@/context';
import { useAI } from '@/ai/AIContext';
import { useAIAgent } from '@/ai/hooks/useAIAgent';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';
import { AISettings } from './AISettings';
import { AISettingsButton } from './AISettingsButton';
import type { SettingsTab } from './AISettings';
import { StylePickerModal } from './StylePickerModal';
import { getActiveStyleName, loadBundledThemes } from '@/ai/styles/styleLibrary';
import { useElapsed } from './AIActivityFeed';
import { AIChat } from './AIChat';
import {
  CloseIcon,
  ContainerIcon,
  CursorIcon,
  DownloadIcon,
  FrameIcon,
  SlotIcon,
  GearIcon,
  MoonIcon,
  PlusLargeIcon,
  RedoIcon,
  RocketIcon,
  HistoryIcon,
  ServerIcon,
  ShapesIcon,
  SparklesIcon,
  SunIcon,
  TerminalIcon,
  TypeIcon,
  UndoIcon,
} from '@/assets/icons';
import type { ShapeKind } from '@/components/Canvas/shapeMarkup';
import { TerminalView } from '@/components/Terminal/TerminalView';
import { isDesktop } from '@/services/desktopDriver';
import { isWebDemo } from '@/services/webDesktop';
import { Button, FloatingPanel, IconButton, Spinner, cx, type ButtonProps } from '@/components/ui';
import { shortcutLabel } from '@/utils/platform';

import { hasChatKey } from '@/ai/types';

type FooterTab = 'manual' | 'ai' | 'terminal' | 'settings';
/** The tabs whose panel is a big resizable surface (not the hugging tools bar). */
type BigTab = 'ai' | 'terminal';

type Props = {
  projectId: string;
  onOpenModal: () => void;
  /** The component picker is open: the Add button wears the footer's "on" look. */
  addOpen?: boolean;
  /** Close the picker (another tab was picked, or Add pressed again): Add is a radio with the tabs. */
  onCloseAdd?: () => void;
  onExport: () => void;
  isExporting?: boolean;
  /** Publish; omitted in the web demo (no sign-ins or outbound internet there). */
  onDeploy?: () => void;
  /** Versions + GitHub panel; omitted off desktop (no project folder to version). */
  onVersions?: () => void;
  /** Back to the projects list — 🏠 at the bar's left (owner 2026-11-11; it was the sidebar's top-left). */
  onHome?: () => void;
  /** No page canvas on screen (variables/post editor, Content/Database tab):
   *  the Design tab, its tools and ▶ make no sense and are hidden. */
  hideTools?: boolean;
  /** Component library from Editor — avoids a duplicate scan-components fetch */
  componentLibrary?: ScannedComponent[];
  /** task-133 Task 9 (local runtime): LIVE getter for the current page's
   *  backing source file — the AI structural tools' write target. Omitted /
   *  returning null off the local runtime. */
  getCurrentPageFile?: () => string | null;
};

// --- Shared small components ---

function Divider(): React.ReactElement {
  return <div className="w-px h-6 bg-stroke self-center" />;
}

/** The control strip's 🏠 | tabs | ▶ separator (1px, in the strip's px width math). */
function BarDivider(): React.ReactElement {
  return <div data-testid="footer-divider" className="w-px h-4 bg-stroke self-center shrink-0" />;
}

/** The footer's "this one is on" look — tools, the ▶ toggle and the open tab alike. A white pill on the light Bg
 *  (1.04:1, yellow icon 1.9:1) read as no selection at all; the primary fill + its label pair is legible in both modes. */
const FOOTER_ON = 'bg-btn-primary-fill-default text-btn-primary-text-default hover:bg-btn-primary-fill-default hover:text-btn-primary-text-default';

/** Footer toolbar action — thin adapter over the kit Button (36px rounded-lg
 *  geometry; `compact` = the 28px control strip under the panel). */
function FooterButton({ onClick, title, icon, active, disabled, testId, compact }: {
  onClick: (e: React.MouseEvent) => void;
  title: string;
  icon: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  testId?: string;
  compact?: boolean;
}): React.ReactElement {
  return (
    <Button
      variant="ghost"
      iconOnly
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      data-testid={testId}
      icon={icon}
      className={cx(
        compact ? 'w-7 h-7 rounded-md' : 'w-9 h-9 rounded-lg',
        active && FOOTER_ON,
      )}
    />
  );
}

/** One toolbar button for a family of tools (Frame/Slot, Shapes): it shows the
 *  active member (else the last pick) and opens a flyout with all of them. */
function ToolGroup<K extends string>({ tools, activeTool, onPick, title, testId }: {
  tools: Array<{ kind: K; title: string; icon: React.ReactElement }>;
  activeTool: string;
  onPick: (kind: K) => void;
  title: string;
  testId: string;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState<K>(tools[0].kind);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);
  const active = tools.find(t => t.kind === activeTool);
  const shown = active ?? tools.find(t => t.kind === last)!;
  return (
    <div className="relative" ref={ref}>
      <FooterButton onClick={() => setOpen(o => !o)} active={!!active} title={active ? shown.title : title} testId={`${testId}-button`} icon={shown.icon} />
      {open && (
        <FloatingPanel data-testid={`${testId}-flyout`} className="absolute bottom-full mb-1 left-0 flex flex-col gap-0.5 p-1 rounded-lg">
          {tools.map(t => (
            <FooterButton
              key={t.kind}
              onClick={() => { onPick(t.kind); setLast(t.kind); setOpen(false); }}
              active={activeTool === t.kind}
              title={t.title}
              icon={t.icon}
            />
          ))}
        </FloatingPanel>
      )}
    </div>
  );
}

// Frame + Slot: one button, both draw a box (a slot is a component placeholder).
const FRAME_TOOLS: Array<{ kind: 'frame' | 'slot'; title: string; icon: React.ReactElement }> = [
  { kind: 'frame', title: 'Frame (A)', icon: <FrameIcon className="w-6 h-6" /> },
  { kind: 'slot', title: 'Slot', icon: <SlotIcon className="w-6 h-6" /> },
];

// Metaphors: Manual = design tools (shapes), AI = sparkles, Settings = gear

// Vector shape tools (task-106) — button icon mirrors the last-picked shape
const SHAPE_TOOLS: Array<{ kind: ShapeKind; title: string; icon: React.ReactElement }> = [
  {
    kind: 'rect', title: 'Rectangle (R)',
    icon: <SharedRectangleIcon className="w-6 h-6" />,
  },
  {
    kind: 'ellipse', title: 'Ellipse (O)',
    icon: <SharedCircleIcon className="w-6 h-6" />,
  },
  {
    kind: 'line', title: 'Line (L)',
    icon: <SharedLineIcon className="w-6 h-6" />,
  },
  {
    kind: 'arrow', title: 'Arrow',
    icon: <SharedArrowUpRightIcon className="w-6 h-6" />,
  },
  {
    kind: 'polygon', title: 'Polygon',
    icon: <SharedPolygonIcon className="w-6 h-6" />,
  },
];

const PenIcon = <SharedPencilIcon className="w-6 h-6" />;

// Preview mode (task-116) — filled reads better than stroked at this size.
const PlayIcon = <SharedPlayIcon className="w-4 h-4" />;
const PauseIcon = <SharedPauseIcon className="w-4 h-4" />;

// The strip's Add tab — hoisted like the icons above: the Footer re-renders about 10×/s while the agent streams.
const AddIcon = <PlusLargeIcon className="w-4 h-4" />;

const SEGMENT_TABS: { tab: FooterTab; title: string; icon: React.ReactNode }[] = [
  { tab: 'ai', title: 'AI', icon: <SparklesIcon className="w-4 h-4" /> },
  // The project's shell (desktop/src/terminal.mjs): claude / codex / opencode start there already connected (MCP).
  { tab: 'terminal', title: 'Terminal', icon: <TerminalIcon className="w-4 h-4" /> },
  { tab: 'manual', title: 'Design', icon: <ShapesIcon className="w-4 h-4" /> },
  { tab: 'settings', title: 'Settings', icon: <GearIcon className="w-4 h-4" /> },
];

// Mode-switch animation timings. The JS phase timers derive from these, and
// they're injected into the CSS via style.transitionDuration — one source.
const SWITCH_FADE_MS = 100;   // content blur+fade out/in
const SWITCH_RESIZE_MS = 250; // panel grow/shrink

/** Content of the switch motion: out quick, back in over the whole resize
 *  with ease-in, so what the still-growing container clips stays faint. */
const switchFade = (hidden: boolean) => ({
  className: hidden ? 'opacity-0 blur-sm' : 'opacity-100 blur-none',
  style: {
    transitionDuration: `${hidden ? SWITCH_FADE_MS : SWITCH_RESIZE_MS}ms`,
    transitionTimingFunction: hidden ? 'ease-out' : 'ease-in',
  },
});

// The AI chat's width until the user drags its edges; its height follows the chat until the user drags it: an empty
// chat is the composer, a conversation gets room to read.
const AI_DEFAULT_WIDTH = 560;
const CHAT_DEFAULT_HEIGHT = 160;
const CHAT_HEIGHT = 360;
// Room for an agent's TUI (about 100 × 18).
const TERMINAL_DEFAULT_WIDTH = 720;
const TERMINAL_DEFAULT_HEIGHT = 320;

// Tab buttons in the compact control strip: 28px squares, like ▶.
const TAB_SIZE = 28;
// The strip's chrome around its items: 1px border + p-1, both sides.
const CONTROL_TAB_CHROME = 2 + 8;

/** One 28px button of the control strip (the tabs, Add, 🏠). `on` = the footer's selected look (+ aria-pressed);
 *  `off` = its resting look, muted unless a caller says otherwise. No `on` = not a toggle: no aria-pressed. */
function StripButton({ on, off = 'text-text-muted hover:text-text hover:bg-transparent', ...props }:
  Omit<ButtonProps, 'variant' | 'size' | 'iconOnly' | 'style' | 'className'> & { on?: boolean; off?: string }): React.ReactElement {
  return (
    <Button
      variant="ghost"
      iconOnly
      size="sm"
      style={{ width: TAB_SIZE, height: TAB_SIZE }}
      aria-pressed={on}
      className={cx('shrink-0 rounded-md', on ? FOOTER_ON : off)}
      {...props}
    />
  );
}

type SwitchPhase = 'idle' | 'out' | 'in';
/** The footer's ONE switch motion, for the tab panel AND the tab bar: when
 *  `target` changes, the content blur+fades out (SWITCH_FADE_MS), `displayed`
 *  swaps to it, and the container eases its px size to the new content while
 *  it fades back in. 'in' keeps the overflow clip on until the resize settles. */
function useSwitchMotion<T>(target: T, nothingShown?: React.RefObject<boolean>): [T, SwitchPhase] {
  const [displayed, setDisplayed] = useState(target);
  const [phase, setPhase] = useState<SwitchPhase>('idle');
  useEffect(() => {
    // Flipped back before the swap (a double-click): the cleanup below killed the
    // swap timer, so settle here or the content stays faded out for good.
    if (target === displayed) { setPhase(p => (p === 'out' ? 'idle' : p)); return; }
    // Nothing on screen to fade (a closed panel opening a different tab): swap now, don't wait SWITCH_FADE_MS.
    if (nothingShown?.current) { setDisplayed(target); return; }
    setPhase('out');
    const swap = setTimeout(() => {
      setDisplayed(target);
      setPhase('in');
    }, SWITCH_FADE_MS);
    return () => clearTimeout(swap);
  }, [target, displayed]);
  // Settle in its OWN effect: the swap effect re-runs when `displayed`
  // changes and its cleanup used to kill the settle timer, leaving the phase
  // stuck at 'in' (= overflow-hidden forever, clipping the chat tab strip
  // that hangs above the panel).
  useEffect(() => {
    if (phase !== 'in') return;
    const settle = setTimeout(() => setPhase('idle'), SWITCH_RESIZE_MS + 20);
    return () => clearTimeout(settle);
  }, [phase]);
  return [displayed, phase];
}

// --- Main component ---

export function Footer({ projectId, onOpenModal, addOpen = false, onCloseAdd, onExport, isExporting = false, onDeploy, onVersions, onHome, hideTools = false, componentLibrary = [], getCurrentPageFile }: Props): React.ReactElement {
  // Flyouts (ui/Popover) keep clear of this bar: publish the height it covers
  // at the bottom of the window as --sq-chrome-bottom (+ an 8px breath).
  const footerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = footerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    // the bar animates its size on mode switches: write only when the value changes
    // (a :root custom property write restyles the whole document)
    let last = '';
    const publish = () => {
      const next = `${Math.max(0, Math.round(window.innerHeight - el.getBoundingClientRect().top + 8))}px`;
      if (next !== last) { last = next; root.style.setProperty('--sq-chrome-bottom', next); }
    };
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    window.addEventListener('resize', publish);
    publish();
    return () => { ro.disconnect(); window.removeEventListener('resize', publish); root.style.removeProperty('--sq-chrome-bottom'); };
  }, []);
  const { isDark, setTheme } = useTheme();
  const doc = useOptionalEditorDoc();
  const { undo, redo } = useUndoContext();
  const { activeTool, setActiveTool, isPreview, setPreview } = useTool();

  const {
    isGenerating,
    error,
    contextElements,
    config,
    messages,
    sessions,
    activeSessionId,
    removeContextElement,
    clearContextElements,
    newSession,
    switchSession,
    closeSession,
  } = useAI();
  const { submitAgentPrompt, cancelGeneration } = useAIAgent(componentLibrary, projectId, getCurrentPageFile);

  const [prompt, setPrompt] = useState('');
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [aiSettingsTab, setAiSettingsTab] = useState<SettingsTab>('api');
  const [stylePickerOpen, setStylePickerOpen] = useState(false);
  const [activeStyleName, setActiveStyleName] = useState<string | null>(null);
  // themes.json is lazy-loaded; the pill name resolves once it lands
  useEffect(() => {
    let live = true;
    loadBundledThemes().then(() => { if (live) setActiveStyleName(getActiveStyleName(projectId)); });
    return () => { live = false; };
  }, [projectId]);

  // Elapsed seconds while a run is active — makes the otherwise-static
  // "Working…"/"Thinking…" states visibly progress (kimi-k3 reasons/generates
  // for minutes with no streamed text, so a still label reads as "hung").
  const genStartRef = useRef<number | null>(null);
  useEffect(() => { genStartRef.current = isGenerating ? Date.now() : null; }, [isGenerating]);
  const now = useElapsed(isGenerating);
  const genSeconds = genStartRef.current ? Math.floor((now - genStartRef.current) / 1000) : 0;

  const isAIMode = activeTool === 'ai';
  const [activeTab, setActiveTab] = useState<FooterTab>(isAIMode ? 'ai' : 'manual');
  // Owner 2026-11-05: a second click on the open tab closes the panel — no tab selected. Orthogonal to activeTab,
  // so the panel's content stays rendered while it fades and shrinks (like leaving the canvas does).
  const [collapsed, setCollapsed] = useState(false);

  // Shapes flyout (task-106): click toggles the flyout, picking arms the tool

  // The big panels (AI chat, terminal) each keep the size the user dragged; until then their defaults apply. Never
  // seeded from the tools bar: it hugs its icons and is far narrower.
  const [dragged, setDragged] = useState<Record<BigTab, { w?: number; h?: number }>>({ ai: {}, terminal: {} });
  const bigTabRef = useRef<BigTab>('ai'); // the shown big tab, for the drag handlers
  const heightRef = useRef(CHAT_DEFAULT_HEIGHT); // the shown panel's height, where a height drag starts
  const panelRef = useRef<HTMLDivElement>(null);

  // Bar size, measured off the hugging bar-content div and applied to the
  // panel as EXPLICIT px. The panel must never sit at width:auto — an
  // auto→px transition re-resolves auto's start value against the freshly
  // swapped-in content, so switching to AI would animate from the AI
  // content's narrow hug instead of the bar's real width. (+2 = borders.)
  const [barSize, setBarSize] = useState<{ w: number; h: number } | null>(null);
  const barContentObserverRef = useRef<ResizeObserver | null>(null);
  const barContentRef = useCallback((el: HTMLDivElement | null) => {
    if (typeof ResizeObserver === 'undefined') return; // jsdom
    // the equality guard skips re-renders while the panel chases the content
    const take = (w: number, h: number) => setBarSize(prev => (prev && prev.w === w + 2 && prev.h === h + 2 ? prev : { w: w + 2, h: h + 2 }));
    if (!barContentObserverRef.current) {
      barContentObserverRef.current = new ResizeObserver(([entry]) => {
        // borderBoxSize is delivered layout-free (no forced reflow)
        const box = entry.borderBoxSize?.[0];
        const rect = box ? null : entry.target.getBoundingClientRect();
        take(box ? box.inlineSize : rect!.width, box ? box.blockSize : rect!.height);
      });
    }
    barContentObserverRef.current.disconnect();
    if (!el) return;
    // Measured NOW, in the commit, before the first paint: the observer's first callback lands a frame
    // later, so the surface was born as the bare pill (icons with no background) and then grew into
    // the T (probe 2026-11-05: outline 129x37 at frame 0 -> 338x82 over ~230ms). Before observe(): in a
    // test double that calls back synchronously, the observer's size must be the one that stays.
    const rect = el.getBoundingClientRect();
    take(rect.width, rect.height);
    barContentObserverRef.current.observe(el);
  }, []);
  // Transitions arm one frame AFTER the first paint: the surface's first shape is final, not a start.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    let live = true;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => { if (live) setArmed(true); }));
    return () => { live = false; cancelAnimationFrame(id); };
  }, []);

  // Mode-switch animation: ONE panel persists across tabs (useSwitchMotion).
  const panelUnmountedRef = useRef(false); // kept current by a layout effect below, once panelMounted exists
  const [displayedTab, switchPhase] = useSwitchMotion(activeTab, panelUnmountedRef);
  // The tab bar's controls run the same motion: Design and ▶ make no sense
  // without a canvas, preview shows only ⏸.
  const controlTarget: 'canvas' | 'noCanvas' | 'preview' = isPreview ? 'preview' : hideTools ? 'noCanvas' : 'canvas';
  const [controls, controlPhase] = useSwitchMotion(controlTarget);

  // The panel's width/height transition must not ease the user's own drags
  const [resizing, setResizing] = useState(false);
  // The surface outline (footerOutline.ts) + its latest geometry, so the
  // imperative width drag can redraw it without re-rendering the Footer.
  const outlineRef = useRef<SVGPathElement>(null);
  const outlineGeomRef = useRef<FooterOutlineGeometry | null>(null);

  const handleWidthResizeStart = useCallback((edge: 'left' | 'right') => (e: React.MouseEvent) => {
    e.preventDefault();
    const panel = panelRef.current;
    if (!panel) return;
    const startX = e.clientX;
    const startW = panel.getBoundingClientRect().width;
    setResizing(true);
    let finalW = startW;
    const onMove = (ev: MouseEvent) => {
      // The footer is centered, so the dragged edge tracks the cursor at 2×dx.
      // Imperative style write: re-rendering the whole Footer per mousemove
      // (chat history included) is wasted work; state commits once on mouseup.
      const dx = (ev.clientX - startX) * (edge === 'right' ? 2 : -2);
      finalW = Math.max(380, Math.min(window.innerWidth - 24, startW + dx));
      panel.style.width = `${finalW}px`;
      const g = outlineGeomRef.current;
      if (g?.panel) outlineRef.current?.style.setProperty('d', `path("${footerOutlinePath({ ...g, panel: { ...g.panel, w: finalW } })}")`);
    };
    const onUp = () => {
      const tab = bigTabRef.current;
      setDragged(d => ({ ...d, [tab]: { ...d[tab], w: Math.round(finalW) } }));
      setResizing(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  // Sync tab when activeTool changes externally (e.g. keyboard shortcut).
  // activeTab is intentionally omitted: we only react to isAIMode changes.
  useEffect(() => {
    if (isAIMode) { // an external route into AI mode (shortcut) opens its panel
      setCollapsed(false);
      if (activeTab !== 'ai') setActiveTab('ai');
    } else if (activeTab === 'ai' && !collapsed) setActiveTab('manual');
  }, [isAIMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Always enable context-capture mode while AI tool is active. This is the ONLY
  // emitter of sq:ai-context-mode — every route into/out of AI mode goes through
  // setActiveTool, so it lands here. Clearing the tray is AIProvider's job.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('sq:ai-context-mode', { detail: { active: isAIMode } }));
  }, [isAIMode]);

  // Close the open panel. No tool stays armed behind a hidden panel; leaving AI mode is how AIProvider
  // clears the context tray.
  const closePanel = useCallback(() => {
    setCollapsed(true);
    setActiveTool('select');
  }, [setActiveTool]);

  // Add is one of the tabs' radio group (owner 2026-11-16): picking it closes the open panel and opens the picker;
  // picking any tab (or Add again) closes the picker. The picker is a modal, so Add has no panel of its own.
  const handleAdd = useCallback(() => {
    if (addOpen) { onCloseAdd?.(); return; }
    closePanel();
    onOpenModal();
  }, [addOpen, onCloseAdd, onOpenModal, closePanel]);

  const handleTabChange = useCallback((tab: FooterTab) => {
    if (addOpen) onCloseAdd?.();
    if (tab === activeTab && !collapsed) {
      closePanel(); // the open tab again
      return;
    }
    setCollapsed(false);
    setActiveTab(tab);
    if (tab === 'ai') {
      setActiveTool('ai');
      return;
    }
    // Leaving AI tab: revert to select tool; AIProvider clears the tray off that.
    setActiveTool('select');
  }, [activeTab, collapsed, setActiveTool, addOpen, onCloseAdd, closePanel]);

  // Typed while the agent works: Enter queues it (one slot, a second Enter adds a line).
  const [queued, setQueued] = useState<string | null>(null);
  const handleSubmit = useCallback(() => {
    const text = prompt.trim();
    if (!text) return;
    if (!hasChatKey(config)) {
      setAiSettingsTab('api');
      setAiSettingsOpen(true);
      return;
    }
    setPrompt('');
    if (isGenerating) { setQueued(q => (q ? `${q}\n${text}` : text)); return; }
    void submitAgentPrompt(text);
  }, [prompt, isGenerating, submitAgentPrompt, config]);
  const unqueue = useCallback(() => {
    if (queued === null) return;
    setPrompt(p => (p ? `${queued}\n${p}` : queued));
    setQueued(null);
  }, [queued]);
  // The run ended: a clean finish sends what was queued; a failure or a step-capped pause hands it back to the
  // composer — the user decides. (Stop hands it back first, so a cancelled run never sends it.)
  const wasGeneratingRef = useRef(isGenerating);
  useEffect(() => {
    const ended = wasGeneratingRef.current && !isGenerating;
    wasGeneratingRef.current = isGenerating;
    if (!ended || queued === null) return;
    if (messages[messages.length - 1]?.status === 'complete') { setQueued(null); void submitAgentPrompt(queued); } else unqueue();
  }, [isGenerating]); // eslint-disable-line react-hooks/exhaustive-deps
  const handleStop = useCallback(() => { unqueue(); cancelGeneration(); }, [unqueue, cancelGeneration]);

  const handleContinue = useCallback(() => {
    if (isGenerating) return;
    submitAgentPrompt('', undefined, { continueRun: true });
  }, [isGenerating, submitAgentPrompt]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = heightRef.current;
    const tab = bigTabRef.current;
    setResizing(true);

    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      const newH = Math.max(120, Math.min(500, startHeight + delta));
      setDragged(d => ({ ...d, [tab]: { ...d[tab], h: newH } }));
    };

    const onUp = () => {
      setResizing(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  const hasApiKey = hasChatKey(config);

  const openSettings = useCallback((tab: SettingsTab) => {
    setAiSettingsTab(tab);
    setAiSettingsOpen(true);
  }, []);

  // The strip's tabs; on a canvas Add sits after Terminal. tabCount below counts exactly these.
  // The web demo has no shell (cloud web-demo/DESIGN.md security #4): no Terminal tab.
  const stripTabs = SEGMENT_TABS.filter(({ tab }) => (tab !== 'manual' || controls === 'canvas') && (tab !== 'terminal' || !isWebDemo()));
  const showAdd = controls === 'canvas';
  // Add follows Terminal, or AI where there is no Terminal (the web demo): AI · [Terminal] · Add · Design · Settings.
  const addAfter: FooterTab = stripTabs.some(({ tab }) => tab === 'terminal') ? 'terminal' : 'ai';
  const segmentedControl = (
    <div className="flex gap-0.5">
      {stripTabs.map(({ tab, title, icon }) => {
        // Radio with Add: while the picker is open no tab reads selected.
        const on = activeTab === tab && !collapsed && !addOpen;
        return (
          <React.Fragment key={tab}>
            <span className="relative flex shrink-0">
              <StripButton on={on} onClick={() => handleTabChange(tab)} title={title} aria-label={title} icon={icon} />
              {/* task-127: the run must stay visible when the AI panel is hidden */}
              {tab === 'ai' && isGenerating && !(displayedTab === 'ai' && !collapsed) && (
                <span
                  data-testid="ai-run-badge"
                  className="pointer-events-none absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-accent animate-pulse"
                />
              )}
            </span>
            {tab === addAfter && showAdd && (
              <StripButton
                on={addOpen}
                off="bg-bg-hover text-text hover:bg-bg-selected-hover"
                onClick={handleAdd}
                title={`Add component (${shortcutLabel('⌘K')})`}
                aria-label="Add component"
                data-testid="add-component-button"
                icon={AddIcon}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
  // The bar's track is explicitly px-sized like the panel (every control is
  // TAB_SIZE: tabs gap-0.5; 🏠 | tabs | ▶ gap-1 around 1px dividers), so it can
  // ease px→px and the collapsing panel lands exactly on it.
  const tabCount = controls === 'preview' ? 0 : stripTabs.length + (showAdd ? 1 : 0); // canvas: AI · Terminal · Add · Design · Settings
  const showPlay = controls !== 'noCanvas';
  const showHome = !!onHome && controls !== 'preview';
  const barParts = [
    ...(showHome ? [TAB_SIZE, 1] : []),
    ...(tabCount ? [tabCount * TAB_SIZE + (tabCount - 1) * 2] : []),
    ...(showPlay ? (tabCount ? [1, TAB_SIZE] : [TAB_SIZE]) : []),
  ];
  const trackWidth = barParts.reduce((a, b) => a + b, 0) + Math.max(0, barParts.length - 1) * 4;
  const controlTabWidth = CONTROL_TAB_CHROME + trackWidth;

  const hasContext = contextElements.length > 0;

  // Entering preview disarms the active tool: a live draw tool would keep the
  // AI context-mode effect running and (via isDrawing) kill the iframe's
  // pointer events — the one thing preview cannot afford. Preview entered from
  // the AI tab remembers that and re-arms the AI tool on exit (incl. Esc).
  const resumeAIRef = useRef(false);
  const togglePreview = useCallback(() => {
    if (!isPreview) {
      resumeAIRef.current = isAIMode;
      setActiveTool('select');
    }
    setPreview(!isPreview);
  }, [isPreview, setPreview, setActiveTool, isAIMode]);

  useEffect(() => {
    if (!isPreview && resumeAIRef.current) {
      resumeAIRef.current = false;
      setActiveTool('ai');
    }
  }, [isPreview, setActiveTool]);

  // The ⏸ stays reachable even if hideTools flips while previewing, so the
  // user can never be trapped with Esc as the only way out.
  const previewButton = showPlay && (
    <FooterButton
      compact
      onClick={togglePreview}
      active={controls === 'preview'}
      title={controls === 'preview' ? 'Exit preview (Esc)' : 'Preview'}
      testId="preview-toggle"
      icon={controls === 'preview' ? PauseIcon : PlayIcon}
    />
  );

  let placeholder: string;
  if (!hasApiKey) {
    placeholder = 'Configure API key in settings first';
  } else if (hasContext) {
    placeholder = 'What to do with these...';
  } else {
    placeholder = 'Describe what to build...';
  }

  // The tab's panel sits above the [tabs] ▶ row; preview shows only ⏸, and
  // Design has nothing to show without a canvas. It follows the bar's
  // DISPLAYED controls: its content blur+fades out with the bar's, and on the
  // swap the panel and the bar resize in the same beat — one motion.
  const panelVisibleIn = (mode: typeof controls) => mode !== 'preview' && !collapsed && !(displayedTab === 'manual' && mode === 'noCanvas');
  const chatVisible = displayedTab === 'ai' && controls !== 'preview';
  const bigPanel = (displayedTab === 'ai' || displayedTab === 'terminal') && controls !== 'preview';
  const chatTabs = chatVisible; // the chat's strip of sessions
  const panelVisible = panelVisibleIn(controls);
  const panelLeaving = controlPhase === 'out' && !panelVisibleIn(controlTarget);
  // Showing/hiding the panel (a second click on its tab, → MD editor, preview) is ONE continuous motion along a
  // path (footerMotion.ts): closing narrows while the height starts to go, and the rest of the height follows
  // once the width is the bar's; opening is the same path backwards. It starts at the CLICK (panelVisibleEff
  // follows the targets, not the content swap), writes the panel box and the outline straight to the DOM every
  // frame, and renders React only at its two rests — nothing re-renders mid-motion.
  const panelVisibleEff = panelVisible && !panelLeaving;
  const [panelMounted, setPanelMounted] = useState(panelVisible);
  const [rest, setRest] = useState<0 | 1>(panelVisible ? 0 : 1); // where the surface last came to rest
  const [contentOn, setContentOn] = useState(panelVisible);
  // Derived IN the render (not an effect): the first render after the flip already has the CSS transitions off.
  const [seenVisible, setSeenVisible] = useState(panelVisibleEff);
  const [moving, setMoving] = useState(false);
  if (panelVisibleEff !== seenVisible) {
    setSeenVisible(panelVisibleEff);
    setMoving(true);
    if (!panelVisibleEff) setContentOn(false);
  }
  useLayoutEffect(() => { panelUnmountedRef.current = !panelMounted; });

  // The panel's size when open: the same numbers size the panel box and the one outline drawn round panel + bar.
  const bigTab: BigTab = displayedTab === 'terminal' ? 'terminal' : 'ai';
  bigTabRef.current = bigTab;
  const panelHeight = dragged[bigTab].h ?? (bigTab === 'terminal' ? TERMINAL_DEFAULT_HEIGHT : messages.length ? CHAT_HEIGHT : CHAT_DEFAULT_HEIGHT);
  heightRef.current = panelHeight;
  const fullSize = bigPanel
    ? { w: dragged[bigTab].w ?? Math.min(bigTab === 'terminal' ? TERMINAL_DEFAULT_WIDTH : AI_DEFAULT_WIDTH, window.innerWidth - 24), h: panelHeight }
    : barSize;
  const barBox = { w: controlTabWidth, h: CONTROL_TAB_CHROME + TAB_SIZE };
  const geoRef = useRef({ full: fullSize, bar: barBox, squareTopLeft: chatTabs });
  geoRef.current = { full: fullSize, bar: barBox, squareTopLeft: chatTabs };
  const mRef = useRef<number>(panelVisible ? 0 : 1);      // the path position now: 0 open … 1 closed
  const targetRef = useRef<0 | 1>(panelVisible ? 0 : 1);  // where the running (or last) motion is headed
  const rafRef = useRef(0);

  const drawShape = useCallback((m: number) => {
    const { full, bar, squareTopLeft } = geoRef.current;
    if (!full) return; // not measured yet: the rests still render
    const { px, py } = shapeProgress(m);
    const panel = panelRef.current;
    if (panel) {
      panel.style.width = `${full.w + (bar.w - full.w) * px}px`;
      panel.style.height = `${full.h * (1 - py)}px`;
    }
    const open = footerOutlinePath({ bar, panel: { ...full, squareTopLeft } });
    outlineRef.current?.style.setProperty('d', `path("${lerpPath(open, footerOutlinePath({ bar, panel: null }), px, py)}")`);
  }, []);

  const runTo = useCallback((want: 0 | 1) => {
    cancelAnimationFrame(rafRef.current);
    targetRef.current = want;
    const from = mRef.current;
    const finish = () => {
      rafRef.current = 0; mRef.current = want;
      drawShape(want);
      setRest(want); setMoving(false);
      if (want === 1) setPanelMounted(false);
    };
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ms = (want === 1 ? PANEL_MOTION.closeMs : PANEL_MOTION.openMs) * Math.abs(want - from); // a reversal mid-way is shorter
    if (reduce || ms <= 0) { finish(); return; }
    const power = want === 1 ? PANEL_MOTION.closeCurve : PANEL_MOTION.openCurve;
    let t0: number | null = null;
    const step = (now: number) => {
      t0 ??= now;
      const u = Math.min(1, (now - t0) / ms);
      if (u >= 1) { finish(); return; }
      mRef.current = from + (want - from) * easeOut(u, power);
      drawShape(mRef.current);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [drawShape]);
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  useLayoutEffect(() => {
    const want = panelVisibleEff ? 0 : 1;
    if (!panelMounted) { if (panelVisibleEff) setPanelMounted(true); return; } // open: mount at the closed rest first
    if (targetRef.current === want) return;
    if (want === 0) { // lift off from the closed size: lay it out first, so the content's fade-in has a start
      panelRef.current?.getBoundingClientRect();
      setContentOn(true);
    }
    runTo(want);
  }, [panelMounted, panelVisibleEff, runTo]);

  // The terminal is heavy to start (xterm loads lazily): fetch it while idle, not mid-motion.
  useEffect(() => {
    if (!isDesktop()) return;
    const id = setTimeout(() => { void import('@xterm/xterm'); void import('@xterm/addon-fit'); }, 1500);
    return () => clearTimeout(id);
  }, []);

  // How the surface settles in a rest (tab ↔ tab resizes): ONE style for the outline and the panel box. Off while
  // the motion owns the numbers (a CSS transition would smooth every frame it writes).
  const moveStyle: React.CSSProperties = resizing || !armed || moving
    ? { transitionDuration: '0ms' }
    : { transitionDuration: `${SWITCH_RESIZE_MS}ms`, transitionTimingFunction: RESIZE_EASE };
  const outlineGeom: FooterOutlineGeometry = {
    bar: barBox,
    panel: rest === 0 && fullSize ? { ...fullSize, squareTopLeft: chatTabs } : null,
  };
  outlineGeomRef.current = outlineGeom;
  // The AI content (the chat, the MCP terminal) is laid out at its FINAL size and revealed by the panel's clip: it
  // never reflows while the panel opens or the tab swaps (a terminal fitting every frame was the lag + the slab).
  const pinContent = bigPanel && (moving || switchPhase !== 'idle') && !!fullSize;
  const contentHidden = switchPhase === 'out' || panelLeaving || collapsed || !contentOn || displayedTab !== activeTab; // never another tab's content
  const fadeIn = contentHidden || !moving ? null : { transitionDelay: `${PANEL_MOTION.contentDelayMs}ms`, transitionDuration: `${PANEL_MOTION.contentFadeMs}ms` };

  return (
    <footer ref={footerRef} className="fixed bottom-2 inset-x-0 flex flex-col items-center gap-2 z-100 pointer-events-none">
      {/* ONE panel across all modes: it is ALWAYS explicitly px-sized (bar
          size comes from the RO on the hugging bar content), so width/height
          ease-out px→px while the content inside blur+fades out, swaps, and
          fades back in. overflow-hidden only mid-switch — it would clip the
          shapes flyout. */}
      {/* ONE T-shaped surface (owner sketch, 2026-10-12): the tab's panel on
          top, the compact [tabs] ▶ bar hanging from its bottom edge, joined by
          concave fillets — drawn as ONE SVG outline (footerOutline.ts) whose
          `d` morphs on the switch curve; the panel and bar boxes are
          transparent content holders. The shadow is a drop-shadow on the
          wrapper so it follows that outline. Square top-left while the AI chat
          tab strip is docked flush to that corner. */}
      <div className="relative pointer-events-auto flex flex-col items-center" style={{ filter: 'drop-shadow(var(--shadow-flyout))' }}>
      {/* 1px viewport (a 0×0 svg is not rendered at all), origin = the bar's bottom-centre */}
      <svg aria-hidden className="absolute left-1/2 top-full size-px overflow-visible pointer-events-none">
        <path
          ref={outlineRef}
          data-testid="footer-outline"
          className="fill-bg stroke-stroke transition-[d] motion-reduce:transition-none"
          strokeWidth={1}
          style={{ d: `path("${footerOutlinePath(outlineGeom)}")`, ...moveStyle } as React.CSSProperties}
        />
      </svg>
      {panelMounted && <FloatingPanel
        ref={panelRef}
        data-testid="footer-panel"
        className={cx(
          'relative flex rounded-xl shadow-none bg-transparent border-transparent',
          chatTabs && 'rounded-tl-none',
          !resizing && 'transition-[width,height] motion-reduce:transition-none',
          (switchPhase !== 'idle' || moving) && 'overflow-hidden',
        )}
        style={{
          // 0 while dragging: a bare transitionDuration would still ease via
          // the default transition-property:all after the class is dropped
          ...moveStyle,
          ...(rest === 1
            ? { height: 0, width: controlTabWidth }
            : fullSize ? { height: fullSize.h, width: fullSize.w } : undefined),
        }}
      >
        {bigPanel && (
          <>
            {/* Width resize handles (edges) */}
            <div className="absolute inset-y-0 -left-1 w-2 cursor-ew-resize" onMouseDown={handleWidthResizeStart('left')} />
            <div className="absolute inset-y-0 -right-1 w-2 cursor-ew-resize" onMouseDown={handleWidthResizeStart('right')} />

            {/* Browser-style chat tabs, protruding above the panel's top edge.
                The strip sits flush ON the panel's top border (no -mb-px
                overlap), so one continuous line runs under all tabs + the
                + chip. × closes (browser logic: right neighbor activates,
                else left; last tab closes into a fresh empty chat), subtle +
                opens a new chat. Tab actions lock while generating — message
                mutators always target the ACTIVE session. Mid-switch the panel
                is overflow-hidden, so the strip clips for that beat. */}
            {/* mb-px: bottom-full anchors to the panel's padding box, so without
                it the strip covers the panel's 1px top border */}
            {chatTabs && <div className="absolute bottom-full -left-px mb-px flex items-end max-w-[80%] overflow-x-auto">
              {sessions.map((s, i) => {
                const isActiveSession = s.id === activeSessionId;
                const title = s.messages.find(m => m.role === 'user')?.content || 'New chat';
                // Rounding only on OUTER strip edges: first tab's top-left
                // (the + chip owns the top-right). Touching edges stay square
                // and overlap -ml-px so shared borders collapse to 1px; the
                // active tab paints above its neighbors' borders.
                return (
                  <div
                    key={s.id}
                    className={cx(
                      'flex items-center shrink-0 h-8 max-w-[160px] border-t border-x border-stroke',
                      i === 0 ? 'rounded-tl-md' : '-ml-px',
                      isActiveSession ? 'bg-bg relative' : 'bg-bg-contrast',
                    )}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => switchSession(s.id)}
                      disabled={isGenerating}
                      title={title}
                      className={cx(
                        // shrink beats Button's base shrink-0 so the truncate span can clip
                        'px-2.5 min-w-0 shrink hover:bg-transparent',
                        isActiveSession ? 'text-text' : 'text-text-muted hover:text-text',
                      )}
                    >
                      <span className="truncate">{title}</span>
                    </Button>
                    <IconButton
                      size="sm"
                      onClick={() => closeSession(s.id)}
                      disabled={isGenerating}
                      aria-label="Close chat"
                      className="mr-1.5 bg-transparent text-text-muted hover:text-text hover:bg-text/10"
                    >
                      <CloseIcon className="w-4 h-4" />
                    </IconButton>
                  </div>
                );
              })}
              <Button
                variant="ghost"
                iconOnly
                size="sm"
                onClick={newSession}
                disabled={isGenerating}
                title="New chat"
                aria-label="New chat"
                icon={<PlusLargeIcon className="w-4 h-4" />}
                // opacity-100 beats Button's disabled opacity-50: a translucent + over
                // the tab strip reads as a gray box while generating
                className="-ml-px w-9 h-8 self-end rounded-none rounded-tr-md border-t border-x border-stroke bg-bg text-text-muted hover:bg-bg-contrast hover:text-text shrink-0 opacity-100"
              />
            </div>}
          </>
        )}
        <div
          className={cx(
            'flex flex-1 justify-center min-w-0',
            'transition-[opacity,filter] motion-reduce:transition-none',
            switchFade(contentHidden).className,
            pinContent && 'absolute',
          )}
          style={{
            ...switchFade(contentHidden).style,
            ...fadeIn,
            ...(pinContent ? { left: '50%', bottom: 0, width: fullSize!.w - 2, height: fullSize!.h - 2, transform: 'translateX(-50%)' } : null),
          }}
        >
        {bigPanel ? (
          <div className="flex flex-col flex-1 min-w-0 min-h-0">
            {/* Resize handle */}
            <div
              className="flex justify-center pt-1.5 pb-0.5 cursor-ns-resize group shrink-0"
              onMouseDown={handleResizeStart}
            >
              <div className="w-8 h-0.5 bg-text/15 rounded-lg group-hover:bg-text/30 transition" />
            </div>

            {displayedTab === 'terminal' ? (<>
              <TerminalView projectId={projectId} />
              <div className="h-px bg-stroke shrink-0" />
              {/* The light of the session the terminal's agents (and outside ones) drive the editor through. */}
              <div className="flex items-center gap-1 h-11 p-1 shrink-0">
                <span className="text-sm-medium text-text mx-2">Terminal</span>
                <AISettingsButton variant="mcp" onClick={() => openSettings('api')} />
              </div>
            </>) : (
              <AIChat
                messages={messages}
                isGenerating={isGenerating}
                genSeconds={genSeconds}
                prompt={prompt}
                onPromptChange={setPrompt}
                queued={queued}
                onUnqueue={unqueue}
                onSubmit={handleSubmit}
                onStop={handleStop}
                onContinue={handleContinue}
                contextElements={contextElements}
                onRemoveContext={removeContextElement}
                emptyNotice={!hasApiKey ? { failure: 'configuration' } : error ? {} : null}
                onOpenSettings={() => openSettings('api')}
                placeholder={placeholder}
                pills={<>
                  <AISettingsButton variant="model" onClick={() => openSettings('api')} />
                  <AISettingsButton variant="style" label={activeStyleName ?? undefined} onClick={() => setStylePickerOpen(true)} />
                  <AISettingsButton variant="prompt" onClick={() => openSettings('prompts')} />
                </>}
              />
            )}
          </div>
      ) : (
        /* Design / Settings bar. self-end: keep the intrinsic hug height while
           the panel animates (cross-axis stretch would feed the animating
           height back into the RO) AND pin the row to the panel's bottom edge
           — the bottom edge is screen-fixed, so appearing buttons sit at their
           usual y instead of travelling down while the panel shrinks from AI
           height. */
        <div ref={barContentRef} className="flex items-center self-end shrink-0 p-1">
          <div data-testid="footer-tools" className="flex items-center gap-2">
          {displayedTab === 'manual' && (
            <>
              <div className="flex gap-0.5">
                <FooterButton
                  onClick={() => setActiveTool('select')}
                  active={activeTool === 'select'}
                  title="Select (V)"
                  icon={<CursorIcon className="w-6 h-6" />}
                />
                <ToolGroup tools={FRAME_TOOLS} activeTool={activeTool} onPick={setActiveTool} title="Frame / Slot" testId="frames" />
                <ToolGroup tools={SHAPE_TOOLS} activeTool={activeTool} onPick={setActiveTool} title="Shapes" testId="shapes" />
                <FooterButton
                  onClick={() => setActiveTool('pen')}
                  active={activeTool === 'pen'}
                  title="Pen (P)"
                  icon={PenIcon}
                />
                <FooterButton
                  onClick={() => setActiveTool('text')}
                  active={activeTool === 'text'}
                  title="Text (T)"
                  icon={<TypeIcon className="w-6 h-6" />}
                />
              </div>
              <Divider />
              <FooterButton
                onClick={undo}
                title={`Undo (${shortcutLabel('⌘Z')})`}
                icon={<UndoIcon className="w-6 h-6" />}
              />
              <FooterButton
                onClick={redo}
                title={`Redo (${shortcutLabel('⌘⇧Z')})`}
                icon={<RedoIcon className="w-6 h-6" />}
              />
            </>
          )}

          {displayedTab === 'settings' && (
            <>
              <FooterButton
                onClick={onExport}
                disabled={isExporting}
                title="Export project"
                icon={
                  isExporting ? (
                    <Spinner className="w-6 h-6" />
                  ) : (
                    <DownloadIcon className="w-6 h-6" />
                  )
                }
              />
              {onVersions && (
                <FooterButton
                  onClick={onVersions}
                  title="Versions"
                  testId="versions-button"
                  icon={<HistoryIcon className="w-6 h-6" />}
                />
              )}
              {onDeploy && (
                <FooterButton
                  onClick={onDeploy}
                  title="Publish"
                  icon={<RocketIcon className="w-6 h-6" />}
                />
              )}
              <Divider />
              <FooterButton
                onClick={() => setTheme(isDark ? 'light' : 'dark')}
                title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                icon={isDark ? <SunIcon className="w-6 h-6" /> : <MoonIcon className="w-6 h-6" />}
              />
            </>
          )}

          </div>
        </div>
      )}
        </div>
      </FloatingPanel>}

      {/* [AI · Design · Settings] ▶ — in preview only ⏸. A transparent
          holder: the outline draws its surface. Under a panel it overlaps the
          panel's bottom border by 1px — the outline's joint row. */}
      <div
        data-testid="footer-control-tab"
        className={cx(
          'relative z-flyout flex items-center p-1 border border-transparent rounded-xl',
          panelMounted && '-mt-px',
        )}
      >
        <div
          data-testid="footer-control-track"
          className={cx(
            'flex justify-center transition-[width] motion-reduce:transition-none',
            controlPhase !== 'idle' && 'overflow-hidden',
          )}
          style={{ width: trackWidth, transitionDuration: `${SWITCH_RESIZE_MS}ms`, transitionTimingFunction: RESIZE_EASE }}
        >
          <div
            className={cx(
              'flex shrink-0 items-center gap-1 transition-[opacity,filter] motion-reduce:transition-none',
              switchFade(controlPhase === 'out').className,
            )}
            style={switchFade(controlPhase === 'out').style}
          >
            {showHome && (
              <>
                <StripButton onClick={onHome} title="Back to projects" aria-label="Back to projects" icon={<HomeFilledIcon className="w-4 h-4" />} />
                <BarDivider />
              </>
            )}
            {controls !== 'preview' && segmentedControl}
            {controls !== 'preview' && showPlay && <BarDivider />}
            {previewButton}
          </div>
        </div>
      </div>
      </div>

      {/* task-127: preview hides the whole AI panel — this pill is the only
          run indicator AND the only Stop affordance while previewing. */}
      {isPreview && isGenerating && (
        <FloatingPanel
          data-testid="ai-preview-pill"
          className="pointer-events-auto fixed bottom-16 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full px-3 py-1.5"
        >
          <Spinner className="shrink-0" />
          <span className="text-sm text-text-secondary">AI working</span>
          <Button
            variant="ghost"
            iconOnly
            size="sm"
            onClick={handleStop}
            title="Stop"
            aria-label="Stop"
            icon={<CloseIcon className="w-4 h-4" />}
            className="w-7 h-7 rounded-full text-text-muted"
          />
        </FloatingPanel>
      )}

      <AISettings isOpen={aiSettingsOpen} onClose={() => setAiSettingsOpen(false)} initialTab={aiSettingsTab} />
      {stylePickerOpen && (
        <StylePickerModal
          isOpen
          onClose={() => setStylePickerOpen(false)}
          projectId={projectId}
          onApplied={() => setActiveStyleName(getActiveStyleName(projectId))}
        />
      )}
    </footer>
  );
}
