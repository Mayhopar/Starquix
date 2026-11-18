/**
 * Files-truth blog chrome is TRANSPARENT (task-240 follow-up, 2026-09-12).
 *
 * A bound page wraps every card in OUR post-link wrapper
 * (`<a href data-sq-post-slug><BlogCard/></a>` / `<div data-sq-post-slug>`,
 * utils/blogBinding emit) and BlogSlot.astro wraps its pagination slot in
 * `<div data-blog-source="pagination">`. Both are chrome, not the user's
 * elements. Scanned as elements they were:
 *  - a page-file row (`src/pages/blog.astro:14:28#N`) BETWEEN the posts
 *    container and the BlogCard root — the drill stopped on it, and the
 *    DesignBar showed a "BlogCard" (post-root naming) with the pencil but no
 *    ↗ / ⋮, which only a component-file PLACEMENT ROOT gets;
 *  - a 0×0 "div" row when pagination is off.
 * Contract: neither is a layer nor a click/drill stop; their children nest
 * under the next tracked ancestor. The wrapper's slug still reaches the card
 * (closest('[data-sq-post-slug]') walks through it).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type ScannedEl = { key: string; parentKey: string | null; postSlug?: string; tagName: string };

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

/** Tag an element the way the plugin + Astro dev do (source key + astro loc). */
function tagSource(id: string, source: string) {
  const el = document.getElementById(id)!;
  el.setAttribute('data-sq-source', source);
  el.setAttribute('data-astro-source-file', '/p/' + source.split(':')[0]);
  el.setAttribute('data-astro-source-loc', source.split(':').slice(1).join(':'));
  return el;
}

const SLOT = 'src/components/BlogSlot.astro:9:1';
const POSTS = 'src/components/BlogSlot.astro:10:3';
const PAGINATION = 'src/components/BlogSlot.astro:15:3';
const WRAP = 'src/pages/blog.astro:14:28';
const CARD = 'src/components/BlogCard.astro:14:1';
const TITLE = 'src/components/BlogCard.astro:18:5';

function mountBoundBlog(wrapperTag: 'a' | 'div' = 'a') {
  const open = wrapperTag === 'a' ? '<a id="wrap" href="/works/x" class="block" data-sq-post-slug="x">' : '<div id="wrap" data-sq-post-slug="x">';
  document.body.innerHTML =
    '<section id="slot">' +
    '<div id="posts" data-blog-source="posts">' +
    open + '<article id="card"><h3 id="title">x</h3></article></' + wrapperTag + '>' +
    '</div>' +
    '<div id="pagination" data-blog-source="pagination"></div>' +
    '</section>';
  tagSource('slot', SLOT);
  tagSource('posts', POSTS);
  tagSource('pagination', PAGINATION);
  tagSource('wrap', WRAP);
  tagSource('card', CARD);
  tagSource('title', TITLE);
  return mountBridgeForTest();
}

beforeEach(() => resetHarnessDom());

describe('scan — the card wrapper and the pagination container are not rows', () => {
  it.each(['a', 'div'] as const)('<%s data-sq-post-slug> wrapper: card nests under the posts container and keeps the slug', (tag) => {
    const bridge = mountBoundBlog(tag);
    const elements = runScan(bridge);
    const keys = elements.map((e) => e.key);

    expect(keys).not.toContain(WRAP);
    expect(keys).not.toContain(PAGINATION);
    expect(keys).toEqual(expect.arrayContaining([SLOT, POSTS, CARD, TITLE]));

    const card = elements.find((e) => e.key === CARD)!;
    expect(card.parentKey).toBe(POSTS);
    expect(card.postSlug).toBe('x');
    expect(elements.find((e) => e.key === TITLE)!.parentKey).toBe(CARD);
  });

  it('a FILLED pagination container is still transparent: the pagination root nests under the slot', () => {
    const bridge = mountBoundBlog();
    document.getElementById('pagination')!.innerHTML = '<nav id="pager">1 2 3</nav>';
    tagSource('pager', 'src/components/BlogPaginationNumbered.astro:8:1');
    const elements = runScan(bridge);
    expect(elements.map((e) => e.key)).not.toContain(PAGINATION);
    expect(elements.find((e) => e.key === 'src/components/BlogPaginationNumbered.astro:8:1')!.parentKey).toBe(SLOT);
  });
});

describe('click / drill — the wrapper is never a stop', () => {
  it('isTrackedElement: wrapper and pagination container are untracked, the card is tracked', () => {
    const bridge = mountBoundBlog() as unknown as { isTrackedElement: (el: Element) => boolean };
    expect(bridge.isTrackedElement(document.getElementById('wrap')!)).toBe(false);
    expect(bridge.isTrackedElement(document.getElementById('pagination')!)).toBe(false);
    expect(bridge.isTrackedElement(document.getElementById('card')!)).toBe(true);
  });

  it('drilled into the posts container, a click on the title selects the BlogCard root', () => {
    const bridge = mountBoundBlog();
    runScan(bridge); // stamps data-key (findEditableElement compares keys)
    (bridge as unknown as { contextKey: string | null }).contextKey = POSTS;
    const picked = bridge.findEditableElement(document.getElementById('title')!, true, false);
    expect(picked).toBe(document.getElementById('card'));
  });

  it('with no context, the outermost stop above the card is the posts container chain, never the wrapper', () => {
    const bridge = mountBoundBlog();
    runScan(bridge);
    (bridge as unknown as { contextKey: string | null }).contextKey = null;
    const picked = bridge.findEditableElement(document.getElementById('title')!, true, false);
    expect(picked).not.toBe(document.getElementById('wrap'));
    expect(picked).toBe(document.getElementById('slot'));
  });
});
