import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import * as Y from 'yjs';
import { useTool } from '@/context/ToolContext';
import { useEditorDoc } from '@/store/hooks';
import { useSelectionContext } from '@/context/SelectionContext';
import { findInsertionTarget } from '@/utils/smartInsertion';
import {
  buildPathD,
  buildPenMarkup,
  computeBBox,
  mapAnchors,
  normalizePenPath,
  roundPath,
  seedPathClasses,
  type PenAnchor,
  type PenPath,
} from './penGeometry';
import { screenToIframe, iframeToOverlay, type CanvasView } from './canvasCoords';
import {
  penDrawReducer,
  initialDrawState,
  penEditReducer,
  initialEditState,
  type PenDrawEvent,
  type PenDrawState,
  type PenEditState,
} from './penState';
import { useScannedElementsRef, useElementGeometry } from '@/context/SelectionContext';

/** Shape-compatible with Canvas's drawn-element creation handler. */
export interface PenPathResult {
  tag: string;
  classes: string;
  textContent: string;
  parentKey: string | null;
  insertIndex: number;
  staticMarkup: string;
  /** PenPath JSON (normalized, bbox origin at 0,0). */
  penPath: string;
}

export interface PenEditResult {
  penPath: string;
  staticMarkup: string;
  classes: string;
  /**
   * false = this edit rides the PREVIOUS undo step (the end-of-session refit
   * must undo together with the last gesture, not as its own step).
   */
  takeUndoSnapshot?: boolean;
}

interface PenOverlayProps {
  scale: number;
  position: { x: number; y: number };
  canvasWidth: number;
  viewportWidth: number;
  onPathCommitted: (result: PenPathResult) => void;
  /** Same semantics as DrawOverlay: component/theme instances can't parent (real pages). */
  lockInstanceParenting?: boolean;
  /** Node-edit mode: key of the pen element being edited (null = not editing). */
  editingKey?: string | null;
  /** Fired per completed edit gesture AND once at session end (refit). */
  onPathEdited?: (result: PenEditResult) => void;
  /** Fired when a delete leaves <2 anchors — caller removes the element. */
  onElementDeleted?: () => void;
  /** Esc/Enter/click-empty/selection-change while editing. */
  onEditExit?: () => void;
}

