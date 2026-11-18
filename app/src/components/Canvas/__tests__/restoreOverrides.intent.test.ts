/** instant-edit P0b: the first-edit undo path must carry the intent through ALL THREE hops (observer request ->
 * relay -> RESTORE_ORIGINAL_CLASSES -> the bridge's handleUpdateClasses); a restore without one is dropped for a
 * held key. This is the middle hop: the intent is forwarded only to a document that announced intents. */
import { describe, expect, it, vi } from 'vitest';
import { applyClassRestore } from '../restoreOverrides';

const frame = () => { const postMessage = vi.fn(); return { iframe: { contentWindow: { postMessage } } as unknown as HTMLIFrameElement, postMessage }; };
const request = { key: 'k', fallbackClasses: 'w-full', intent: { epoch: 'e', seq: 4, hold: true } };

describe('applyClassRestore intent hop', () => {
  it('forwards the intent to a document that understands intents', () => {
    const { iframe, postMessage } = frame();
    applyClassRestore({ iframe, pendingKeyUpdates: new Map(), intents: true }, request);
    expect(postMessage).toHaveBeenCalledWith({ type: 'RESTORE_ORIGINAL_CLASSES', payload: { key: 'k', fallbackClasses: 'w-full', intent: request.intent } }, '*');
  });
  it('strips it for an older bridge', () => {
    const { iframe, postMessage } = frame();
    applyClassRestore({ iframe, pendingKeyUpdates: new Map(), intents: false }, request);
    expect(postMessage).toHaveBeenCalledWith({ type: 'RESTORE_ORIGINAL_CLASSES', payload: { key: 'k', fallbackClasses: 'w-full' } }, '*');
  });
  it('still evicts the key from the retry queue', () => {
    const { iframe } = frame(); const pending = new Map<string, unknown>([['k', {}]]);
    applyClassRestore({ iframe, pendingKeyUpdates: pending, intents: true }, request);
    expect(pending.has('k')).toBe(false);
  });
});
