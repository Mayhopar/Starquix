/**
 * Value gesture kit (instant-edit P2). One gesture = one commit = one journal row = one undo step = one file write.
 *
 *  - TYPED: the text lives in the input. Every keystroke restarts a settle timer (TYPED_SETTLE_MS); Enter, Tab and blur commit at
 *    once; Esc aborts. A partial value ("3" on the way to "300") is never committed and never painted. Each armed keystroke also
 *    runs the field's onChange in the 'stash' scope so the class it would produce is written to the safety net (gestureStash).
 *  - STEPPER (ArrowUp/Down, held or repeated): the running value comes from a ref (key repeat outruns React); each tick runs
 *    onChange in the 'preview' scope (paint + panel echo, no lane, no row, no undo step); the burst commits once,
 *    STEP_COMMIT_IDLE_MS after the last tick, or at MAX_HOLD_MS as a checkpoint. Esc aborts.
 *  - PIN: the element/breakpoint/theme/state a gesture began on. A commit runs the LATEST onChange only while the pin still holds;
 *    when the selection changes under a pending gesture it commits at once with the closure captured at its beginning.
 *  - Barriers (page switch, Cmd-S, undo, quit) push the pending gesture through host.hold; Cmd-Z in the field aborts a pending
 *    draft, otherwise it is the editor's undo (a native text undo is unreachable in a number field anyway).
 *
 * A kit leaf: it reaches the app only through the GestureHost a provider supplies (like setLocalTransport), and through the
 * ambient scope the class sink reads. No host = the field commits per event exactly as before.
 */
import { createContext, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';

export const TYPED_SETTLE_MS = 220;
export const STEP_COMMIT_IDLE_MS = 400;
export const MAX_HOLD_MS = 3000;

export type GestureScope = 'commit' | 'preview' | 'stash';
let scope: GestureScope = 'commit';
/** What the class sink (DesignBar.handleClassesChange) should do with the value the field's onChange composes right now. */
export const getGestureScope = (): GestureScope => scope;
export function runInGestureScope<T>(next: GestureScope, fn: () => T): T {
  const previous = scope; scope = next;
  try { return fn(); } finally { scope = previous; }
}

export interface GestureHost {
  /** The element, breakpoint, theme and state the field edits NOW. */
  pin: string;
  /** Register `push` while a gesture holds input; barriers call it. Returns the disposer. */
  hold(push: () => void): () => void;
  /** The editor's undo (Cmd-Z in a numeric field with nothing pending). */
  undo(): void;
  /** Put the panel and the canvas back after an aborted gesture. */
  abort(): void;
}
export const GestureHostContext = createContext<GestureHost | null>(null);

export interface ValueGestureOptions {
  /** The committed (rendered) value as text. */
  value: string;
  onChange: (text: string) => void;
  host: GestureHost | null;
  enabled: boolean;
  min?: number;
  max?: number;
}

export interface ValueGesture {
  /** What the input shows: the pending text, else the committed value. */
  text: string;
  onText(next: string): void;
  onCompositionStart(): void;
  onCompositionEnd(): void;
  /** True when the key was handled (the caller must not run its own stepping). */
  onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): boolean;
  onBlur(): void;
}

