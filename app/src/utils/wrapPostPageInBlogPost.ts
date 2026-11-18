import * as Y from 'yjs';
import { createElementYMap } from '@/store/commands';
import { emptyClassData } from '@/store/types';
import { generateId } from './generateId';
import { BLOG_POST_ASTRO_SOURCE, BLOG_POST_COMPONENT_NAME } from './blogPostTemplate';
import { acceptDocumentMutation } from '@/store/documentMutation';

/**
 * Idempotent — returns false when there's nothing to do.
 *
 * Two paths:
 *   1. No roots → false (empty page, nothing to wrap).
 *   2. Sole root is already a BlogPost wrapper → false (no-op).
 *      We deliberately do NOT auto-refresh `staticMarkup` on re-wrap. The
 *      wrapper's master markup now propagates live through the `masters`
 *      overlay (baseMarkup), so there is nothing to silently rebase here.
 *   3. Not yet wrapped → create a wrapper, reparent existing roots
 *      under it, replace `rootElementIds` with `[wrapperId]`.
 *
 * Wrapper construction is inline rather than via `ADD_ELEMENT` because
 * that command's reparent branch explicitly excludes post pages
 * (`!isPostPageYMap`) — routing through it would no-op the reparent
 * and leave BlogPost as a sibling instead of the new root.
 */
export async function wrapPostPageInBlogPost(
  doc: Y.Doc,
  pageId: string,
  blogPostHtml: string,
): Promise<boolean> {
  if (!blogPostHtml) {
    console.warn('[blog-post-wrap] empty blogPostHtml — abort', { pageId });
    return false;
  }

  const pages = doc.getMap('pages');
  const elements = doc.getMap('elements');
  const page = pages.get(pageId) as Y.Map<unknown> | undefined;
  if (!page) {
    console.warn('[blog-post-wrap] page not found', { pageId });
    return false;
  }

  const rootIds = page.get('rootElementIds') as Y.Array<string> | undefined;
  if (!rootIds || rootIds.length === 0) return false;

  if (rootIds.length === 1) {
    const onlyRoot = elements.get(rootIds.get(0)) as Y.Map<unknown> | undefined;
    if (onlyRoot?.get('astroSource') === BLOG_POST_ASTRO_SOURCE) return false;
  }

  const wrapperId = generateId();

  await acceptDocumentMutation(doc, staged => {
    const page = staged.getMap<Y.Map<unknown>>('pages').get(pageId);
    const rootIds = page?.get('rootElementIds') as Y.Array<string> | undefined;
    if (!rootIds?.length) throw new Error('Post page no longer has content');
    const elements = staged.getMap<Y.Map<unknown>>('elements');
    if (rootIds.length === 1 && elements.get(rootIds.get(0))?.get('astroSource') === BLOG_POST_ASTRO_SOURCE) return;
    const existingRootIds = rootIds.toArray();
    const wrapper = createElementYMap({
      id: wrapperId,
      pageId,
      parentId: null,
      index: 0,
      type: 'component',
      instanceType: 'local',
      componentType: BLOG_POST_COMPONENT_NAME,
      astroSource: BLOG_POST_ASTRO_SOURCE,
      staticMarkup: blogPostHtml,
      classes: emptyClassData(),
    });
    elements.set(wrapperId, wrapper);

    for (const childId of existingRootIds) {
      const child = elements.get(childId) as Y.Map<unknown> | undefined;
      if (child) child.set('parentId', wrapperId);
    }

    rootIds.delete(0, rootIds.length);
    rootIds.push([wrapperId]);
  });

  return true;
}
