/**
 * task-206: SET_MEDIA_DEMO — the component viewer's MediaBlock drives the
 * demo preview live (no invocation to write there). The handler mutates the
 * rendered .sq-media in place: count grows/shrinks placeholder slots, style
 * knobs set the --sq-media-* vars.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type Bridge = HarnessBridge & {
  handleSetMediaDemo: (p: unknown) => void;
  handleMessage: (m: { type: string; payload?: unknown }) => void;
};

function mount(): Bridge {
  document.body.innerHTML =
    '<div class="sq-media col-span-8" data-sq-unit="media" style="--sq-media-count:2">' +
    '<button class="sq-media-placeholder" data-sq-media-slot="0" data-sq-media="true"></button>' +
    '<button class="sq-media-placeholder" data-sq-media-slot="1" data-sq-media="true"></button>' +
    '</div>';
  return mountBridgeForTest() as unknown as Bridge;
}

const root = () => document.querySelector('.sq-media') as HTMLElement;
const slots = () => document.querySelectorAll('[data-sq-media-slot]');

describe('handleSetMediaDemo', () => {
  beforeEach(() => resetHarnessDom());

  it('count 3 grows placeholder slots + the count var', () => {
    const bridge = mount();
    bridge.handleSetMediaDemo({ count: 3 });
    expect(slots().length).toBe(3);
    expect(root().style.getPropertyValue('--sq-media-count')).toBe('3');
    const added = slots()[2] as HTMLElement;
    expect(added.className).toContain('sq-media-placeholder');
    expect(added.getAttribute('data-sq-media')).toBe('true');
  });

  it('count 1 shrinks from the end', () => {
    const bridge = mount();
    bridge.handleSetMediaDemo({ count: 1 });
    expect(slots().length).toBe(1);
    expect((slots()[0] as HTMLElement).getAttribute('data-sq-media-slot')).toBe('0');
  });

  it('pushes fresh rects synchronously — the overlay travels with the change', () => {
    const bridge = mount() as unknown as Bridge & { sendRectsUpdate: () => void };
    const spy = vi.fn();
    (bridge as { sendRectsUpdate: () => void }).sendRectsUpdate = spy;
    bridge.handleSetMediaDemo({ count: 3 });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('vars set and clear --sq-media-* custom properties', () => {
    const bridge = mount();
    bridge.handleSetMediaDemo({ vars: { gap: 24, radius: 12 } });
    expect(root().style.getPropertyValue('--sq-media-gap')).toBe('24px');
    expect(root().style.getPropertyValue('--sq-media-radius')).toBe('12px');
    bridge.handleSetMediaDemo({ vars: { gap: null } });
    expect(root().style.getPropertyValue('--sq-media-gap')).toBe('');
  });

  it('is registered for the SET_MEDIA_DEMO message', () => {
    const bridge = mount() as unknown as {
      registerHandlers: () => void;
      _handlers: Record<string, (p: unknown) => void>;
    };
    bridge._handlers = {};
    bridge.registerHandlers();
    bridge._handlers['SET_MEDIA_DEMO']({ count: 3 });
    expect(slots().length).toBe(3);
  });

  it('no .sq-media on the page → no-op, no throw', () => {
    document.body.innerHTML = '<p>plain</p>';
    const bridge = mountBridgeForTest() as unknown as Bridge;
    expect(() => bridge.handleSetMediaDemo({ count: 2 })).not.toThrow();
  });
});