export function useValueGesture(options: ValueGestureOptions): ValueGesture {
  const { value, host, enabled } = options;
  const [draft, setDraft] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const runningRef = useRef<number | null>(null);
  const modeRef = useRef<'typed' | 'step' | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const beganRef = useRef<{ onChange: (text: string) => void; pin: string; at: number } | null>(null);
  const releaseRef = useRef<(() => void) | null>(null);
  const composingRef = useRef(false);
  const latest = useRef(options);
  latest.current = options;

  const clearTimer = () => { if (timerRef.current !== undefined) { clearTimeout(timerRef.current); timerRef.current = undefined; } };
  const end = () => {
    clearTimer();
    draftRef.current = null; runningRef.current = null; modeRef.current = null; beganRef.current = null;
    releaseRef.current?.(); releaseRef.current = null;
    setDraft(null);
  };

  const commit = useCallback(() => {
    const text = draftRef.current;
    if (text === null) return;
    const began = beganRef.current;
    const current = latest.current;
    // The LATEST closure only while the pin still holds; otherwise the one captured when the gesture began.
    const run = began && current.host && current.host.pin !== began.pin ? began.onChange : current.onChange;
    end();
    runInGestureScope('commit', () => run(text));
  }, []);

  const begin = () => {
    if (beganRef.current) return;
    const current = latest.current;
    beganRef.current = { onChange: current.onChange, pin: current.host?.pin ?? '', at: Date.now() };
    releaseRef.current = current.host ? current.host.hold(commit) : null;
  };

  const abort = useCallback(() => {
    const had = draftRef.current !== null || beganRef.current !== null;
    end();
    if (had) latest.current.host?.abort();
  }, []);

  const arm = (ms: number) => { clearTimer(); timerRef.current = setTimeout(commit, ms); };

  const onText = useCallback((next: string) => {
    if (!latest.current.enabled) { latest.current.onChange(next); return; }
    begin();
    modeRef.current = 'typed'; runningRef.current = null;
    draftRef.current = next; setDraft(next);
    if (composingRef.current) return;
    arm(TYPED_SETTLE_MS);
    if (next.trim() !== '') runInGestureScope('stash', () => latest.current.onChange(next));
  }, []);

  const step = (delta: number) => {
    const current = latest.current;
    const base = runningRef.current ?? parseFloat(draftRef.current ?? current.value);
    if (!Number.isFinite(base)) return;
    let next = base + delta;
    if (current.min !== undefined && next < current.min) next = current.min;
    if (current.max !== undefined && next > current.max) next = current.max;
    begin();
    // A typed draft that was pending when an arrow arrived is replaced by the stepping value.
    modeRef.current = 'step'; runningRef.current = next;
    draftRef.current = String(next); setDraft(String(next));
    runInGestureScope('preview', () => current.onChange(String(next)));
    // A hold longer than MAX_HOLD_MS commits a checkpoint (one more undo step) and keeps stepping.
    if (beganRef.current && Date.now() - beganRef.current.at > MAX_HOLD_MS) {
      const running = runningRef.current;
      commit();
      runningRef.current = running; modeRef.current = 'step';
      begin(); draftRef.current = String(running); setDraft(String(running));
    }
    arm(STEP_COMMIT_IDLE_MS);
  };

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>): boolean => {
    if (!latest.current.enabled) return false;
    const composing = composingRef.current || event.nativeEvent?.isComposing || event.keyCode === 229;
    const pending = draftRef.current !== null;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      if (composing) return false;
      event.preventDefault();
      step((event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 10 : 1));
      return true;
    }
    if (composing) return false;
    if (event.key === 'Enter' || event.key === 'Tab') { commit(); return false; }
    if (event.key === 'Escape' && pending) { event.preventDefault(); event.stopPropagation(); abort(); return true; }
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (pending) abort(); else latest.current.host?.undo();
      return true;
    }
    return false;
  }, [commit, abort]);

  // The selection (the pin) changed under a pending gesture, or the field unmounted: commit now, never cancel.
  useLayoutEffect(() => () => { if (draftRef.current !== null) commit(); }, [host?.pin, commit]);
  useEffect(() => () => { clearTimer(); releaseRef.current?.(); releaseRef.current = null; }, []);

  return useMemo(() => ({
    text: enabled && draft !== null ? draft : value,
    onText,
    onCompositionStart: () => { composingRef.current = true; },
    onCompositionEnd: () => { composingRef.current = false; if (draftRef.current !== null && modeRef.current === 'typed') arm(TYPED_SETTLE_MS); },
    onKeyDown,
    onBlur: () => { if (enabled) commit(); },
  }), [enabled, draft, value, onText, onKeyDown, commit]);
}
