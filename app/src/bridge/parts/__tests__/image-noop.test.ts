/**
 * handleUpdateImageAttribute no-op guard (task-078).
 *
 * The parent re-applies source image attributes on EVERY ELEMENTS_SCANNED
 * (reapplySourceImageAttrOverrides — it can't equality-check parent-side).
 * Re-setting img.src to its current value makes the browser re-fetch the image,
 * which flashes on every scan (e.g. right after a frame is drawn). The bridge
 * must skip the write when the attribute value is unchanged.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type ImgBridge = HarnessBridge & {
  _assetMap: Record<string, string>;
  _pendingAssetImages: Record<string, unknown>;
  handleUpdateImageAttribute: (p: { key: string; attribute: string; value: string }) => void;
};

function mountImgBridge(): ImgBridge {
  const b = mountBridgeForTest() as ImgBridge;
  b._assetMap = {};
  b._pendingAssetImages = {};
  return b;
}

describe('handleUpdateImageAttribute — no-op guard', () => {
  beforeEach(() => resetHarnessDom());

  it('does NOT re-set img.src when the value is unchanged (no re-fetch / no blink)', () => {
    const bridge = mountImgBridge();
    document.body.innerHTML = '<img data-key="el-x:img-0" src="/photo.png" />';
    const img = document.querySelector('img') as HTMLImageElement;

    let setCount = 0;
    const realSet = img.setAttribute.bind(img);
    img.setAttribute = (name: string, value: string) => {
      if (name === 'src') setCount++;
      return realSet(name, value);
    };

    // Re-apply the SAME src (what the scan re-apply does every scan).
    bridge.handleUpdateImageAttribute({ key: 'el-x:img-0', attribute: 'src', value: '/photo.png' });

    expect(setCount).toBe(0);
    expect(img.getAttribute('src')).toBe('/photo.png');
  });

  it('DOES set img.src when the value actually changes', () => {
    const bridge = mountImgBridge();
    document.body.innerHTML = '<img data-key="el-x:img-0" src="/photo.png" />';
    const img = document.querySelector('img') as HTMLImageElement;

    bridge.handleUpdateImageAttribute({ key: 'el-x:img-0', attribute: 'src', value: '/other.png' });

    expect(img.getAttribute('src')).toBe('/other.png');
  });
});
