/** task-120 (4.2) — hoveredRect external store: identity-guarded set + subscribe. */
import { describe, it, expect } from 'vitest';
import { hoverRectStore, altKeyStore } from '../hoverRectStore';

describe('hoverRectStore', () => {
  it('notifies subscribers on change, skips identical reference', () => {
    let calls = 0;
    const unsub = hoverRectStore.subscribe(() => calls++);
    const info = { rect: { top: 1, left: 2, width: 3, height: 4 }, key: 'k1', tagName: 'img' };
    hoverRectStore.set(info);
    expect(calls).toBe(1);
    expect(hoverRectStore.get()).toBe(info);
    hoverRectStore.set(info); // same reference → no notify
    expect(calls).toBe(1);
    hoverRectStore.set(null);
    expect(calls).toBe(2);
    unsub();
    hoverRectStore.set(info);
    expect(calls).toBe(2);
    hoverRectStore.set(null);
  });
});

describe('altKeyStore', () => {
  it('follows Option down/up and blur while subscribed; self-heals from any key event', () => {
    const unsub = altKeyStore.subscribe(() => {});
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true }));
    expect(altKeyStore.get()).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt' }));
    expect(altKeyStore.get()).toBe(false);
    altKeyStore.set(true); // bridge relay
    window.dispatchEvent(new Event('blur'));
    expect(altKeyStore.get()).toBe(false);
    altKeyStore.set(true); // a keyup was missed…
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', altKey: false }));
    expect(altKeyStore.get()).toBe(false); // …the next key event corrects it
    unsub();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true }));
    expect(altKeyStore.get()).toBe(false); // no listeners once nobody subscribes
  });
});