/** Swap the arbitrary w/h tokens for the refit bbox, keep every style token. */
export function refitClasses(classes: string, w: number, h: number): string {
  const kept = classes.split(/\s+/).filter(Boolean).filter((t) => !/^[wh]-\[/.test(t));
  return [`w-[${w}px]`, `h-[${h}px]`, ...kept].join(' ');
}

/** Screen-px hit radius for closing the path — divided by zoom at the call site. */
const CLOSE_HIT_SCREEN_PX = 8;
const CHROME_STROKE = '#3b82f6';
const CHROME_SOFT = '#93c5fd';
const HANDLE_KINDS = ['hOut', 'hIn'] as const;

export const PenOverlay = memo(function PenOverlay({
  scale,
  position,
  canvasWidth,
  viewportWidth,
  onPathCommitted,
  lockInstanceParenting = false,
  editingKey = null,
  onPathEdited,
  onElementDeleted,
  onEditExit,
}: PenOverlayProps) {
  const { scannedElementsRef, scannedByKeyRef } = useScannedElementsRef();
  const { activeTool, setActiveTool } = useTool();
  const { selectedKey } = useSelectionContext();
  const doc = useEditorDoc();
  const overlayRef = useRef<HTMLDivElement>(null);

  const isEdit = !!editingKey;
  const isDraw = activeTool === 'pen' && !isEdit;

  const view = useMemo<CanvasView>(
    () => ({ scale, position, canvasWidth, viewportWidth }),
    [scale, position, canvasWidth, viewportWidth],
  );
  const viewRef = useRef(view);
  viewRef.current = view;

  /** Client coords → iframe coords, safe from document-level handlers (reads refs). */
  const clientToIframe = useCallback((clientX: number, clientY: number) => {
    const overlayEl = overlayRef.current;
    if (!overlayEl) return { x: 0, y: 0 };
    return screenToIframe(clientX, clientY, overlayEl.getBoundingClientRect(), viewRef.current);
  }, []);

  // ------------------------------------------------------------------ draw
  const [drawState, setDrawState] = useState<PenDrawState>(initialDrawState);
  const hasDrawAnchors = drawState.path.anchors.length > 0;

  const applyEvent = useCallback((ev: PenDrawEvent) => {
    setDrawState((prev) => penDrawReducer(prev, ev));
  }, []);

  const pointerEvent = useCallback(
    (type: 'pointerdown' | 'pointermove' | 'pointerup', e: React.MouseEvent): PenDrawEvent => {
      const p = clientToIframe(e.clientX, e.clientY);
      return { type, x: p.x, y: p.y, alt: e.altKey, shift: e.shiftKey, closeRadius: CLOSE_HIT_SCREEN_PX / scale };
    },
    [clientToIframe, scale],
  );

  // Enter/Escape/Backspace while a path is in progress — capture phase so
  // useKeyboardShortcuts' Escape-disarms-tool never sees them mid-draw.
  // stopImmediatePropagation covers events whose target IS document (no
  // focused element): plain stopPropagation can't block same-node listeners.
  useEffect(() => {
    if (!isDraw || !hasDrawAnchors) return; // not drawing yet — let Esc disarm the tool
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopImmediatePropagation();
        applyEvent({ type: 'enter' });
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        applyEvent({ type: 'escape' });
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        e.stopImmediatePropagation();
        applyEvent({ type: 'backspace' });
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [isDraw, hasDrawAnchors, applyEvent]);

  // Terminal states: commit or cancel, then reset + disarm.
  useEffect(() => {
    if (drawState.committed) {
      const committed = drawState.committed;
      const n = normalizePenPath(committed);
      const iframeRect = { top: n.y, left: n.x, width: n.w, height: n.h };
      const insertion = findInsertionTarget(iframeRect, scannedElementsRef.current, lockInstanceParenting);
      onPathCommitted({
        tag: 'div',
        textContent: '',
        classes: seedPathClasses(n.w, n.h, committed.closed, true),
        staticMarkup: buildPenMarkup(n.path, n.w, n.h),
        penPath: JSON.stringify(n.path),
        parentKey: insertion.parentKey,
        insertIndex: insertion.insertIndex,
      });
      setDrawState(initialDrawState());
      setActiveTool('select');
    } else if (drawState.cancelled) {
      setDrawState(initialDrawState());
      setActiveTool('select');
    }
  }, [drawState, scannedElementsRef, lockInstanceParenting, onPathCommitted, setActiveTool]);

  // ------------------------------------------------------------------ edit
  //
  // Session-stable frame model: on entry the element's CURRENT content box is
  // frozen as the session frame. Every gesture writes the on-screen (visual)
  // coordinates verbatim with that frozen viewBox and UNTOUCHED classes, so
  // what you drag is exactly what renders — 1:1 for the whole session. The
  // bbox refit (normalize + w/h classes) happens ONCE at session end; that is
  // the only moment the element may settle (its wrapper is in static flow and
  // cannot follow a bbox-origin shift).
  const [editState, setEditState] = useState<PenEditState | null>(null);
  const editStateRef = useRef(editState);
  editStateRef.current = editState;
  const [pathVersion, setPathVersion] = useState(0);
  const [selectedAnchor, setSelectedAnchor] = useState<number | null>(null);
  const dragMovedRef = useRef(false);
  /** Frozen session frame (visual px). Set once per session. */
  const frameRef = useRef<{ w: number; h: number } | null>(null);
  /** True once any gesture committed — gates the end-of-session refit. */
  const dirtyRef = useRef(false);
  const lastKeyRef = useRef<string | null>(null);

  const editRect = useElementGeometry(isEdit ? editingKey ?? null : null);

  const currentClassesOf = useCallback(
    (key: string): string => {
      const entry = doc.getMap('sourceClasses').get(key) as Y.Map<unknown> | undefined;
      return (entry?.get('classes') as string) || '';
    },
    [doc],
  );

  // Re-seed from live Yjs on entry and after every external change (gesture
  // commit echo, undo/redo). Stored anchors scale by rect/viewBox — identity
  // for mid-session writes (viewBox == frame == rect), stretch-bake for
  // normalized paths on a DesignBar-resized wrapper.
  useEffect(() => {
    if (!editingKey) {
      setEditState(null);
      setSelectedAnchor(null);
      frameRef.current = null;
      dirtyRef.current = false;
      lastKeyRef.current = null;
      return;
    }
    if (lastKeyRef.current !== editingKey) {
      frameRef.current = null;
      dirtyRef.current = false;
      lastKeyRef.current = editingKey;
      setSelectedAnchor(null);
    }
    const yEl = doc.getMap('elements').get(editingKey) as Y.Map<unknown> | undefined;
    const json = yEl?.get('penPath') as string | undefined;
    if (!json) {
      // Element (or its path) vanished under us — leave edit mode.
      if (editStateRef.current) onEditExit?.();
      setEditState(null);
      return;
    }
    let stored: PenPath;
    try {
      stored = JSON.parse(json) as PenPath;
    } catch {
      setEditState(null);
      return;
    }
    const markup = yEl?.get('staticMarkup') as string | undefined;
    const vb = markup?.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    const bbox = vb ? null : computeBBox(stored);
    const vbW = vb ? parseFloat(vb[1]) : Math.max(2, Math.round(bbox!.w));
    const vbH = vb ? parseFloat(vb[2]) : Math.max(2, Math.round(bbox!.h));
    const rect = editingKey ? scannedByKeyRef.current.get(editingKey)?.rect ?? null : null;
    const sx = rect && vbW > 0 ? rect.width / vbW : 1;
    const sy = rect && vbH > 0 ? rect.height / vbH : 1;
    const visual = mapAnchors(
      stored,
      (p) => ({ x: p.x * sx, y: p.y * sy }),
      (d) => ({ dx: d.dx * sx, dy: d.dy * sy }),
    );
    if (!frameRef.current) {
      frameRef.current = rect ? { w: rect.width, h: rect.height } : { w: vbW, h: vbH };
    }
    setEditState(initialEditState(visual));
  }, [doc, editingKey, pathVersion, onEditExit]);

  // External Yjs changes bump the seed version — but only for OUR element
  // (unrelated element edits must not re-parse/re-seed the session).
  useEffect(() => {
    if (!editingKey) return;
    const elements = doc.getMap('elements');
    const obs = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
      const yEl = elements.get(editingKey);
      if (events.some((ev) => ev.target === elements || ev.target === yEl)) {
        setPathVersion((v) => v + 1);
      }
    };
    elements.observeDeep(obs);
    return () => elements.unobserveDeep(obs);
  }, [doc, editingKey]);

  const clientToElement = useCallback(
    (clientX: number, clientY: number) => {
      const p = clientToIframe(clientX, clientY);
      const rect = editingKey ? scannedByKeyRef.current.get(editingKey)?.rect ?? null : null;
      return rect ? { x: p.x - rect.left, y: p.y - rect.top } : p;
    },
    [clientToIframe, editingKey, scannedByKeyRef],
  );

  /** Mid-session gesture commit: session-space path, frozen frame, classes untouched. */
  const commitGesture = useCallback(
    (path: PenPath) => {
      const frame = frameRef.current;
      if (!editingKey || !frame || !onPathEdited) return;
      dirtyRef.current = true;
      onPathEdited({
        penPath: JSON.stringify(roundPath(path)),
        staticMarkup: buildPenMarkup(path, frame.w, frame.h),
        classes: currentClassesOf(editingKey),
      });
    },
    [editingKey, onPathEdited, currentClassesOf],
  );

  /**
   * End-of-session refit: normalize once, refit w/h classes. No new undo stop —
   * undoing after exit reverts the last gesture AND this refit together.
   */
  const finishSession = useCallback(() => {
    const st = editStateRef.current;
    if (!editingKey || !st || st.deleted || !dirtyRef.current || !onPathEdited) return;
    dirtyRef.current = false;
    const n = normalizePenPath(st.path);
    onPathEdited({
      penPath: JSON.stringify(n.path),
      staticMarkup: buildPenMarkup(n.path, n.w, n.h),
      classes: refitClasses(currentClassesOf(editingKey), n.w, n.h),
      takeUndoSnapshot: false,
    });
  }, [editingKey, onPathEdited, currentClassesOf]);
  const finishSessionRef = useRef(finishSession);
  finishSessionRef.current = finishSession;

  const exitSession = useCallback(() => {
    finishSession();
    onEditExit?.();
  }, [finishSession, onEditExit]);

  // Selecting anything else (Layers click, iframe click) ends the session.
  useEffect(() => {
    if (isEdit && selectedKey !== editingKey) exitSession();
  }, [isEdit, selectedKey, editingKey, exitSession]);

  // Unmount / key switch safety net: refit if a session is still dirty.
  useEffect(() => {
    if (!editingKey) return;
    return () => finishSessionRef.current();
  }, [editingKey]);

  /** Reducer step + immediate commit for structural ops (add/delete/toggle). */
  const applyStructural = useCallback(
    (ev: Parameters<typeof penEditReducer>[1]) => {
      const cur = editStateRef.current;
      if (!cur) return;
      const next = penEditReducer(cur, ev);
      setEditState(next);
      if (next.deleted) {
        onElementDeleted?.();
        return;
      }
      if (next !== cur) commitGesture(next.path);
    },
    [commitGesture, onElementDeleted],
  );

  // Document-level drag session while an anchor/handle drag is in flight.
  const hasEditDrag = !!editState?.drag;
  useEffect(() => {
    if (!hasEditDrag) return;
    const onMove = (e: MouseEvent) => {
      dragMovedRef.current = true;
      const p = clientToElement(e.clientX, e.clientY);
      setEditState((s) =>
        s ? penEditReducer(s, { type: 'pointermove', x: p.x, y: p.y, alt: e.altKey, shift: e.shiftKey }) : s,
      );
    };
    const onUp = (e: MouseEvent) => {
      const cur = editStateRef.current;
      if (!cur) return;
      const next = penEditReducer(cur, { type: 'pointerup', x: 0, y: 0, alt: e.altKey, shift: e.shiftKey });
      setEditState(next);
      if (dragMovedRef.current) commitGesture(next.path);
      dragMovedRef.current = false;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [hasEditDrag, clientToElement, commitGesture]);

  // Edit-mode keys, capture phase. Delete/Backspace is ALWAYS swallowed here —
  // without a selected anchor it must not bubble to the element-delete shortcut.
  useEffect(() => {
    if (!isEdit) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        e.stopImmediatePropagation();
        exitSession();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (selectedAnchor == null) return;
        setSelectedAnchor(null);
        applyStructural({ type: 'delete-anchor', index: selectedAnchor });
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [isEdit, exitSession, applyStructural, selectedAnchor]);

  // -------------------------------------------------- memoized chrome paths
  // Static parts rebuild only when the PATH changes, not on every cursor move.
  const drawLocalPath = useMemo<PenPath | null>(() => {
    if (drawState.path.anchors.length === 0) return null;
    return mapAnchors(
      drawState.path,
      (p) => iframeToOverlay(p, view),
      (d) => ({ dx: d.dx * view.scale, dy: d.dy * view.scale }),
    );
  }, [drawState.path, view]);

  const editChrome = useMemo(() => {
    if (!editState || !editRect) return null;
    const path = editState.path;
    const localPath = mapAnchors(
      path,
      (p) => iframeToOverlay({ x: editRect.left + p.x, y: editRect.top + p.y }, view),
      (d) => ({ dx: d.dx * view.scale, dy: d.dy * view.scale }),
    );
    const n = localPath.anchors.length;
    const segCount = n - 1 + (path.closed ? 1 : 0);
    const segDs = Array.from({ length: segCount }, (_, i) =>
      buildPathD({ anchors: [localPath.anchors[i], localPath.anchors[(i + 1) % n]], closed: false }),
    );
    return { localPath, d: buildPathD(localPath), segDs };
  }, [editState, editRect, view]);

  if (!isDraw && !isEdit) return null;

  // ------------------------------------------------------------ draw render
  if (isDraw) {
    const anchors = drawLocalPath?.anchors ?? [];
    const last = anchors[anchors.length - 1];
    const cursor = drawState.cursor ? iframeToOverlay(drawState.cursor, view) : null;
    const first = drawState.path.anchors[0];
    const nearFirst =
      !!first &&
      drawState.path.anchors.length >= 2 &&
      !!drawState.cursor &&
      Math.hypot(drawState.cursor.x - first.x, drawState.cursor.y - first.y) <= CLOSE_HIT_SCREEN_PX / scale;
    // Rubber band previews the REAL segment that a click would create — a
    // cubic when the last anchor carries an out-handle, a line otherwise.
    const rubberD =
      last && cursor && drawState.placing === null
        ? buildPathD({ anchors: [last, { x: cursor.x, y: cursor.y, corner: true }], closed: false })
        : null;

    return (
      <>
        <div
          ref={overlayRef}
          data-testid="pen-overlay"
          className="absolute inset-0 z-40"
          style={{ cursor: 'crosshair' }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            applyEvent(pointerEvent('pointerdown', e));
          }}
          onMouseMove={(e) => applyEvent(pointerEvent('pointermove', e))}
          onMouseUp={(e) => applyEvent(pointerEvent('pointerup', e))}
        />
        {/* Chrome: in-progress path, rubber band, anchor dots, handles */}
        <svg className="absolute inset-0 z-50 pointer-events-none" width="100%" height="100%">
          {drawLocalPath && (
            <path d={buildPathD(drawLocalPath)} fill="none" stroke={CHROME_STROKE} strokeWidth="1.5" />
          )}
          {rubberD && (
            <path d={rubberD} fill="none" stroke={CHROME_STROKE} strokeWidth="1" strokeDasharray="4 3" />
          )}
          {anchors.map((a, i) => (
            <g key={i}>
              {HANDLE_KINDS.map((kind) => {
                const h = a[kind];
                if (!h) return null;
                return (
                  <g key={kind}>
                    <line x1={a.x} y1={a.y} x2={a.x + h.dx} y2={a.y + h.dy} stroke={CHROME_SOFT} strokeWidth="1" />
                    <circle cx={a.x + h.dx} cy={a.y + h.dy} r="2.5" fill={CHROME_SOFT} />
                  </g>
                );
              })}
              <circle
                cx={a.x}
                cy={a.y}
                r={i === 0 && nearFirst ? 5 : 3}
                fill="#fff"
                stroke={CHROME_STROKE}
                strokeWidth="1.5"
              />
            </g>
          ))}
        </svg>
      </>
    );
  }

  // ------------------------------------------------------------ edit render
  if (!editChrome) {
    // Element vanished (or has no penPath / no scan rect yet) — nothing to draw.
    return null;
  }

  const eAnchors = editChrome.localPath.anchors;
  const n = eAnchors.length;
  // Figma-style focus: with an anchor selected, only its and its neighbors'
  // handles show; with none selected, show all so handles stay discoverable.
  const neighbor = (i: number, j: number) =>
    Math.abs(i - j) === 1 || (editChrome.localPath.closed && Math.abs(i - j) === n - 1);
  const handlesVisible = (i: number) =>
    selectedAnchor == null || i === selectedAnchor || neighbor(i, selectedAnchor);

  const startDrag = (kind: 'anchor' | 'hIn' | 'hOut', index: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragMovedRef.current = false;
    if (kind === 'anchor') setSelectedAnchor(index);
    const p = clientToElement(e.clientX, e.clientY);
    setEditState((s) =>
      s
        ? penEditReducer(s, {
            type: 'drag-start',
            target: { kind, index },
            x: p.x,
            y: p.y,
            alt: e.altKey,
            shift: e.shiftKey,
          })
        : s,
    );
  };

  return (
    <>
      {/* Click-empty finishes the session */}
      <div
        ref={overlayRef}
        data-testid="pen-edit-overlay"
        className="absolute inset-0 z-40"
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          exitSession();
        }}
      />
      <svg className="absolute inset-0 z-50" width="100%" height="100%" style={{ pointerEvents: 'none', overflow: 'visible' }}>
        <path d={editChrome.d} fill="none" stroke={CHROME_STROKE} strokeWidth="1.5" />
        {/* Fat invisible per-segment strokes: click adds an anchor */}
        {editChrome.segDs.map((d, i) => (
          <path
            key={`seg-${i}`}
            data-testid={`pen-segment-${i}`}
            d={d}
            fill="none"
            stroke="transparent"
            strokeWidth="10"
            style={{ pointerEvents: 'stroke', cursor: 'copy' }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const p = clientToElement(e.clientX, e.clientY);
              applyStructural({ type: 'add-anchor', segmentIndex: i, x: p.x, y: p.y });
            }}
          />
        ))}
        {eAnchors.map((a, i) => (
          <g key={i}>
            {handlesVisible(i) &&
              HANDLE_KINDS.map((kind) => {
                const h = a[kind];
                if (!h) return null;
                const tip = { x: a.x + h.dx, y: a.y + h.dy };
                return (
                  <g key={kind}>
                    <line x1={a.x} y1={a.y} x2={tip.x} y2={tip.y} stroke={CHROME_SOFT} strokeWidth="1" />
                    <g
                      data-testid={`pen-handle-${kind === 'hOut' ? 'out' : 'in'}-${i}`}
                      style={{ pointerEvents: 'auto', cursor: 'move' }}
                      onMouseDown={startDrag(kind, i)}
                    >
                      <circle cx={tip.x} cy={tip.y} r="6" fill="transparent" />
                      <circle cx={tip.x} cy={tip.y} r="3" fill={CHROME_SOFT} />
                    </g>
                  </g>
                );
              })}
            <g
              data-testid={`pen-anchor-${i}`}
              style={{ pointerEvents: 'auto', cursor: 'move' }}
              onMouseDown={startDrag('anchor', i)}
              onDoubleClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                applyStructural({ type: 'toggle-anchor', index: i });
              }}
            >
              <circle cx={a.x} cy={a.y} r="7" fill="transparent" />
              <circle
                cx={a.x}
                cy={a.y}
                r={selectedAnchor === i ? 4.5 : 3.5}
                fill={selectedAnchor === i ? CHROME_STROKE : '#fff'}
                stroke={CHROME_STROKE}
                strokeWidth="1.5"
              />
            </g>
          </g>
        ))}
      </svg>
    </>
  );
});
