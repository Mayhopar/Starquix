/**
 * Scan labeling of the instance-path blog slot (task-028 model).
 *
 * The BlogSlot component instance renders its collection slot as
 * `<div data-blog-source="posts">` (bridge Phase 5 multiplies the card
 * template inside it). The scan must report it as 'Blog Slot' — same label
 * the legacy DRAWN blog slot gets via data-slot-type="blog" — so the Layers
 * tree shows the slot icon instead of a plain 'div'. The sibling
 * data-blog-source="pagination" wrapper is NOT the slot and keeps its tag.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type ScannedEl = {
  key: string;
  tagName: string;
  slotName?: string;
};

function runScan(bridge: HarnessBridge): ScannedEl[] {
  delete (bridge as unknown as { scanElements?: unknown }).scanElements;
  (bridge as unknown as { mutationObserverStarted: boolean }).mutationObserverStarted = true;
  (bridge as unknown as { scanElements: () => void }).scanElements();
  const send = bridge.sendToParent as unknown as ReturnType<typeof vi.fn>;
  const scanned = send.mock.calls
    .map((c) => c[0] as { type: string; payload?: { elements: ScannedEl[] } })
    .find((m) => m.type === 'ELEMENTS_SCANNED');
  return scanned?.payload?.elements ?? [];
}

describe('scan labels the instance-path blog slot', () => {
  beforeEach(() => resetHarnessDom());

  it('data-blog-source="posts" wrapper reads as Blog Slot; pagination stays div', () => {
    document.body.innerHTML =
      '<section data-key="el-1:section-0">' +
      '<div data-key="el-1:div-0" data-blog-source="posts" class="grid">' +
      '<article data-key="el-1:article-0">card</article>' +
      '</div>' +
      '<div data-key="el-1:div-1" data-blog-source="pagination">1 2 3</div>' +
      '</section>';

    const bridge = mountBridgeForTest();
    const elements = runScan(bridge);

    const posts = elements.find((e) => e.key === 'el-1:div-0');
    expect(posts, 'posts wrapper must be in the scan').toBeTruthy();
    expect(posts!.tagName).toBe('Blog Slot');
    // Not a LAYOUT slot: no slotName stamp (that signal drives the layout
    // slot panel / SET_ELEMENT_SLOT_NAME re-homing, which don't apply here).
    expect(posts!.slotName).toBeUndefined();

    // task-240 (2026-09-12): the pagination container is transparent chrome
    // (utils.ts isBlogChrome) — never a row. See blog-chrome-transparent.test.ts.
    expect(elements.find((e) => e.key === 'el-1:div-1')).toBeUndefined();

    const card = elements.find((e) => e.key === 'el-1:article-0');
    expect(card!.tagName).toBe('article');
  });

  it('drawn blog slot labeling is unchanged (regression guard)', () => {
    document.body.innerHTML =
      '<div data-key="drawn-1" data-drawn="true" data-slot-type="blog">x</div>';

    const bridge = mountBridgeForTest();
    const elements = runScan(bridge);

    const drawn = elements.find((e) => e.key === 'drawn-1');
    expect(drawn!.tagName).toBe('Blog Slot');
  });
});
