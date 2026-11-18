import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom } from './harness';

type ScanBridge = ReturnType<typeof mountBridgeForTest> & {
  startMutationObserver(): void;
  stopMutationObserver(): void;
  isRelevantAddedNode(node: Node): boolean;
  handleSetPage(payload: { pageId: string }): void;
  handleNavigation(): void;
  resolveAssetRefsInDOM(): void;
  currentPath: string;
  _rescanCount: number;
};
let bridge: ScanBridge;
async function addTracked() {
  const node = document.createElement('p');
  node.setAttribute('data-sq-source', 'src/pages/index.astro:4:3');
  node.textContent = 'Measured paragraph';
  expect(bridge.isRelevantAddedNode(node)).toBe(true);
  document.body.append(node);
  await Promise.resolve();
  return node;
}
async function changePostLink() {
  document.querySelector('article a')!.setAttribute('href', '/post/new');
  await Promise.resolve();
}

describe('mutation observer trailing scans', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    resetHarnessDom();
    (window as Window & { __SQ_LOCAL_MODE__?: boolean }).__SQ_LOCAL_MODE__ = true;
    document.body.innerHTML = '<article data-key="article"><a data-key="link" href="/post/old">Post</a></article>';
    bridge = mountBridgeForTest() as ScanBridge;
    bridge._assetMap = {};
    bridge.startMutationObserver();
  });
  afterEach(() => {
    bridge.stopMutationObserver();
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
    resetHarnessDom();
    delete (window as Window & { __SQ_LOCAL_MODE__?: boolean }).__SQ_LOCAL_MODE__;
  });

  it('retains the only early source-tracked mutation until the minimum interval', async () => {
    await addTracked();
    await vi.advanceTimersByTimeAsync(200);
    expect(bridge.scanElements).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(bridge.scanElements).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(bridge.scanElements).toHaveBeenCalledTimes(1);
  });
  it('coalesces several early mutations into one eventual scan', async () => {
    await addTracked();
    await vi.advanceTimersByTimeAsync(100);
    await addTracked();
    await vi.advanceTimersByTimeAsync(100);
    await addTracked();
    await vi.advanceTimersByTimeAsync(300);
    expect(bridge.scanElements).toHaveBeenCalledTimes(1);
    expect(bridge._rescanCount).toBe(1);
  });
  it('retains an early mutation after a successful scan', async () => {
    await vi.advanceTimersByTimeAsync(400);
    await addTracked();
    await vi.advanceTimersByTimeAsync(200);
    expect(bridge.scanElements).toHaveBeenCalledTimes(1);
    await addTracked();
    await vi.advanceTimersByTimeAsync(200);
    expect(bridge.scanElements).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(bridge.scanElements).toHaveBeenCalledTimes(2);
  });
  it('rearms when the elapsed-time check finds the clock has moved backward', async () => {
    await changePostLink();
    await vi.advanceTimersByTimeAsync(400);
    vi.setSystemTime(100);
    await vi.advanceTimersByTimeAsync(100);
    expect(bridge.scanElements).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(bridge.scanElements).toHaveBeenCalledTimes(1);
  });
  it('keeps the external untracked structural DOM fallback', async () => {
    document.body.append(document.createElement('div'));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);
    expect(bridge.scanElements).toHaveBeenCalledTimes(1);
  });
  it('retains an image src-only update', async () => {
    const img = document.createElement('img');
    img.setAttribute('data-key', 'image');
    document.body.append(img);
    await Promise.resolve();
    img.src = '/new.png';
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);
    expect(bridge.scanElements).toHaveBeenCalledTimes(1);
  });
  it('ignores keyed additions and class-only changes', async () => {
    const node = document.createElement('p');
    node.setAttribute('data-sq-source', 'src/pages/index.astro:4:3');
    node.setAttribute('data-key', 'known');
    document.body.append(node);
    node.className = 'changed';
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(bridge.scanElements).not.toHaveBeenCalled();
  });
  it('keeps the ordinary rescan budget', async () => {
    bridge._rescanCount = 10;
    await addTracked();
    await vi.advanceTimersByTimeAsync(1000);
    expect(bridge.scanElements).not.toHaveBeenCalled();
  });
  it('scans post-link href updates after budget exhaustion without charging the budget', async () => {
    bridge._rescanCount = 10;
    await changePostLink();
    await vi.advanceTimersByTimeAsync(500);
    expect(bridge.scanElements).toHaveBeenCalledTimes(1);
    expect(bridge._rescanCount).toBe(10);
  });
  it.each(['post-first', 'ordinary-first'])('retains post-link exemption in a mixed pending batch: %s', async order => {
    if (order === 'post-first') await changePostLink();
    else await addTracked();
    await vi.advanceTimersByTimeAsync(100);
    if (order === 'post-first') await addTracked();
    else await changePostLink();
    await vi.advanceTimersByTimeAsync(400);
    expect(bridge.scanElements).toHaveBeenCalledTimes(1);
    expect(bridge._rescanCount).toBe(0);
  });
  it('cancels a pending scan when observation stops', async () => {
    await vi.advanceTimersByTimeAsync(400);
    await addTracked();
    await vi.advanceTimersByTimeAsync(50);
    bridge.stopMutationObserver();
    await vi.advanceTimersByTimeAsync(1000);
    expect(bridge.scanElements).not.toHaveBeenCalled();
  });
  it('does not run an old observer timer after stop and restart', async () => {
    await vi.advanceTimersByTimeAsync(400);
    await addTracked();
    await vi.advanceTimersByTimeAsync(50);
    bridge.stopMutationObserver();
    bridge.startMutationObserver();
    await vi.advanceTimersByTimeAsync(150);
    expect(bridge.scanElements).not.toHaveBeenCalled();
    await addTracked();
    await vi.advanceTimersByTimeAsync(350);
    expect(bridge.scanElements).toHaveBeenCalledTimes(1);
  });
  it('cancels old work on same-document SET_PAGE and observes the destination', async () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    await vi.advanceTimersByTimeAsync(400);
    await addTracked();
    bridge.handleSetPage({ pageId: 'destination' });
    await vi.advanceTimersByTimeAsync(200);
    expect(bridge.scanElements).not.toHaveBeenCalled();
    await addTracked();
    await vi.advanceTimersByTimeAsync(300);
    expect(bridge.scanElements).toHaveBeenCalledTimes(1);
  });
  it('keeps the explicit same-document navigation scan but cancels old mutation work', async () => {
    const style = document.createElement('style');
    style.id = 'sq-design-mode-styles';
    document.head.append(style);
    await vi.advanceTimersByTimeAsync(400);
    await addTracked();
    // Same realm/path change handling: full document navigation destroys timers itself.
    bridge.currentPath = '/previous';
    bridge.handleNavigation();
    await vi.advanceTimersByTimeAsync(100);
    expect(bridge.scanElements).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(bridge.scanElements).toHaveBeenCalledTimes(1);
    await addTracked();
    await vi.advanceTimersByTimeAsync(300);
    expect(bridge.scanElements).toHaveBeenCalledTimes(2);
  });
  it('resolves assets independently of the exhausted scan budget', async () => {
    bridge._assetMap = { asset: 'blob:asset' };
    bridge._rescanCount = 10;
    const resolve = vi.spyOn(bridge, 'resolveAssetRefsInDOM').mockImplementation(() => {});
    await addTracked();
    await vi.advanceTimersByTimeAsync(50);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(bridge.scanElements).not.toHaveBeenCalled();
  });
  it('cancels detached asset work and preserves the new observer asset timer', async () => {
    bridge._assetMap = { asset: 'blob:asset' };
    const resolve = vi.spyOn(bridge, 'resolveAssetRefsInDOM').mockImplementation(() => {});
    await addTracked();
    await vi.advanceTimersByTimeAsync(25);
    bridge.stopMutationObserver();
    bridge.startMutationObserver();
    await addTracked();
    await vi.advanceTimersByTimeAsync(25);
    expect(resolve).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(25);
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});
