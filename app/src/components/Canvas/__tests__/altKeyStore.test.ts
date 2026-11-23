import { describe, it, expect } from 'vitest';
import { altKeyStore } from '../altKeyStore';

describe('altKeyStore', () => {
  it('follows Option down/up and blur while subscribed; self-heals from any key event', () => {
    const unsub = altKeyStore.subscribe(() => {});
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true }));
    expect(altKeyStore.get()).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt' }));
    expect(altKeyStore.get()).toBe(false);
    altKeyStore.set(true); // a canvas mouse move with Option held
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
