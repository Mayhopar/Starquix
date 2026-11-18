/**
 * Video upload support (2026-07-30 design): handleUpdateImageAttribute must
 * accept <video> elements — src (with sq-asset: resolution + pending queue)
 * and boolean playback attrs ('true'/'false' strings → attribute + property).
 * resolveAssetRefsInDOM must also resolve sq-asset: refs on <video src>.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type VideoBridge = HarnessBridge & {
  _assetMap: Record<string, string>;
  _assetHashes: Record<string, string>;
  _pendingAssetImages: Record<string, unknown>;
  _pendingAssetClasses: Record<string, unknown>;
  handleUpdateImageAttribute: (p: { key: string; attribute: string; value: string }) => void;
  resolveAssetRefsInDOM: () => void;
};

function mountVideoBridge(): VideoBridge {
  const b = mountBridgeForTest() as VideoBridge;
  b._assetMap = {};
  b._pendingAssetImages = {};
  b._pendingAssetClasses = {};
  return b;
}

describe('handleUpdateImageAttribute — <video> support', () => {
  beforeEach(() => resetHarnessDom());

  it('updates video src, resolving sq-asset: refs from the asset map', () => {
    const bridge = mountVideoBridge();
    bridge._assetMap['abc-123'] = 'blob:http://localhost/resolved';
    document.body.innerHTML = '<video data-key="el-x:video-0"></video>';

    bridge.handleUpdateImageAttribute({ key: 'el-x:video-0', attribute: 'src', value: 'sq-asset:abc-123' });

    const video = document.querySelector('video') as HTMLVideoElement;
    expect(video.getAttribute('src')).toBe('blob:http://localhost/resolved');
  });

  it('queues the update when the asset has not been transferred yet', () => {
    const bridge = mountVideoBridge();
    document.body.innerHTML = '<video data-key="el-x:video-0"></video>';

    bridge.handleUpdateImageAttribute({ key: 'el-x:video-0', attribute: 'src', value: 'sq-asset:not-yet' });

    const video = document.querySelector('video') as HTMLVideoElement;
    expect(video.getAttribute('src')).toBeNull();
    expect(bridge._pendingAssetImages['el-x:video-0']).toBeTruthy();
  });

  it("boolean attr 'true' sets attribute AND property", () => {
    const bridge = mountVideoBridge();
    document.body.innerHTML = '<video data-key="el-x:video-0"></video>';
    const video = document.querySelector('video') as HTMLVideoElement;

    bridge.handleUpdateImageAttribute({ key: 'el-x:video-0', attribute: 'controls', value: 'true' });

    expect(video.hasAttribute('controls')).toBe(true);
    expect(video.controls).toBe(true);
  });

  it("boolean attr 'false' removes attribute AND clears property", () => {
    const bridge = mountVideoBridge();
    document.body.innerHTML = '<video data-key="el-x:video-0" loop muted></video>';
    const video = document.querySelector('video') as HTMLVideoElement;
    expect(video.loop).toBe(true);

    bridge.handleUpdateImageAttribute({ key: 'el-x:video-0', attribute: 'loop', value: 'false' });

    expect(video.hasAttribute('loop')).toBe(false);
    expect(video.loop).toBe(false);
    expect(video.hasAttribute('muted')).toBe(true); // untouched
  });

  it('still rejects non-media elements', () => {
    const bridge = mountVideoBridge();
    document.body.innerHTML = '<div data-key="el-x:div-0"></div>';

    bridge.handleUpdateImageAttribute({ key: 'el-x:div-0', attribute: 'src', value: '/x.mp4' });

    expect(document.querySelector('div')?.getAttribute('src')).toBeNull();
  });
});

describe('resolveAssetRefsInDOM — <video src>', () => {
  beforeEach(() => resetHarnessDom());

  it('resolves sq-asset: refs on video elements', () => {
    const bridge = mountVideoBridge();
    bridge._assetMap['abc-123'] = 'blob:http://localhost/clip';
    document.body.innerHTML = '<video data-key="el-x:video-0" src="sq-asset:abc-123"></video>';

    bridge.resolveAssetRefsInDOM();

    const video = document.querySelector('video') as HTMLVideoElement;
    expect(video.getAttribute('src')).toBe('blob:http://localhost/clip');
  });
});
