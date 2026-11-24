/**
 * Keyboard forwarding out of the preview iframe.
 *
 * Focus inside a cross-origin preview iframe means the parent's document
 * keydown listener never fires — the ONLY path left is the bridge's
 * KEYBOARD_EVENT relay. Regression (2026-08-02, confirmed live in local mode
 * with the iframe focused): `r` (rect tool) and `2` (breakpoint sm) produced
 * NOTHING in the parent — no keydown, no KEYBOARD_EVENT — because
 * handleKeyDown's allowlist was a hardcoded ['v','V','a','A','t','T'] while the
 * editor had grown s/b/r/o/l/p, digits 1–6 and Shift+1.
 *
 * The harness mounts the real BRIDGE_EVENTS string, so what runs here is what
 * bridge.js ships.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';
import { BARE_SHORTCUT_KEYS, TOOL_SHORTCUTS, BREAKPOINT_SHORTCUT_KEYS } from '../../globalShortcuts';

function mount(): HarnessBridge {
  const bridge = mountBridgeForTest();
  (bridge.sendToParent as ReturnType<typeof vi.fn>).mockClear();
  return bridge;
}

/** The KEYBOARD_EVENT payloads this bridge relayed for one keydown. */
function forwarded(
  bridge: HarnessBridge,
  init: KeyboardEventInit & { target?: EventTarget },
): Array<Record<string, unknown>> {
  const { target, ...eventInit } = init;
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...eventInit });
  Object.defineProperty(event, 'target', { value: target ?? document.body });
  bridge.handleKeyDown(event);
  return (bridge.sendToParent as ReturnType<typeof vi.fn>).mock.calls
    .map((c) => c[0])
    .filter((m) => m.type === 'KEYBOARD_EVENT')
    .map((m) => m.payload);
}

describe('handleKeyDown forwards every bare-key editor shortcut', () => {
  beforeEach(() => resetHarnessDom());

  it.each(Object.keys(TOOL_SHORTCUTS))('forwards the %s tool key', (key) => {
    expect(forwarded(mount(), { key, code: `Key${key.toUpperCase()}` })).toEqual([
      expect.objectContaining({ key }),
    ]);
  });

  it.each(BREAKPOINT_SHORTCUT_KEYS)('forwards breakpoint key %s', (key) => {
    expect(forwarded(mount(), { key, code: `Digit${key}` })).toEqual([
      expect.objectContaining({ key }),
    ]);
  });

  it('forwards an uppercase tool key (CapsLock)', () => {
    expect(forwarded(mount(), { key: 'R', code: 'KeyR' })).toEqual([
      expect.objectContaining({ key: 'R' }),
    ]);
  });

  it('forwards Shift+1 (zoom to fit) with the code the parent matches on', () => {
    expect(forwarded(mount(), { key: '!', code: 'Digit1', shiftKey: true })).toEqual([
      expect.objectContaining({ code: 'Digit1', shiftKey: true }),
    ]);
  });

  it('still forwards modifier combos and control keys', () => {
    expect(forwarded(mount(), { key: 'k', code: 'KeyK', metaKey: true })).toEqual([
      expect.objectContaining({ key: 'k', metaKey: true }),
    ]);
    expect(forwarded(mount(), { key: 'Backspace', code: 'Backspace' })).toEqual([
      expect.objectContaining({ key: 'Backspace' }),
    ]);
  });

  // The parent's repeat guards (wrap, delete) only see what the relay carries.
  it('forwards key repeat', () => {
    expect(forwarded(mount(), { key: 'g', code: 'KeyG', metaKey: true, repeat: true })).toEqual([
      expect.objectContaining({ code: 'KeyG', repeat: true }),
    ]);
  });

  it('forwards nothing for a plain typed character that is not a shortcut', () => {
    expect(forwarded(mount(), { key: 'q', code: 'KeyQ' })).toEqual([]);
    expect(forwarded(mount(), { key: '7', code: 'Digit7' })).toEqual([]);
  });

  it('never preventDefaults a bare shortcut (the page keeps its own typing)', () => {
    const bridge = mount();
    const event = new KeyboardEvent('keydown', { key: 'r', code: 'KeyR', bubbles: true, cancelable: true });
    Object.defineProperty(event, 'target', { value: document.body });
    bridge.handleKeyDown(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('text entry inside the preview keeps its keystrokes', () => {
  beforeEach(() => resetHarnessDom());

  /** Every editable target must swallow the WHOLE bare-shortcut set. */
  it.each([
    ['input', () => document.createElement('input')],
    ['textarea', () => document.createElement('textarea')],
    ['select', () => document.createElement('select')],
    ['contentEditable', () => {
      const el = document.createElement('div');
      Object.defineProperty(el, 'isContentEditable', { value: true });
      return el;
    }],
  ])('forwards nothing while typing in a %s', (_name, make) => {
    const bridge = mount();
    const target = make();
    document.body.appendChild(target);
    for (const key of BARE_SHORTCUT_KEYS) {
      expect(forwarded(bridge, { key, target })).toEqual([]);
    }
  });
});
