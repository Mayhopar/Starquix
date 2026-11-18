import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { parseKey } from '@/store/types';
import {
  isRenderedMasterRoot,
  collectMasterInstanceIds,
  isMasterYjsEntry,
} from '@/store/masterEntity';
import { wrapPostPageInBlogPost } from '../wrapPostPageInBlogPost';
import { BLOG_POST_ASTRO_SOURCE } from '../blogPostTemplate';

/**
 * Regression test for the "Go to page template" button dispatching an empty
 * `{path: null, name: undefined}` detail.
 *
 * Bug: DesignBar resolved `instanceId` for `<wrapperId>:<selector>` keys via
 * `isInstanceChild && parsedKey.instanceId` — but when the scanned key was
 * the BlogPost wrapper's rendered-master-root (its outer Layout tag), the
 * `isInstanceChild` flag was forced false, so `instanceId` fell back to the
 * compound key string. `elements.get('wrapperId:layout-0')` returns nothing,
 * so `astroSource` resolved to null and Go-to-source fired with no payload.
 *
 * Fix: any instance-child key form resolves through `parsedKey.instanceId`,
 * regardless of the rendered-master-root flag. The wrapper's actual Yjs id
 * is what stores the astroSource.
 */
describe('BlogPost wrapper rendered-root → astroSource resolution', () => {
  const FAKE_BLOGPOST_HTML =
    '<header data-sq-source="Header.astro:5:1">H</header><slot></slot><footer data-sq-source="Footer.astro:5:1">F</footer>';

  it('the wrapper outer tag is a rendered-master-root with the wrapper as its instance', async () => {
    const doc = new Y.Doc();
  doc.getMap('meta').set('projectId', crypto.randomUUID());
    // Seed a post page with one root, then wrap it.
    const pages = doc.getMap('pages');
    const elements = doc.getMap('elements');
    const page = new Y.Map();
    page.set('id', 'page-1');
    page.set('pageType', 'post');
    const rootIds = new Y.Array<string>();
    rootIds.push(['article-1']);
    page.set('rootElementIds', rootIds);
    pages.set('page-1', page);
    const article = new Y.Map();
    article.set('id', 'article-1');
    article.set('pageId', 'page-1');
    article.set('parentId', null);
    article.set('staticMarkup', '<article id="article-1"></article>');
    elements.set('article-1', article);

    await wrapPostPageInBlogPost(doc, 'page-1', FAKE_BLOGPOST_HTML);

    const wrapperId = (pages.get('page-1') as Y.Map<unknown>)
      .get('rootElementIds') as Y.Array<string>;
    const wrapperRealId = wrapperId.get(0);

    // The wrapper element must be marked as a master entry — that's what
    // promotes its rendered outer tag to a master root in the canvas.
    const wrapperYEl = elements.get(wrapperRealId) as Y.Map<unknown>;
    expect(isMasterYjsEntry(wrapperYEl)).toBe(true);

    const masterIds = new Set(collectMasterInstanceIds(doc));
    expect(masterIds.has(wrapperRealId)).toBe(true);

    // Outer tag carries the compound `<wrapperId>:header-0` key (BlogPost's
    // markup starts with <header>; data-keys are stamped into the wrapper's
    // staticMarkup by createElementYMap).
    const outerKey = `${wrapperRealId}:header-0`;
    expect(isRenderedMasterRoot(outerKey, null, masterIds)).toBe(true);

    // parseKey must recover the wrapper's Yjs id from the compound form.
    const parsed = parseKey(outerKey);
    expect(parsed?.type).toBe('instance-child');
    expect(parsed?.type === 'instance-child' && parsed.instanceId).toBe(wrapperRealId);

    // The wrapper Yjs element holds the astroSource — the consumer-side
    // resolution path (DesignBar's `instanceId` derivation) must go through
    // parsedKey.instanceId, not the compound key string. This is the load-
    // bearing fact the Go-to-source button depends on.
    expect(wrapperYEl.get('astroSource')).toBe(BLOG_POST_ASTRO_SOURCE);
    // The compound key would NOT resolve to a Yjs element:
    expect(elements.get(outerKey)).toBeUndefined();
  });
});
