/**
 * task-120 (5.5) — bg-image thumbnail capture cached per (key, resolved
 * URL): the second request for the same element resends the cached data
 * URL without a new Image load + canvas encode.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type BgBridge = HarnessBridge & {
  captureAndSendBgImagePreview: (element: Element, key: string) => void;
  _makeThumbnail: (img: unknown) => string | null;
  _bgThumbCache: Record<string, string>;
};

let imageInstances: number;

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  crossOrigin = '';
  private _src = '';
  constructor() {
    imageInstances++;
  }
  set src(v: string) {
    this._src = v;
    queueMicrotask(() => this.onload?.());
  }
  get src(): string {
    return this._src;
  }
}

describe('bg thumbnail cache', () => {
  beforeEach(() => {
    resetHarnessDom();
    imageInstances = 0;
    vi.stubGlobal('Image', FakeImage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('second capture for the same (key, url) skips the Image load', async () => {
    const bridge = mountBridgeForTest() as BgBridge;
    bridge._makeThumbnail = () => 'data:image/jpeg;thumb';

    const el = document.createElement('div');
    document.body.appendChild(el);
    // jsdom getComputedStyle won't resolve CSS backgrounds — set inline.
    el.style.backgroundImage = "url('blob:test/bg1')";

    bridge.captureAndSendBgImagePreview(el, 'k1');
    await new Promise<void>((r) => queueMicrotask(r)); // let FakeImage onload fire
    expect(imageInstances).toBe(1);

    bridge.captureAndSendBgImagePreview(el, 'k1');
    await new Promise<void>((r) => queueMicrotask(r));
    expect(imageInstances).toBe(1); // served from cache

    const previews = (bridge.sendToParent as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => (c[0] as { type: string }).type === 'BG_IMAGE_PREVIEW');
    expect(previews.length).toBe(2); // both requests answered
    expect((previews[1][0] as { payload: { dataUrl: string } }).payload.dataUrl)
      .toBe('data:image/jpeg;thumb');
  });

  it('a different URL for the same key re-captures', async () => {
    const bridge = mountBridgeForTest() as BgBridge;
    bridge._makeThumbnail = () => 'data:image/jpeg;thumb';
    const el = document.createElement('div');
    document.body.appendChild(el);
    el.style.backgroundImage = "url('blob:test/bg1')";

    bridge.captureAndSendBgImagePreview(el, 'k1');
    await new Promise<void>((r) => queueMicrotask(r));
    el.style.backgroundImage = "url('blob:test/bg2')";
    bridge.captureAndSendBgImagePreview(el, 'k1');
    await new Promise<void>((r) => queueMicrotask(r));
    expect(imageInstances).toBe(2);
  });
});
