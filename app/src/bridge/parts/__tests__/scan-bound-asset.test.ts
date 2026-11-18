/**
 * task-143 — ELEMENTS_SCANNED carries the bound-asset handle for astro
 * <Image> imgs (decoded from the dev /_image?href=/@fs… URL) and the owning
 * component file for prop-driven imgs. Without these a Layers-panel selection
 * classified the SAME img differently than a canvas click: the Fill Media tab
 * showed the dead-end "comes from component props" note instead of the bound
 * Replace/Delete UI.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type ScannedEl = {
  key: string;
  tagName: string;
  boundAssetPath?: string;
  ownerComponentFile?: string;
  imageComponentIndex?: number;
};

function runScan(bridge: HarnessBridge): ScannedEl[] {
  delete (bridge as unknown as { scanElements?: unknown }).scanElements;
  (bridge as unknown as { _assetMap: Record<string, string> })._assetMap = {};
  (bridge as unknown as { mutationObserverStarted: boolean }).mutationObserverStarted = true;
  (bridge as unknown as { scanElements: () => void }).scanElements();
  const send = bridge.sendToParent as unknown as ReturnType<typeof vi.fn>;
  const scanned = send.mock.calls
    .map((c) => c[0] as { type: string; payload?: { elements: ScannedEl[] } })
    .find((m) => m.type === 'ELEMENTS_SCANNED');
  return scanned?.payload?.elements ?? [];
}

describe('scan reports boundAssetPath / ownerComponentFile for imgs', () => {
  beforeEach(() => resetHarnessDom());

  it('decodes the /_image?href=/@fs… src into the real asset path', () => {
    const href = encodeURIComponent('/@fs/Users/me/site/src/content/works/images/cover.jpg?origWidth=2680');
    // A source-tracked sibling keeps the scan from bailing into its
    // zero-tracked-elements retry loop (astro <Image> imgs are untracked).
    document.body.innerHTML =
      '<div data-sq-source="src/pages/index.astro:1:1" data-key="src/pages/index.astro:1:1">x</div>' +
      `<img data-image-component="true" src="/_image?href=${href}&w=1340&f=webp" />`;

    const bridge = mountBridgeForTest();
    const img = runScan(bridge).find((e) => e.tagName === 'img')!;

    expect(img.boundAssetPath).toBe('/Users/me/site/src/content/works/images/cover.jpg');
  });

  it('no handle for node_modules-backed or non-/_image srcs', () => {
    const nmHref = encodeURIComponent('/@fs/Users/me/site/node_modules/pkg/img.png');
    document.body.innerHTML =
      '<div data-sq-source="src/pages/index.astro:1:1" data-key="src/pages/index.astro:1:1">x</div>' +
      `<img data-image-component="true" src="/_image?href=${nmHref}" />` +
      '<img data-image-component="true" src="/plain.png" />';

    const bridge = mountBridgeForTest();
    const imgs = runScan(bridge).filter((e) => e.tagName === 'img');

    expect(imgs).toHaveLength(2);
    for (const img of imgs) expect(img.boundAssetPath).toBeUndefined();
    // task-143: astro-<Image> imgs carry their document-order index (the
    // component-default-image write maps it to the nth image tag in source)
    expect(imgs.map(i => i.imageComponentIndex)).toEqual([0, 1]);
  });

  it('prop-driven img (no source location) names the owning component file', () => {
    document.body.innerHTML =
      '<div data-sq-source="src/components/FeaturedWork.astro:3:1" data-key="src/components/FeaturedWork.astro:3:1">' +
      '<img data-image-component="true" src="/placeholder.png" />' +
      '</div>';

    const bridge = mountBridgeForTest();
    const img = runScan(bridge).find((e) => e.tagName === 'img')!;

    expect(img.ownerComponentFile).toBe('src/components/FeaturedWork.astro');
  });

  it('img with its own source location gets NO ownerComponentFile', () => {
    document.body.innerHTML =
      '<div data-sq-source="src/components/Card.astro:1:1" data-key="src/components/Card.astro:1:1">' +
      '<img data-sq-source="src/components/Card.astro:5:1" data-key="src/components/Card.astro:5:1" src="/x.png" />' +
      '</div>';

    const bridge = mountBridgeForTest();
    const img = runScan(bridge).find((e) => e.tagName === 'img')!;

    expect(img.ownerComponentFile).toBeUndefined();
  });
});
