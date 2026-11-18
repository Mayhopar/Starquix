// src/store/selectors.ts
import * as Y from 'yjs';
import type { Breakpoint, ClassData, ElementData, ElementType, PageData, LinkAttributes, ImageAttributes } from './types';
import { parseKey, isPostPageData, emptyClassData } from './types';
import { yMapToClassData, yMapToLinkAttributes } from './createEditorDoc';
import { findElementBySelectorInMarkup } from '@/utils/markupQuery';
import { stripDocumentBoilerplate } from '@/utils/canvasHtml';
import { isLayoutPath } from '@/utils/astroAssetPaths';
import { addDataKeysToHtml, COMPONENT_EDITOR_PAGE_ID } from './constants';
import { pageLayoutElementId, layoutChromeMarkup, markChromeTags } from './layoutElement';
import { selectBlogSlotBinding } from './collectionSelectors';
import { BLOG_SLOT_COMPONENT_TYPE } from '@/core/collections/types';
import { BLOG_POST_ASTRO_SOURCE } from '@/utils/blogPostConstants';
import { baseMarkup } from './masters';
import { expandPlaceholders, SQ_CHILD_RE, attrOf } from '@/utils/componentPlaceholders';
import { SLOT_TAG_RE, slotParts } from '@/utils/slotMarkup';

/** Convert a childOrders Y.Map<Y.Array<string>> to a plain Record, or undefined if empty */
export function yChildOrdersToPlain(
  yChildOrders: Y.Map<Y.Array<string>> | undefined
): Record<string, string[]> | undefined {
  if (!yChildOrders || yChildOrders.size === 0) return undefined;
  const result: Record<string, string[]> = {};
  yChildOrders.forEach((arr, key) => {
    result[key] = (arr as Y.Array<string>).toArray();
  });
  return result;
}

/**
 * Resolve the effective tag for a drawn element based on its nesting level.
 * Root-level divs display as <section>, nested sections display as <div>.
 */
function resolveDrawnTag(rawTag: string, parentKey: string | null): string {
  if (rawTag === 'div' && !parentKey) return 'section';
  if (rawTag === 'section' && parentKey) return 'div';
  return rawTag;
}

/** Read an element's effective tag from Yjs by key (auto-converts div↔section by position).
 *  Returns null for non-drawn elements — callers fall back to the scanned tagName. */
export function selectElementTag(doc: Y.Doc, key: string | null): string | null {
  if (!key) return null;
  const elements = doc.getMap('elements');
  const yEl = elements.get(key) as Y.Map<unknown> | undefined;
  if (!yEl || !yEl.get('isDrawn')) return null;
  const rawTag = (yEl.get('tag') as string) || 'div';
  const parentId = (yEl.get('parentId') as string) || null;
  return resolveDrawnTag(rawTag, parentId);
}

export function selectCurrentBreakpoint(doc: Y.Doc): Breakpoint {
  const meta = doc.getMap('meta');
  return (meta.get('currentBreakpoint') as Breakpoint) || 'base';
}

/** Variable mode previewed on the canvas (lowercased name); null = default mode. */
export function selectCurrentThemeMode(doc: Y.Doc): string | null {
  const meta = doc.getMap('meta');
  return (meta.get('currentThemeMode') as string | null) ?? null;
}

export function selectCurrentPageId(doc: Y.Doc): string | null {
  const meta = doc.getMap('meta');
  return meta.get('currentPageId') as string | null;
}

/**
 * The page the editor should OPEN on.
 *
 * `meta.currentPageId` is whatever the last session was looking at, and that
 * can be a page with NO ROW in the Pages panel — a blog detail page is the live
 * case: clicking a post navigates to it, so it gets persisted, but the panel
 * filters it out of the tree. Restoring it drops the user on
 * "Post Title / Date / Post content goes here…" with nothing highlighted and no
 * way back to it (owner, 2026-08-13). The post that filled it in (`previewPost`)
 * is in-memory React state, so it is null on open — the page is restored without
 * the thing that gives it content.
 *
 * "Has a row" is `selectIsPageRowVisible` — the same predicate the panel filters
 * its own rows with, so the two cannot disagree. A first cut gated on
 * tree-reachability ALONE and was a no-op: ADD_PAGE pushes every new page into
 * `rootPages`, so a detail page is always reachable and only the panel's
 * collection-bound filter hides it.
 */
export function selectLandingPageId(doc: Y.Doc): string | null {
  const landable = (id: string | null | undefined): id is string =>
    !!id && selectIsPageRowVisible(doc, id);

  const restored = selectCurrentPageId(doc);
  if (landable(restored)) return restored;
  // selectHomePageId has its own legacy fallbacks and can itself return a
  // collection-bound page, so its answer is checked too rather than trusted.
  const home = selectHomePageId(doc);
  if (landable(home)) return home;
  return selectRootPageIds(doc).find(landable) ?? null;
}

/**
 * Does this page have a ROW in the Pages panel? THE predicate — the panel
 * filters its roots and its children with it (PagesPanel.tsx, PageTreeNode.tsx)
 * and selectLandingPageId decides where to open with it, so the two cannot
 * disagree about what the user can see.
 *
 * Two independent ways to have no row: the page is collection-bound (a blog
 * detail page — hidden by design, its posts stand in for it), or it is orphaned
 * from the tree entirely.
 */
export function selectIsPageRowVisible(doc: Y.Doc, pageId: string): boolean {
  return !selectIsPostPage(doc, pageId) && isPageInTree(doc, pageId);
}

/**
 * The ancestors that must be expanded for `pageId`'s row to be on screen.
 * Landing on a nested page without this shows the canvas with nothing
 * highlighted — the same symptom as landing on a rowless page.
 */
export function selectAncestorPageIds(doc: Y.Doc, pageId: string): string[] {
  const pages = doc.getMap('pages');
  const parentOf = new Map<string, string>();
  pages.forEach((value, id) => {
    const children = (value as Y.Map<unknown>).get('children') as Y.Array<string> | undefined;
    for (const child of children?.toArray() ?? []) parentOf.set(child, id);
  });
  const out: string[] = [];
  const seen = new Set<string>();
  let cur = parentOf.get(pageId);
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    out.push(cur);
    cur = parentOf.get(cur);
  }
  return out;
}

/** Reachable from the Pages tree: a root page, or a descendant of one. */
export function isPageInTree(doc: Y.Doc, pageId: string): boolean {
  const roots = selectRootPageIds(doc);
  if (roots.includes(pageId)) return true;
  const pages = doc.getMap('pages');
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const children = (pages.get(id) as Y.Map<unknown> | undefined)?.get('children') as Y.Array<string> | undefined;
    for (const child of children?.toArray() ?? []) {
      if (child === pageId) return true;
      stack.push(child);
    }
  }
  return false;
}

export function selectProjectId(doc: Y.Doc): string | null {
  const meta = doc.getMap('meta');
  return meta.get('projectId') as string | null;
}

export function selectProjectName(doc: Y.Doc): string {
  const meta = doc.getMap('meta');
  return (meta.get('projectName') as string) || '';
}

export function selectElement(doc: Y.Doc, elementId: string): ElementData | null {
  const elements = doc.getMap('elements');
  const yElement = elements.get(elementId) as Y.Map<unknown> | undefined;

  if (!yElement) return null;

  const yClasses = yElement.get('classes') as Y.Map<Y.Array<string>> | undefined;

  return {
    id: yElement.get('id') as string,
    pageId: yElement.get('pageId') as string,
    parentId: yElement.get('parentId') as string | null,
    index: yElement.get('index') as number,
    type: yElement.get('type') as ElementType,
    componentType: yElement.get('componentType') as string | undefined,
    slotName: yElement.get('slotName') as string | undefined,
    classes: yClasses ? yMapToClassData(yClasses) : emptyClassData(),
    textContent: yElement.get('textContent') as string | undefined,
  };
}

function yMapToSeoData(yMap: Y.Map<unknown> | undefined): Record<string, unknown> | undefined {
  if (!yMap) return undefined;
  const result: Record<string, unknown> = {};
  yMap.forEach((value, key) => {
    result[key] = (value instanceof Y.Array || value instanceof Y.Map)
      ? value.toJSON()
      : value;
  });
  return Object.keys(result).length > 0 ? result : undefined;
}

export function selectPage(doc: Y.Doc, pageId: string): PageData | null {
  const pages = doc.getMap('pages');
  const yPage = pages.get(pageId) as Y.Map<unknown> | undefined;

  if (!yPage) return null;

  return {
    id: yPage.get('id') as string,
    name: yPage.get('name') as string,
    rootElementIds: (yPage.get('rootElementIds') as Y.Array<string>)?.toArray() || [],
    children: (yPage.get('children') as Y.Array<string>)?.toArray() || [],
    seo: yMapToSeoData(yPage.get('seo') as Y.Map<unknown> | undefined),
    childOrders: yChildOrdersToPlain(yPage.get('childOrders') as Y.Map<Y.Array<string>> | undefined),
    pageType: (yPage.get('pageType') as PageData['pageType'])
      || (yPage.get('collectionId') ? 'post' : undefined)
      || (doc.getMap('postPageBindings').has(pageId) ? 'post' : undefined),
    collectionId: (yPage.get('collectionId') as string | undefined)
      || ((doc.getMap('postPageBindings').get(pageId) as Y.Map<unknown>)?.get('collectionId') as string | undefined),
    routePrefix: yPage.get('routePrefix') as string | undefined,
    isHome: yPage.get('isHome') === true || undefined,
  };
}

export function selectAllPages(doc: Y.Doc): PageData[] {
  const pages = doc.getMap('pages');
  const result: PageData[] = [];

  pages.forEach((_value, pageId) => {
    const page = selectPage(doc, pageId);
    if (page) result.push(page);
  });

  return result;
}

export function selectRootPageIds(doc: Y.Doc): string[] {
  const rootPages = doc.getArray('rootPages');
  return rootPages.toArray() as string[];
}

/**
 * The single source of truth for "which page is the home page" (exports as
 * index.astro / route '/'). Resolution: explicit isHome flag (rootPages order
 * first) → legacy id 'default' → legacy name 'home' → first non-post root
 * page → null. Steps 2-4 keep un-migrated docs exporting a root route.
 */
export function selectHomePageId(doc: Y.Doc): string | null {
  const pages = doc.getMap('pages');
  const rootIds = selectRootPageIds(doc);
  const orderedIds = [...rootIds, ...[...pages.keys()].filter(id => !rootIds.includes(id))];

  const get = (id: string) => pages.get(id) as Y.Map<unknown> | undefined;

  for (const id of orderedIds) {
    if (get(id)?.get('isHome') === true) return id;
  }
  if (pages.has('default')) return 'default';
  for (const id of orderedIds) {
    if (((get(id)?.get('name') as string) || '').toLowerCase() === 'home') return id;
  }
  for (const id of orderedIds) {
    if (!get(id)) continue;
    if (isCollectionBoundPage(doc, id)) continue;
    return id;
  }
  return null;
}

/**
 * A page bound to a content collection (post/detail page) — renders a single
 * post, must never own the root route, and is excluded from home fallback.
 * Single source for the pageType/collectionId/postPageBindings triple.
 */
export function isCollectionBoundPage(doc: Y.Doc, pageId: string): boolean {
  if (doc.getMap('postPageBindings').has(pageId)) return true;
  const p = doc.getMap('pages').get(pageId) as Y.Map<unknown> | undefined;
  if (!p) return false;
  return p.get('pageType') === 'post' || !!p.get('collectionId');
}

export function selectCurrentPage(doc: Y.Doc): PageData | null {
  const pageId = selectCurrentPageId(doc);
  if (!pageId) return null;
  return selectPage(doc, pageId);
}

/** Find the post page linked to a content collection */
export function selectPostPageByCollectionId(doc: Y.Doc, collectionId: string): PageData | null {
  const pages = doc.getMap('pages');
  for (const pageId of pages.keys()) {
    const page = selectPage(doc, pageId);
    if (isPostPageData(page) && page.collectionId === collectionId) return page;
  }
  return null;
}

export interface DrawnElementRenderData {
  key: string;
  tag: string;
  classes: string;
  textContent: string;
  parentKey: string | null;
  slotType?: string;
  slotComponentMarkup?: string;
  slotComponentName?: string;
  staticMarkup?: string;
  /** Draw-time position among the mount parent's children (position-aware
   *  findInsertionTarget). The bridge mounts at this index so a box drawn at
   *  the top of a layout page doesn't teleport below the slot content (C5). */
  insertIndex?: number;
}

interface RenderState {
  components: Array<{ id: string; staticMarkup: string }>;
  childOrders: Record<string, string[]>;
  drawnElements: DrawnElementRenderData[];
  blogSlots?: Array<{
    /** Yjs id of the BlogSlot component instance. */
    slotElementId: string;
    collectionId: string;
    settings: { layout: string; columns: number; gap: string; pagination: string; postsPerPage: number };
    bindings: Record<string, string>;
    /** Link mode for blog card → post page links */
    postLinkMode?: string;
    /**
     * Legacy drawn-slot fallback: when the BlogSlot is a drawn element
     * (pre-task-028 model), the bridge can't read the card template from
     * DOM via [data-blog-source="posts"] (drawn slots have an empty
     * :posts wrapper and a sibling :blogcard template). Re-emit the old
     * fields so Phase 5's legacy path can render cards.
     */
    isDrawn?: boolean;
    cardTemplateMarkup?: string;
    cardElementId?: string;
  }>;
  /** Post page render data when current page is a post template */
  postPage?: {
    frontmatter: Record<string, unknown>;
    bodyHtml: string;
    bindings: Record<string, string>;
    collectionName: string;
  };
}

const EMPTY_RENDER_STATE: RenderState = {
  components: [],
  childOrders: {},
  drawnElements: [],
};

/**
 * "Page renders nothing" predicate for empty-page gates (task-115).
 * MUST count drawn elements: selectPageComponents skips isDrawn roots by
 * design, so a page whose only content is a drawn section is NOT empty —
 * gating on components alone hid such pages (drawn showed in Layers, never
 * on canvas). Do NOT substitute the EMPTY_RENDER_STATE sentinel identity:
 * its fast path also requires childOrders empty.
 */
export function isRenderStateEmpty(
  rs: Pick<RenderState, 'components' | 'drawnElements'> | null,
): boolean {
  return (rs?.components.length ?? 0) === 0 && (rs?.drawnElements.length ?? 0) === 0;
}

export function selectRenderState(doc: Y.Doc, pageId: string, layoutBodies?: Map<string, string>): RenderState {
  const components = selectPageComponents(doc, pageId, layoutBodies);
  const childOrders = selectChildOrders(doc, pageId);
  const drawnElements = selectPageDrawnElements(doc, pageId);

  // Fast path: if everything is empty, return stable reference
  if (components.length === 0 && Object.keys(childOrders).length === 0 && drawnElements.length === 0) {
    return EMPTY_RENDER_STATE;
  }

  // Collect blog slot bindings for every BlogSlot component instance on this
  // page. Both new regular instances AND legacy drawn slots are emitted —
  // the bridge Phase 5 handles each shape (drawn → cardTemplateMarkup
  // injection, instance → DOM-template cloning).
  // NEVER for the component editor: the master's design surface is the static
  // template card with its {post.data.X} tokens — Phase 5 with zero posts
  // (UC2b) would blank it. Enforced here in code, not by binding-absence
  // convention (a stray binding keyed to the master root must not blank it).
  const blogSlots: RenderState['blogSlots'] = [];
  const elementsMap = doc.getMap('elements');
  if (pageId !== COMPONENT_EDITOR_PAGE_ID) elementsMap.forEach((value, id) => {
    const yEl = value as Y.Map<unknown>;
    if ((yEl.get('componentType') as string | undefined) !== BLOG_SLOT_COMPONENT_TYPE) return;
    if ((yEl.get('pageId') as string) !== pageId) return;
    const binding = selectBlogSlotBinding(doc, id);
    if (!binding) return;
    const isDrawn = !!yEl.get('isDrawn');
    const entry: NonNullable<RenderState['blogSlots']>[number] = {
      slotElementId: id,
      collectionId: binding.collectionId,
      settings: {
        layout: binding.settings.layout,
        columns: binding.settings.columns,
        gap: binding.settings.gap,
        pagination: binding.settings.pagination,
        postsPerPage: binding.settings.postsPerPage,
      },
      bindings: binding.bindings,
      postLinkMode: binding.settings.postLinkMode,
    };
    if (isDrawn) {
      const cardElementId = id + ':blogcard';
      const cardMarkup = selectResolvedStaticMarkup(doc, cardElementId);
      entry.isDrawn = true;
      entry.cardElementId = cardElementId;
      entry.cardTemplateMarkup = cardMarkup || undefined;
    }
    blogSlots.push(entry);
  });

  return { components, childOrders, drawnElements, blogSlots: blogSlots.length > 0 ? blogSlots : undefined };
}

export function selectPostPageBinding(doc: Y.Doc, pageId: string): {
  collectionId: string;
  bindings: Record<string, string>;
} | null {
  const postPageBindings = doc.getMap('postPageBindings');
  const yBinding = postPageBindings.get(pageId) as Y.Map<unknown> | undefined;
  if (!yBinding) return null;

  const collectionId = yBinding.get('collectionId') as string;
  const yBindings = yBinding.get('bindings') as Y.Map<unknown> | undefined;
  const bindings: Record<string, string> = {};
  yBindings?.forEach((val, key) => { bindings[key] = val as string; });

  return { collectionId, bindings };
}

/** The page's collection-content element (the blog post body slot), or null.
 *  Single finder for the "exactly one per post page" invariant — used by the
 *  body-key selector and the legacy-binding migration. */
export function findCollectionContentElement(doc: Y.Doc, pageId: string): Y.Map<unknown> | null {
  for (const [, value] of doc.getMap('elements').entries()) {
    const yEl = value as Y.Map<unknown>;
    if ((yEl.get('pageId') as string) !== pageId) continue;
    if (yEl.get('bindingType') !== 'collection-content') continue;
    return yEl;
  }
  return null;
}

/** The data-key of the post page's collection-content element root tag.
 *  The markup was stamped at creation (createElementYMap → addKeysToMarkup),
 *  so the first data-key in staticMarkup IS the body target key. */
export function selectCollectionContentBodyKey(doc: Y.Doc, pageId: string): string | null {
  const yEl = findCollectionContentElement(doc, pageId);
  if (!yEl) return null;
  const m = ((yEl.get('staticMarkup') as string) || '').match(/data-key="([^"]+)"/);
  return m ? m[1] : null;
}

/** Get post page render data if the current page is a post page */
export function selectPostPageRenderData(doc: Y.Doc, pageId: string): {
  collectionId: string;
  bindings: Record<string, string>;
} | null {
  const page = selectPage(doc, pageId);
  if (!isPostPageData(page) || !page.collectionId) return null;

  const binding = selectPostPageBinding(doc, pageId);
  if (!binding) return null;

  // The 'body' entry is derived from the collection-content element, not
  // stored in postPageBindings (Task 2 of the content-slot plan). When the
  // element exists it is the ONLY body target: any legacy 'body' map entry
  // (pre-migration docs, possibly under a different key) is dropped so
  // consumers never see two 'body' entries. Legacy entries only survive when
  // no element exists — removed for good by Task 4's migration.
  let bindings = binding.bindings;
  const bodyKey = selectCollectionContentBodyKey(doc, pageId);
  if (bodyKey) {
    bindings = { ...bindings };
    for (const [key, field] of Object.entries(bindings)) {
      if (field === 'body') delete bindings[key];
    }
    bindings[bodyKey] = 'body';
  }

  return {
    collectionId: binding.collectionId,
    bindings,
  };
}

/**
 * Get collection IDs linked to BlogSlots on a page (lightweight — skips full
 * element scan). Accepts BOTH shapes: legacy drawn slot (`isDrawn=true,
 * slotType='blog'`) and post-task-028 regular instance (`componentType=
 * 'BlogSlot'`). Binding key is `slotElementId` in both models, so no key
 * translation is needed. Mirrors the discriminator used by
 * `selectRenderState.blogSlots` so both shapes stay in lockstep — keep them
 * aligned if you touch either site.
 */
export function selectPageBlogCollectionIds(doc: Y.Doc, pageId: string): string[] {
  const elements = doc.getMap('elements');
  const ids: string[] = [];
  elements.forEach((v, key) => {
    const yEl = v as Y.Map<unknown>;
    if (yEl.get('pageId') !== pageId) return;
    const isDrawnBlog = !!yEl.get('isDrawn') && yEl.get('slotType') === 'blog';
    const isInstanceBlog = yEl.get('componentType') === BLOG_SLOT_COMPONENT_TYPE;
    if (!isDrawnBlog && !isInstanceBlog) return;
    const binding = selectBlogSlotBinding(doc, key);
    if (binding) ids.push(binding.collectionId);
  });
  return ids;
}

/** Strict pageType check on a Y.Map page node — Y.Map sibling to `isPostPageData`. */
export function isPostPageYMap(yPage: Y.Map<unknown>): boolean {
  return yPage.get('pageType') === 'post';
}

export interface PostPageInvariantViolation {
  kind: 'detail-page-without-collection' | 'collection-without-detail-page' | 'duplicate-detail-pages';
  pageIds: string[];
  collectionId: string | null;
  message: string;
}

/**
 * task-036 1:1 lock: every collection has exactly one detail page
 * (pageType='post'), created/deleted atomically with it. This surfaces docs
 * that already violate that invariant (a broken migration, a manual Yjs edit)
 * so they fail loudly instead of silently rendering broken routes. Strict
 * pageType check only — legacy name-heuristic pages are not detail pages.
 */
export function selectPostPageInvariantViolations(doc: Y.Doc): PostPageInvariantViolation[] {
  const collections = doc.getMap('contentCollections');
  const violations: PostPageInvariantViolation[] = [];
  const pagesByCollection = new Map<string, string[]>();

  doc.getMap('pages').forEach((v, pageId) => {
    const yPage = v as Y.Map<unknown>;
    if (!isPostPageYMap(yPage)) return;
    const collectionId = (yPage.get('collectionId') as string | undefined) ?? null;
    if (!collectionId || !collections.has(collectionId)) {
      violations.push({
        kind: 'detail-page-without-collection',
        pageIds: [pageId],
        collectionId,
        message: `Detail page "${pageId}" has ${collectionId ? `collectionId "${collectionId}" but no such collection exists` : 'no collectionId'} — orphaned post route.`,
      });
      return;
    }
    pagesByCollection.set(collectionId, [...(pagesByCollection.get(collectionId) ?? []), pageId]);
  });

  collections.forEach((_v, collectionId) => {
    const pageIds = pagesByCollection.get(collectionId) ?? [];
    if (pageIds.length === 0) {
      violations.push({
        kind: 'collection-without-detail-page',
        pageIds: [],
        collectionId,
        message: `Collection "${collectionId}" has no detail page — its posts have no route.`,
      });
    } else if (pageIds.length > 1) {
      violations.push({
        kind: 'duplicate-detail-pages',
        pageIds,
        collectionId,
        message: `Collection "${collectionId}" has ${pageIds.length} detail pages (${pageIds.join(', ')}) — ambiguous routing.`,
      });
    }
  });

  return violations;
}

/** Check if a page is a post page (hidden from tree) */
export function selectIsPostPage(doc: Y.Doc, pageId: string): boolean {
  if (isCollectionBoundPage(doc, pageId)) return true;
  const yp = doc.getMap('pages').get(pageId) as Y.Map<unknown> | undefined;
  // Legacy heuristic: early post pages were identifiable only by name
  return yp?.get('name') === 'Post Page';
}

/** Get the content binding slotKey for the current page (post page ID or blog slot key) */
export function selectActiveContentSlotKey(doc: Y.Doc, pageId: string): string | null {
  const page = selectPage(doc, pageId);
  if (isPostPageData(page)) {
    const postPageBindings = doc.getMap('postPageBindings');
    return postPageBindings.has(pageId) ? pageId : null;
  }
  return null;
}

function selectChildOrders(doc: Y.Doc, pageId: string): Record<string, string[]> {
  const page = selectPage(doc, pageId);
  return page?.childOrders ?? {};
}

export function selectRootElementIds(doc: Y.Doc, pageId: string): string[] {
  const pages = doc.getMap('pages');
  const yPage = pages.get(pageId) as Y.Map<unknown> | undefined;
  if (!yPage) return [];
  return (yPage.get('rootElementIds') as Y.Array<string>)?.toArray() || [];
}

/**
 * The component/layout editor page's root element id (the open doc's root), or
 * null. NOT blindly rootIds[0]: canvas drags could pollute the array with a
 * composite data-key or a bare child id (task-098 audit), and the auto-bake /
 * leave flush key their master writes off this — a polluted [0] silently
 * killed persistence or baked into the CHILD's master.
 */
export function selectEditorRootElementId(doc: Y.Doc): string | null {
  const elements = doc.getMap('elements');
  for (const id of selectRootElementIds(doc, COMPONENT_EDITOR_PAGE_ID)) {
    const el = elements.get(id) as Y.Map<unknown> | undefined;
    if (el && !el.get('parentId')) return id;
  }
  return null;
}

export function selectPageRootElements(doc: Y.Doc, pageId: string): ElementData[] {
  const page = selectPage(doc, pageId);
  if (!page) return [];

  // rootElementIds array order IS the render order (selectStaticPageComponents
  // walks it directly; REORDER_PAGE_ELEMENTS rewrites it). Sorting by the
  // per-element index field here reported a different order than the canvas
  // after reorders/anchored inserts — don't reintroduce it.
  return page.rootElementIds
    .map((id) => selectElement(doc, id))
    .filter((el): el is ElementData => el !== null);
}

/** Get all drawn elements for a page (elements with isDrawn flag) */
export function selectPageDrawnElements(doc: Y.Doc, pageId: string): DrawnElementRenderData[] {
  const pages = doc.getMap('pages');
  const elements = doc.getMap('elements');
  const sourceClasses = doc.getMap('sourceClasses');
  const sourceText = doc.getMap('sourceText');
  const yPage = pages.get(pageId) as Y.Map<unknown> | undefined;
  if (!yPage) return [];

  const result: DrawnElementRenderData[] = [];

  // Check all elements for isDrawn flag (both root and nested)
  elements.forEach((_value, key) => {
    const yEl = _value as Y.Map<unknown>;
    if (!yEl.get('isDrawn')) return;
    if ((yEl.get('pageId') as string) !== pageId) return;
    // task-028: blog `:blogcard` / `:posts` / `:pagination` filters removed.
    // In the new model BlogSlot is a regular component instance and its
    // children are real Yjs elements without `isDrawn` set, so they are
    // already excluded by the guard above.

    const classEntry = sourceClasses.get(key) as Y.Map<unknown> | undefined;
    const classes = classEntry ? (classEntry.get('classes') as string || '') : '';

    // Get latest text from sourceText map (if edited) or from element
    const textEntry = sourceText.get(key) as Y.Map<unknown> | undefined;
    const textContent = textEntry
      ? (textEntry.get('textContent') as string || '')
      : (yEl.get('textContent') as string || '');

    const rawTag = (yEl.get('tag') as string) || 'div';
    const parentKey = (yEl.get('parentId') as string) || null;
    const slotType = (yEl.get('slotType') as string | undefined) || undefined;
    const slotComponentMarkup = (yEl.get('slotComponentMarkup') as string | undefined) || undefined;
    const slotComponentName = (yEl.get('slotComponentName') as string | undefined) || undefined;
    const staticMarkup = (yEl.get('staticMarkup') as string | undefined) || undefined;

    const rawIndex = yEl.get('index');
    result.push({
      key,
      tag: resolveDrawnTag(rawTag, parentKey),
      classes,
      textContent,
      parentKey,
      slotType,
      slotComponentMarkup,
      slotComponentName,
      staticMarkup,
      ...(typeof rawIndex === 'number' ? { insertIndex: rawIndex } : {}),
    });
  });

  // Topological sort: parents before children.
  // Yjs Map iteration order is not guaranteed, so a child drawn element
  // could appear before its parent. During RENDER Phase 3, bridge.js
  // creates elements sequentially — if a child is created before its parent,
  // findElementByKey fails and the child falls back to #sq-components (flat).
  if (result.length > 1) {
    const drawnKeySet = new Set(result.map(r => r.key));
    const byKey = new Map(result.map(r => [r.key, r]));

    // Compute depth: number of drawn ancestors
    const depthCache = new Map<string, number>();
    function depth(key: string): number {
      if (depthCache.has(key)) return depthCache.get(key)!;
      const el = byKey.get(key);
      if (!el || !el.parentKey || !drawnKeySet.has(el.parentKey)) {
        depthCache.set(key, 0);
        return 0;
      }
      const d = 1 + depth(el.parentKey);
      depthCache.set(key, d);
      return d;
    }

    // Sort by depth ascending (roots first, then children)
    result.sort((a, b) => depth(a.key) - depth(b.key));
  }

  return result;
}

/**
 * Count a page's drawn elements without building render data — cheap input
 * for "does this page have content?" gates that run on every doc update
 * (task-115). Same membership rule as selectPageDrawnElements.
 */
export function selectPageDrawnCount(doc: Y.Doc, pageId: string): number {
  if (!doc.getMap('pages').get(pageId)) return 0;
  let count = 0;
  doc.getMap('elements').forEach((value) => {
    const yEl = value as Y.Map<unknown>;
    if (yEl.get('isDrawn') && (yEl.get('pageId') as string) === pageId) count++;
  });
  return count;
}

export function buildClassString(classes: ClassData): string {
  const parts: string[] = [];

  // Base classes (no prefix)
  parts.push(...classes.base);

  // Responsive classes (with prefix)
  for (const bp of ['sm', 'md', 'lg', 'xl', '2xl'] as const) {
    parts.push(...classes[bp].map((c) => `${bp}:${c}`));
  }

  return parts.join(' ');
}

export function selectAllPageElements(doc: Y.Doc, pageId: string): ElementData[] {
  const elements = doc.getMap('elements');
  const result: ElementData[] = [];

  elements.forEach((value, key) => {
    const yElement = value as Y.Map<unknown>;
    if (yElement.get('pageId') === pageId) {
      const el = selectElement(doc, key);
      if (el) result.push(el);
    }
  });

  return result;
}

/** Map of data-key -> parent data-key (null for root) for every keyed element. */
function parentageMap(html: string): Map<string, string | null> {
  const dom = new DOMParser().parseFromString(html, 'text/html');
  const map = new Map<string, string | null>();
  dom.querySelectorAll('[data-key]').forEach((el) => {
    map.set(
      el.getAttribute('data-key')!,
      el.parentElement?.closest('[data-key]')?.getAttribute('data-key') ?? null,
    );
  });
  return map;
}

/** Overrides may reorder/delete/restyle — they must NEVER reparent a surviving key. */
function validateOverrideParentage(raw: string, resolved: string): boolean {
  const rawMap = parentageMap(raw);
  for (const [key, parent] of parentageMap(resolved)) {
    if (rawMap.has(key) && rawMap.get(key) !== parent) return false;
  }
  return true;
}

/** The override maps applyAllOverrides reads — the memo signature must cover
 *  exactly this set. Adding an override kind = add it HERE too, or the memo
 *  serves stale markup. */
const OVERRIDE_MAP_KEYS = [
  'classOverrides',
  'markupOverrides',
  'overrides',
  'linkOverrides',
  'deletedSelectors',
  'renderOrderOverrides',
  'imageAttributes',
  'imageOverrides',
] as const;

type OverrideCacheEntry = { mapsSig: string; rawMarkup: string; out: string };
// task-120 (4.1): per-element memo. The DOMParser passes below are the hot
// cost of selectRenderState (they used to run for EVERY element on EVERY doc
// update). Keyed by the element's Y.Map identity; the signature serializes
// the raw markup + every override map's content, so any override write (or a
// master/staticMarkup change, via rawMarkup) recomputes — no rev plumbing in
// commands.ts to keep in sync. ponytail: JSON.stringify sig; upgrade to
// per-element revs only if profiling shows serialization cost.
const overrideMemo = new WeakMap<Y.Map<unknown>, OverrideCacheEntry>();

function overridesMapsSig(yEl: Y.Map<unknown>): string {
  const parts: unknown[] = [];
  for (const key of OVERRIDE_MAP_KEYS) {
    const v = yEl.get(key) as { toJSON?: () => unknown } | undefined;
    parts.push(v && typeof v.toJSON === 'function' ? v.toJSON() : null);
  }
  return JSON.stringify(parts);
}

/** Apply all override types to raw markup in the correct order. */
export function applyAllOverrides(rawMarkup: string, yEl: Y.Map<unknown>): string {
  // Signature fields compared separately — rawMarkup can be large, and
  // concatenating it into a single sig string allocated a markup-sized copy
  // on every selector run.
  const mapsSig = overridesMapsSig(yEl);
  const hit = overrideMemo.get(yEl);
  if (hit && hit.mapsSig === mapsSig && hit.rawMarkup === rawMarkup) return hit.out;
  const out = applyAllOverridesUncached(rawMarkup, yEl);
  overrideMemo.set(yEl, { mapsSig, rawMarkup, out });
  return out;
}

function applyAllOverridesUncached(rawMarkup: string, yEl: Y.Map<unknown>): string {
  // Heal missing svg data-keys before applying overrides. Docs written before
  // svg became keyable (2026-07-24) store markup whose <svg> carries no
  // data-key, so selector-targeted overrides (svg-0) could never match and
  // silently reverted on every re-render. svg ONLY — the one tag whose
  // keyability changed; a blanket re-stamp would key tags deliberately left
  // literal (e.g. empty <slot>). Counting matches bridge addKeysToMarkup
  // (every svg occurrence counts, keyed or not). Drawn elements are excluded
  // — their inline shape svg must stay unkeyed (pen/shapes own it).
  const healId = yEl.get('id') as string | undefined;
  if (healId && !yEl.get('isDrawn') && /<svg\b/i.test(rawMarkup)) {
    let svgIdx = 0;
    rawMarkup = rawMarkup.replace(/<svg\b([^>]*?)(\s*\/?>)/gi, (m, attrs, close) => {
      const idx = svgIdx++;
      if (attrs && /data-key\s*=/.test(attrs)) return m;
      return `<svg data-key="${healId}:svg-${idx}"${attrs}${close}`;
    });
  }
  const classOverrides = yEl.get('classOverrides') as Y.Map<unknown> | undefined;
  const markupOverrides = yEl.get('markupOverrides') as Y.Map<string> | undefined;
  const overrides = yEl.get('overrides') as Y.Map<Y.Map<unknown>> | undefined;
  const linkOverrides = yEl.get('linkOverrides') as Y.Map<Y.Map<unknown>> | undefined;
  const deletedSelectors = yEl.get('deletedSelectors') as Y.Array<string> | undefined;
  const renderOrderOverrides = yEl.get('renderOrderOverrides') as Y.Map<Y.Array<string>> | undefined;
  const imageAttributes = yEl.get('imageAttributes') as Y.Map<unknown> | undefined;
  const imageOverrides = yEl.get('imageOverrides') as Y.Map<Y.Map<unknown>> | undefined;

  // Tag each <img> with its original index before deletion/reorder shifts positions.
  // This lets applyImageAttributeOverrides match by original index, not post-mutation position.
  let result = tagImgOriginalIndices(rawMarkup);
  result = applyDeletionOverrides(result, deletedSelectors);
  result = applyRenderOrder(result, renderOrderOverrides);
  result = applyOverridesToMarkup(result, classOverrides);
  result = applyTextOverrides(result, overrides);
  result = applyMarkupOverrides(result, markupOverrides);
  result = applyLinkOverrides(result, linkOverrides);
  result = applyImageAttributeOverrides(result, imageAttributes, imageOverrides);
  result = stripImgOriginalIndices(result);
  if (!validateOverrideParentage(rawMarkup, result)) {
    console.error('[applyAllOverrides] override produced reparented markup — falling back to raw staticMarkup');
    return rawMarkup;
  }
  return result;
}

/**
 * Get the resolved staticMarkup for an element (with all overrides applied).
 * Returns null if element doesn't exist or has no staticMarkup.
 */
export function selectResolvedStaticMarkup(doc: Y.Doc, elementId: string): string | null {
  const elements = doc.getMap('elements');
  const yEl = elements.get(elementId) as Y.Map<unknown> | undefined;
  if (!yEl) return null;

  const rawMarkup = baseMarkup(doc, yEl);
  if (!rawMarkup) return null;

  return applyAllOverrides(rawMarkup, yEl);
}

/**
 * The pre-override SOURCE text for an instance-child key: the textContent at
 * the selector in the instance's RAW staticMarkup (no overrides applied).
 * This is the authoritative baseline the bridge stores in originalTextByKey
 * (ENTER_EDIT_MODE payload.originalText) so RESTORE_ORIGINAL_TEXT restores
 * source text even when the first edit session started on an
 * already-overridden DOM. Returns null when no source baseline exists
 * (non-instance-child keys, missing instance/markup/selector) — callers fall
 * back to the bridge's first-seen-DOM capture.
 */
export function selectOriginalSourceText(doc: Y.Doc, key: string): string | null {
  const parsed = parseKey(key);
  if (parsed?.type !== 'instance-child') return null;

  const yEl = doc.getMap('elements').get(parsed.instanceId) as Y.Map<unknown> | undefined;
  const staticMarkup = yEl?.get('staticMarkup') as string | undefined;
  if (!staticMarkup) return null;

  const el = findElementBySelectorInMarkup(staticMarkup, parsed.selector);
  return el ? (el.textContent ?? '') : null;
}

// <slot name="x">…</slot> or self-closing <slot name="x"/>
// Slot grammar: ONE definition in utils/slotMarkup.ts, shared with the local
// inline transform (vite-plugin/server/inlineLayout.ts) so the two cannot drift.

/** Stable synthetic id for the single wrapped tree a page-level layout produces. */
export const LAYOUT_COMPONENT_ID = '__layout__';

/**
 * Fill the matching <slot> with the page's content. A FILLED slot becomes a
 * persistent <div> CONTAINER carrying the slot's own class + data-key, with the
 * children nested INSIDE it — so the slot box stays visible/selectable and the
 * component lives within it (not in place of it). We use a <div>, NOT a runtime
 * <slot>: a live-DOM <slot> doesn't render its light-DOM contents reliably,
 * which caused the "dropped-layout nukes content" bug. An EMPTY slot is left as
 * the literal <slot> so the "Choose Component" overlay (which detects
 * tagName==='slot') still renders on it.
 *
 * Each child's tags are pre-stamped with data-keys in the child's id namespace
 * before composition, so the child's identity (componentType, layers) survives
 * the parent layout's subsequent re-keying.
 */
/** Inline-expand `<sq-child>` placeholders no child element claimed (masters-only fallback). */
function expandLeftoverPlaceholders(doc: Y.Doc, markup: string, yEl: Y.Map<unknown> | undefined): string {
  if (!yEl || !markup.includes('<sq-child')) return markup;
  return expandPlaceholders(doc, markup, (yEl.get('astroSource') as string | undefined) ?? '', []);
}

function composeSlotChildren(
  parentMarkup: string,
  children: Array<{ id: string; slotName: string; markup: string; placementKey?: string }>,
  /**
   * LAYOUT slots only: turn a filled <slot> into a persistent <div> CONTAINER
   * (slot's class + key) with the children nested INSIDE. Component-instance
   * slots (e.g. BlogSlot) keep the Astro semantics — children replace the <slot>.
   */
  wrapSlot = false,
  /**
   * LAYOUT wrap only: wrap the DEFAULT slot into its <div data-sq-slot>
   * container even when no composed child fills it — used when the page's
   * content is drawn roots (which ride INSERT_DRAWN_ELEMENT, not this markup)
   * so they mount inside the slot instead of below the chrome.
   */
  forceWrapDefaultSlot = false,
): string {
  if (!parentMarkup || (children.length === 0 && !(wrapSlot && forceWrapDefaultSlot))) return parentMarkup;
  const bySlot = new Map<string, string[]>();
  const byPlacement = new Map<string, string[]>();
  for (const c of children) {
    const stamped = addDataKeysToHtml(c.markup, (selector) => `${c.id}:${selector}`, true);
    if (c.placementKey) {
      const pList = byPlacement.get(c.placementKey) ?? [];
      pList.push(stamped);
      byPlacement.set(c.placementKey, pList);
      // Non-slot placements (placementKey 'footer-0', slotName '') splice ONLY
      // at their <sq-child> placeholder — registering them under slotName ''
      // would swallow the parent's default <slot> (footer replaces the content
      // slot) AND double-render at the placeholder. Slot-fallback children
      // (placementKey === slot name) do fill their slot in the first pass.
      if (c.placementKey !== c.slotName) continue;
    }
    const list = bySlot.get(c.slotName) ?? [];
    list.push(stamped);
    bySlot.set(c.slotName, list);
  }
  let out = parentMarkup.replace(SLOT_TAG_RE, (full, attrsSelf: string, attrsOpen: string) => {
    const { attrs, name: slotName } = slotParts(attrsSelf, attrsOpen);
    const filling = bySlot.get(slotName);
    // Empty slot: leave the <slot> in place so the "Choose Component" overlay
    // still renders on it — unless the page's content is drawn roots, in which
    // case the DEFAULT slot becomes an empty container for them to mount into.
    if (!filling) {
      if (wrapSlot && forceWrapDefaultSlot && slotName === '') return `<div${attrs} data-sq-slot></div>`;
      return full;
    }
    // Filled LAYOUT slot: the <slot> becomes a persistent <div> container (same
    // class + data-key as the slot) holding the children INSIDE — the slot box
    // stays selectable and the component lives within it, not in place of it.
    if (wrapSlot) return `<div${attrs} data-sq-slot>${filling.join('')}</div>`;
    // Component-instance slot: children replace the <slot> (Astro semantics).
    return filling.join('');
  });
  // Second pass: children with a placementKey splice at their <sq-child>
  // placeholder. Slot-fallback children were already consumed above (their
  // placeholder sat inside the replaced <slot> span). An unmatched placeholder
  // stays literal — the caller inline-expands leftovers via expandPlaceholders.
  if (byPlacement.size > 0 && out.includes('<sq-child')) {
    out = out.replace(SQ_CHILD_RE, (full, selfAttrs: string, openAttrs: string) => {
      const key = (attrOf(selfAttrs ?? openAttrs ?? '', 'data-sq-placement') ?? '').trim();
      const filling = byPlacement.get(key);
      return filling ? filling.join('') : full;
    });
  }
  return out;
}


/**
 * The page's layout chrome, from whichever source has it. ONE definition,
 * shared by the canvas render and by the delete-a-layout transform — a second
 * resolver would drift and the inlined markup would stop matching what the user
 * was looking at.
 *
 * Element first — but the .astro FILE is the layout's source of truth (the Astro
 * model: a layout is the page's document shell, so every page must show what the
 * master currently contains). The doc element is an OVERRIDE carrier, not a
 * snapshot: rendering its stored staticMarkup meant anything added to a layout
 * master — a nav, a footer — never reached any page until the user found a
 * "pull from master" affordance. Base comes from discovery when the layout is
 * discoverable; the stored copy is the fallback for a layout discovery can't
 * see. Per-page overrides still apply on top.
 *
 * Overrides target structural selectors, so the chrome carries
 * `data-key="<layoutElementId>:<selector>"` (stamped by markChromeTags at the
 * call site) — clicking it in the canvas selects an instance-child of the layout
 * element (parseKey) and class/text/markup edits store as overrides on it. The
 * chrome has no source-tracking attrs, so it is excluded from the layers scan
 * and never changes content roots' parentKey (scanning.ts).
 *
 * Then the live discovered body, for pages the user never opened. Astro layouts
 * are conventionally FULL documents (doctype/html/head/body + their own bridge
 * <script>); reduce to inner-body chrome before splicing — otherwise the
 * document tags get foster-parented away and the layers scan breaks (the
 * "dropped layout nukes content" bug).
 *
 * Null when the layout file is gone.
 */
export function resolvePageChrome(
  doc: Y.Doc,
  pageId: string,
  layoutName: string,
  layoutBodies?: Map<string, string>,
): string | null {
  const layoutEl = doc.getMap('elements').get(pageLayoutElementId(pageId)) as Y.Map<unknown> | undefined;
  const freshBody = layoutBodies?.get(layoutName);
  if (layoutEl) {
    const rawChrome = freshBody != null ? layoutChromeMarkup(freshBody) : baseMarkup(doc, layoutEl);
    return applyAllOverrides(rawChrome, layoutEl);
  }
  return freshBody ? layoutChromeMarkup(freshBody) : null;
}


/**
 * The composition machinery shared by selectPageComponents (canvas) and
 * selectPostContentMarkup (export): a parentId → children map plus a memoized
 * depth-first composer that splices each element's children into its <slot>
 * placeholders.
 */
function buildPageComposer(doc: Y.Doc, pageId: string): {
  childrenByParent: Map<string, Array<{ id: string; slotName: string; placementKey?: string; yEl: Y.Map<unknown> }>>;
  composeChildren: (id: string, markup: string) => string;
  composedMarkup: (id: string, yEl: Y.Map<unknown>) => string;
} {
  const elements = doc.getMap('elements');

  // Build a parentId -> children map (excluding drawn elements). Children of a
  // component root (e.g. a BlogSlot) are inserted INTO that root's <slot>
  // placeholders below — this is component-level slot routing, distinct from
  // the page-level layout wrap that happens after the roots are built.
  const childrenByParent = new Map<string, Array<{ id: string; slotName: string; placementKey?: string; yEl: Y.Map<unknown> }>>();
  elements.forEach((value, id) => {
    const yEl = value as Y.Map<unknown>;
    if ((yEl.get('pageId') as string) !== pageId) return;
    if (yEl.get('isDrawn')) return;
    const parentId = yEl.get('parentId') as string | null | undefined;
    if (!parentId) return;
    const slotName = ((yEl.get('slotName') as string) || '').trim();
    const placementKey = ((yEl.get('placementKey') as string) || '').trim() || undefined;
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId)!.push({ id, slotName, placementKey, yEl });
  });

  // Depth-first composition: an element's children are spliced into ITS <slot>
  // placeholders before the element itself is spliced into its parent — so a
  // depth-2 element (child of a non-root parent) survives into the final
  // markup. Memoized per element; a parentId cycle (corrupt data) falls back
  // to the element's own overrides-applied markup without recursing.
  const composedCache = new Map<string, string>();
  const composing = new Set<string>();
  // Splice an element's (recursively composed) children into its <slot>
  // placeholders — shared by the recursive path and the root path below.
  const composeChildren = (id: string, markup: string): string => {
    const kids = childrenByParent.get(id);
    let out = markup;
    if (kids && kids.length > 0) {
      composing.add(id);
      out = composeSlotChildren(
        markup,
        kids.map((k) => ({ id: k.id, slotName: k.slotName, placementKey: k.placementKey, markup: composedMarkup(k.id, k.yEl) })),
      );
      composing.delete(id);
    }
    // Placeholders with no matching child element (canvas placements of e.g.
    // BlogPost-with-Header) expand inline from the masters overlay. Order is
    // locked: overrides act on the COLLAPSED selector space (documented
    // one-time drift), then child splice, then leftover expansion. Folded in
    // here so every composed path — recursive children AND page roots — gets
    // it from one seam.
    return expandLeftoverPlaceholders(doc, out, elements.get(id) as Y.Map<unknown> | undefined);
  };
  const composedMarkup = (id: string, yEl: Y.Map<unknown>): string => {
    const hit = composedCache.get(id);
    if (hit !== undefined) return hit;
    // baseMarkup, not raw staticMarkup: the masters overlay must win for
    // child instances exactly like it does for roots (:844), the DesignBar
    // and useInstanceOverrideSync (task-082). Reading the frozen staticMarkup
    // here made a pushed master (e.g. BlogCard fill) show in the panel but
    // never render on the canvas.
    const raw = baseMarkup(doc, yEl);
    const markup = applyAllOverrides(raw, yEl);
    if (composing.has(id)) return markup; // cycle guard: don't recurse, don't cache
    const composed = composeChildren(id, markup);
    composedCache.set(id, composed);
    return composed;
  };

  return { childrenByParent, composeChildren, composedMarkup };
}

export function selectPageComponents(
  doc: Y.Doc,
  pageId: string,
  layoutBodies?: Map<string, string>
): Array<{ id: string; staticMarkup: string }> {
  const pages = doc.getMap('pages');
  const elements = doc.getMap('elements');
  const yPage = pages.get(pageId) as Y.Map<unknown> | undefined;
  if (!yPage) return [];

  const rootElementIds = (yPage.get('rootElementIds') as Y.Array<string>)?.toArray() || [];
  // A page with a layout renders its chrome even with ZERO content roots —
  // the early return here used to leave an applied-layout-on-empty-page
  // completely blank (round-2 blind-judge S1 finding).
  const pageLayoutName = (yPage.get('layoutName') as string | null | undefined) ?? null;
  if (rootElementIds.length === 0 && !pageLayoutName) return [];

  const { composeChildren } = buildPageComposer(doc, pageId);

  // Each root's own slotName decides which layout slot it targets in the wrap below.
  const rootSlotNames = new Map<string, string>();

  // Set by the root walk below; consumed by the layout wrap. Drawn ROOTS never
  // ride the components payload (they arrive via INSERT_DRAWN_ELEMENT), but they
  // ARE the page's content — see the composeSlotChildren call.
  let hasDrawnRoots = false;

  const result = rootElementIds
    .map((id) => {
      // The layout-chrome element is NEVER page content (layoutElement.ts
      // invariant). The eager scan seed used to leak it into rootElementIds
      // (runtime-proven 2026-08-26); rendering it here filled the layout's
      // own slot with its own chrome — <div …:slot-0><slot …:slot-0/></div>,
      // two nodes one key → React dup-key spam, placeholder-over-content,
      // chrome nested inside the slot subtree. The seed is fixed too
      // (scanning.ts), but this skip self-heals every already-poisoned doc.
      if (id === pageLayoutElementId(pageId)) return null;
      const yEl = elements.get(id) as Y.Map<unknown> | undefined;
      if (!yEl) return null;
      // Skip drawn elements - they're synced to iframe via Yjs observer, not
      // SET_PAGE_COMPONENTS. Their PRESENCE is still recorded here: a drawn id
      // among the page's roots IS a drawn root, because ADD_DRAWN_ELEMENT only
      // pushes parent-less drawn into rootElementIds and REPARENT_ELEMENT moves
      // the id and `parentId` together.
      if (yEl.get('isDrawn')) {
        hasDrawnRoots = true;
        return null;
      }

      rootSlotNames.set(id, ((yEl.get('slotName') as string) || '').trim());

      const rawMarkup = baseMarkup(doc, yEl);
      let staticMarkup = applyAllOverrides(rawMarkup, yEl);

      // Legacy Yjs data may carry full document boilerplate from a synthetic
      // layout-instance root captured before the page-level model. Strip it.
      // This root-only branch is why roots don't go through composedMarkup():
      // the strip applies to the root's OWN markup before children splice in.
      if (isLayoutPath(yEl.get('astroSource') as string | null | undefined)) {
        staticMarkup = stripDocumentBoilerplate(staticMarkup);
      }

      staticMarkup = composeChildren(id, staticMarkup);

      return {
        id: yEl.get('id') as string,
        staticMarkup,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  // Page-level layout: wrap the flat content roots into the layout chrome's
  // <slot> positions. The chrome now comes from the derived layout-chrome
  // element (staticMarkup + overrides) so per-page layout edits and a pulled
  // master are reflected; we fall back to the live discovered body until the
  // element is lazily ensured. The roots keep their source-tracking attributes
  // so they stay scannable in the layers panel. No runtime <slot> survives.
  const layoutName = pageLayoutName;
  if (layoutName) {
    // ONE resolver, shared with the delete-a-layout transform. Both branches'
    // reasoning lives in resolvePageChrome.
    const chrome = resolvePageChrome(doc, pageId, layoutName, layoutBodies) ?? undefined;
    if (chrome != null) {
      const layoutChildren = result.map((r) => ({
        id: r.id,
        slotName: rootSlotNames.get(r.id) ?? '',
        markup: r.staticMarkup,
      }));
      // hasDrawnRoots (recorded by the root walk above) force-wraps the default
      // <slot> into its persistent container so (a) the bridge mounts drawn
      // roots INSIDE the slot, matching the "content moves into the layout's
      // slot" confirm, and (b) the empty-slot "Choose Component" placeholder
      // does not render above the user's own content (round-2 S3/S5 finding).
      const wrapped = composeSlotChildren(chrome, layoutChildren, true, hasDrawnRoots);
      // Render the layout component UNDER the layout-element id (layoutchrome-<pageId>),
      // NOT a generic placeholder. The bridge keys an unkeyed (fallback-path) chrome's
      // tags under THIS id, so the slot/chrome land in the layoutchrome-<pageId>:
      // namespace that every consumer expects (Layers Layout node, canvas drill,
      // DesignBar isLayoutSelection, markChromeTags). Using a generic id keyed the
      // chrome as __layout__:slot-0 and made the Layout unselectable.
      return [{ id: pageLayoutElementId(pageId), staticMarkup: markChromeTags(wrapped, pageLayoutElementId(pageId)) }];
    }
  }

  return result;
}

/**
 * Composed markup of a post page's slot content (BlogPost chrome excluded).
 * If the page's sole root is the BlogPost wrapper, composes its CHILDREN
 * (the slot content) — the exported route's <BlogPost> wrap supplies the
 * chrome. An un-migrated page (no wrapper) composes the roots themselves.
 * Returns null when the page has no usable elements (caller falls back to
 * generateDetailPage).
 */
export function selectPostContentMarkup(doc: Y.Doc, pageId: string): string | null {
  const elements = doc.getMap('elements');
  const rootIds = selectRootElementIds(doc, pageId);
  if (rootIds.length === 0) return null;
  const { childrenByParent, composedMarkup } = buildPageComposer(doc, pageId);
  const first = elements.get(rootIds[0]) as Y.Map<unknown> | undefined;
  const isWrapped = rootIds.length === 1 && first?.get('astroSource') === BLOG_POST_ASTRO_SOURCE;
  const ids = isWrapped ? (childrenByParent.get(rootIds[0]) ?? []).map((k) => k.id) : rootIds;
  const parts = ids
    .map((id) => {
      const yEl = elements.get(id) as Y.Map<unknown> | undefined;
      if (!yEl || yEl.get('isDrawn')) return '';
      return composedMarkup(id, yEl);
    })
    .filter(Boolean);
  return parts.length ? parts.join('\n') : null;
}

/**
 * Page-level layout association: the layout name (or null) and its prop values.
 * Single read point for the layout UI (drop handler, PageLayoutBlock, slot
 * target dropdown).
 */
export function selectPageLayout(
  doc: Y.Doc,
  pageId: string
): { layoutName: string | null; layoutProps: Record<string, string> } {
  const page = doc.getMap('pages').get(pageId) as Y.Map<unknown> | undefined;
  return {
    layoutName: (page?.get('layoutName') as string | null | undefined) ?? null,
    layoutProps: (page?.get('layoutProps') as Record<string, string> | undefined) ?? {},
  };
}

/**
 * Map of elementId → slotName for the current page's Yjs elements. Elements
 * without a slotName are omitted. Feeds the synthetic layout-node slot
 * grouping in the Layers tree (task-040). UI-only — never written back.
 */
export function selectSlotNamesByElementId(
  doc: Y.Doc,
  pageId: string
): Map<string, string> {
  const out = new Map<string, string>();
  if (!pageId) return out;
  const elements = doc.getMap('elements');
  elements.forEach((value, id) => {
    const yEl = value as Y.Map<unknown>;
    if ((yEl.get('pageId') as string) !== pageId) return;
    const slotName = yEl.get('slotName') as string | undefined;
    if (slotName) out.set(id, slotName);
  });
  return out;
}

/**
 * Replace innerHTML of the Nth occurrence of a tag in HTML.
 * Selector format: "tagname-index" (e.g., "p-0", "h1-0", "span-2")
 */
function replaceNthTagContent(
  html: string,
  selector: string,
  newContent: string
): string {
  const match = selector.match(/^([a-z][a-z0-9]*)-(\d+)$/i);
  if (!match) return html;

  const tagName = match[1].toLowerCase();
  const targetIndex = parseInt(match[2], 10);

  const tagPattern = new RegExp(
    `(<${tagName}\\b[^>]*>)([\\s\\S]*?)(</${tagName}>)`,
    'gi'
  );

  let currentIndex = 0;
  return html.replace(tagPattern, (fullMatch, openTag, _oldContent, closeTag) => {
    if (currentIndex === targetIndex) {
      currentIndex++;
      return `${openTag}${newContent}${closeTag}`;
    }
    currentIndex++;
    return fullMatch;
  });
}

/**
 * Apply text overrides from the overrides map.
 */
function applyTextOverrides(
  staticMarkup: string,
  overrides: Y.Map<Y.Map<unknown>> | undefined
): string {
  if (!overrides || overrides.size === 0) return staticMarkup;

  let result = staticMarkup;
  overrides.forEach((childOverride, selector) => {
    const text = childOverride.get('text') as string | undefined;
    if (text !== undefined) {
      result = replaceNthTagContent(result, selector, text);
    }
  });
  return result;
}

/**
 * Strip class attributes from <a> tags in HTML string.
 */
function stripLinkClasses(html: string): string {
  return html
    .replace(/<a\s+([^>]*?)class="[^"]*"([^>]*)>/gi, '<a $1$2>')
    .replace(/<a\s+([^>]*?)class='[^']*'([^>]*)>/gi, '<a $1$2>');
}

/**
 * Apply markupOverrides to staticMarkup HTML.
 * Strips class attributes from <a> tags in overridden content to prevent
 * theme classes from being "baked in".
 */
function applyMarkupOverrides(
  staticMarkup: string,
  markupOverrides: Y.Map<string> | undefined
): string {
  if (!markupOverrides || markupOverrides.size === 0) return staticMarkup;

  let result = staticMarkup;
  markupOverrides.forEach((newInnerHTML, selector) => {
    // Strip classes from <a> tags in the override content before applying
    const sanitizedContent = stripLinkClasses(newInnerHTML);
    result = replaceNthTagContent(result, selector, sanitizedContent);
  });

  return result;
}

/**
 * Update or remove a single HTML attribute within an attribute string.
 * - If value is non-empty: replaces existing or appends.
 * - If value is empty/falsy: removes existing attribute.
 * - `removableValues` lists values that should cause removal (e.g., '_self' for target).
 */
function updateHtmlAttribute(
  attrs: string,
  attrName: string,
  value: string | undefined,
  removableValues: string[] = []
): string {
  if (value === undefined) return attrs;

  const shouldRemove = !value || removableValues.includes(value);
  const attrPattern = new RegExp(`\\s*${attrName}=(["'])[^"']*\\1`, 'i');

  if (attrs.includes(`${attrName}=`)) {
    if (shouldRemove) {
      return attrs.replace(attrPattern, '');
    }
    return attrs.replace(
      new RegExp(`${attrName}=(["'])[^"']*\\1`, 'i'),
      `${attrName}="${value}"`
    );
  }

  if (!shouldRemove) {
    // href is prepended; other attributes are appended
    if (attrName === 'href') {
      return ` ${attrName}="${value}"` + attrs;
    }
    return attrs + ` ${attrName}="${value}"`;
  }

  return attrs;
}

/**
 * Apply linkOverrides to staticMarkup HTML.
 * Updates href, target, rel, title, aria-label attributes on link elements.
 * Selector format: "a-N" (e.g., "a-0", "a-4")
 */
export function applyLinkOverrides(
  staticMarkup: string,
  linkOverrides: Y.Map<Y.Map<unknown>> | undefined
): string {
  if (!linkOverrides || linkOverrides.size === 0) return staticMarkup;

  let result = staticMarkup;

  linkOverrides.forEach((attrs, selector) => {
    const match = selector.match(/^a-(\d+)$/i);
    if (!match) return;

    const targetIndex = parseInt(match[1], 10);
    const tagPattern = /<a\b([^>]*)>/gi;

    let currentIndex = 0;
    result = result.replace(tagPattern, (fullMatch, existingAttrs) => {
      if (currentIndex === targetIndex) {
        currentIndex++;

        let newAttrs = existingAttrs;
        newAttrs = updateHtmlAttribute(newAttrs, 'href', attrs.get('href') as string | undefined);
        newAttrs = updateHtmlAttribute(newAttrs, 'target', attrs.get('target') as string | undefined, ['_self']);
        newAttrs = updateHtmlAttribute(newAttrs, 'rel', attrs.get('rel') as string | undefined);
        newAttrs = updateHtmlAttribute(newAttrs, 'title', attrs.get('title') as string | undefined);
        newAttrs = updateHtmlAttribute(newAttrs, 'aria-label', attrs.get('ariaLabel') as string | undefined);

        return `<a${newAttrs}>`;
      }
      currentIndex++;
      return fullMatch;
    });
  });

  return result;
}

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * Find the end position of the matching closing tag, handling nesting.
 * searchFrom should be the position right after the opening tag.
 * Returns the position right after </tagName>, or -1 if not found.
 */
function findMatchingCloseTag(
  html: string,
  tagName: string,
  searchFrom: number
): number {
  const pattern = new RegExp(
    `<${tagName}\\b[^>]*?\\/?>|<\\/${tagName}\\s*>`,
    'gi'
  );
  pattern.lastIndex = searchFrom;
  let depth = 1;
  let m;
  while ((m = pattern.exec(html)) !== null) {
    const matched = m[0];
    if (matched.startsWith('</')) {
      depth--;
      if (depth === 0) return m.index + matched.length;
    } else if (!matched.endsWith('/>')) {
      // Non-self-closing opening tag increases depth
      depth++;
    }
  }
  return -1;
}

/** Inject data-sq-orig-idx="N" on each <img> tag to track original positions. */
function tagImgOriginalIndices(markup: string): string {
  let index = 0;
  return markup.replace(/<img\b/gi, (match) => `${match} data-sq-orig-idx="${index++}"`);
}

/** Strip the temporary data-sq-orig-idx markers after image overrides are applied. */
function stripImgOriginalIndices(markup: string): string {
  return markup.replace(/ data-sq-orig-idx="\d+"/g, '');
}

/**
 * Remove elements matching deleted selectors from HTML.
 * Counts opening tags in flat document order (matching how the bridge assigns indices),
 * then uses depth tracking to find the correct closing tag for nested elements.
 * Selector format: "tagname-index" (e.g., "h1-0", "img-0", "div-1")
 */
function applyDeletionOverrides(
  staticMarkup: string,
  deletedSelectors: Y.Array<string> | undefined
): string {
  if (!deletedSelectors || deletedSelectors.length === 0) return staticMarkup;

  const selectorsArray = deletedSelectors.toArray();

  // task-098 placements: a deleted placement child must ALSO remove its
  // `<sq-child data-sq-placement="…">` placeholder — otherwise the bake keeps
  // it and expandLeftoverPlaceholders resurrects the component on every page
  // (live-caught: deleted Footer came back on blog-post pages).
  for (const selector of selectorsArray) {
    const sel = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    staticMarkup = staticMarkup.replace(
      new RegExp(`<sq-child\\b[^>]*data-sq-placement="${sel}"[^>]*>\\s*</sq-child>|<sq-child\\b[^>]*data-sq-placement="${sel}"[^>]*/>`, 'g'),
      '',
    );
  }

  // Parse selectors into {tag -> set of indices}
  const toDelete = new Map<string, Set<number>>();
  for (const selector of selectorsArray) {
    const match = selector.match(/^([a-z][a-z0-9]*)-(\d+)$/i);
    if (!match) continue;
    const tag = match[1].toLowerCase();
    const index = parseInt(match[2], 10);
    if (!toDelete.has(tag)) toDelete.set(tag, new Set());
    toDelete.get(tag)!.add(index);
  }
  if (toDelete.size === 0) return staticMarkup;

  // Scan all opening tags in document order, count per-tag
  const tagCounts: Record<string, number> = {};
  const ranges: Array<[number, number]> = [];
  const openTagRe = /<([a-z][a-z0-9]*)\b[^>]*?\/?>/gi;
  let m;
  while ((m = openTagRe.exec(staticMarkup)) !== null) {
    const tagName = m[1].toLowerCase();
    const currentIndex = tagCounts[tagName] || 0;
    tagCounts[tagName] = currentIndex + 1;

    if (toDelete.has(tagName) && toDelete.get(tagName)!.has(currentIndex)) {
      const startPos = m.index;
      const openTag = m[0];
      const isSelfClosing = openTag.endsWith('/>') || VOID_ELEMENTS.has(tagName);

      if (isSelfClosing) {
        ranges.push([startPos, startPos + openTag.length]);
      } else {
        const endPos = findMatchingCloseTag(staticMarkup, tagName, startPos + openTag.length);
        if (endPos !== -1) {
          ranges.push([startPos, endPos]);
        }
      }
    }
  }
  if (ranges.length === 0) return staticMarkup;

  // Filter out ranges fully contained within other ranges (parent already being deleted)
  const filtered = ranges.filter(([s, e]) =>
    !ranges.some(([os, oe]) => os < s && oe > e)
  );

  // Remove from back to front to preserve positions
  filtered.sort((a, b) => b[0] - a[0]);
  let result = staticMarkup;
  for (const [start, end] of filtered) {
    result = result.slice(0, start) + result.slice(end);
  }

  return result;
}

/**
 * Reorder children in resolved markup from RENDER-domain selectors.
 * renderOrderOverrides: Y.Map<parentSelector, Y.Array<childSelector>>.
 * Semantics MATCH bridge _reorderChildElements: listed children are appended
 * to the parent in order (they end up last, in order); unlisted stay in place.
 * DOMParser-based — structurally cannot emit unbalanced HTML.
 * Legacy `orderOverrides` (source-domain, for AST write-back) is NOT read here.
 */
function applyRenderOrder(
  staticMarkup: string,
  renderOrderOverrides: Y.Map<Y.Array<string>> | undefined,
): string {
  if (!renderOrderOverrides || renderOrderOverrides.size === 0) return staticMarkup;

  const dom = new DOMParser().parseFromString(staticMarkup, 'text/html');
  const root = dom.body.firstElementChild;
  if (!root) return staticMarkup;

  let changed = false;
  renderOrderOverrides.forEach((order, parentSelector) => {
    const rootKey = root.getAttribute('data-key') || '';
    const parent = rootKey.endsWith(`:${parentSelector}`)
      ? root
      : root.querySelector(`[data-key$=":${parentSelector}"]`);
    if (!parent) return;
    for (const childSelector of order.toArray()) {
      const child = Array.from(parent.children).find(
        (c) => (c.getAttribute('data-key') || '').endsWith(`:${childSelector}`),
      );
      if (child) { parent.appendChild(child); changed = true; }
    }
  });

  return changed ? root.outerHTML : staticMarkup;
}

/**
 * Apply classOverrides to staticMarkup HTML.
 * Finds elements with data-key containing the selector and merges override classes.
 */
function applyOverridesToMarkup(
  staticMarkup: string,
  classOverrides: Y.Map<unknown> | undefined
): string {
  if (!classOverrides || classOverrides.size === 0) {
    return staticMarkup;
  }

  let result = staticMarkup;

  classOverrides.forEach((override, selector) => {
    const selectorClasses = yMapToClassData(override as Y.Map<Y.Array<string>>);
    const overrideString = buildClassString(selectorClasses);

    // An empty overrideString is NOT "no override" — the selector HAS an
    // override entry, so the user cleared every class. Patterns 1/2 still run
    // to replace the existing class attribute with "" (task-082); only the
    // add-a-class path (Pattern 3) is skipped so we never inject class="".

    // Find element with data-key ending in ":selector" and update its class attribute
    const escapedSelector = selector.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

    // Track if we modified this selector to avoid double application
    let selectorHandled = false;

    // The override is the FULL intended class set (every writer stores the whole
    // class string), so it REPLACES the captured class attribute rather than
    // unioning with it — merging kept base classes the user deleted (task-082).
    // Patterns 1 & 2 differ only in attribute order, so they share this rewrite.
    const replaceClassAttr = (_match: string, before: string, _existing: string, after: string): string =>
      `${before}${overrideString}${after}`;

    // Pattern 1: data-key before class (data-key="...:selector" ... class="existing")
    const patternWithClass = new RegExp(
      `(data-key=["'][^"']*:${escapedSelector}["'][^>]*class=["'])([^"']*)(["'])`,
      'g'
    );

    if (patternWithClass.test(result)) {
      // Reset lastIndex since .test() advances it
      patternWithClass.lastIndex = 0;
      result = result.replace(patternWithClass, replaceClassAttr);
      selectorHandled = true;
    }

    // Pattern 2: class before data-key (class="existing" ... data-key="...:selector")
    // Only apply if Pattern 1 didn't match
    if (!selectorHandled) {
      const patternClassFirst = new RegExp(
        `(class=["'])([^"']*)(["'][^>]*data-key=["'][^"']*:${escapedSelector}["'])`,
        'g'
      );
      if (patternClassFirst.test(result)) {
        // Reset lastIndex since .test() advances it
        patternClassFirst.lastIndex = 0;
        result = result.replace(patternClassFirst, replaceClassAttr);
        selectorHandled = true;
      }
    }

    // Pattern 3: No class attribute at all - add one
    // Only apply if Patterns 1 and 2 didn't match, and there's something to add
    // (an empty override must never inject a bare class="").
    if (!selectorHandled && overrideString) {
      const patternNoClass = new RegExp(
        `(data-key=["'][^"']*:${escapedSelector}["'])([^>]*)(>)`,
        'g'
      );
      result = result.replace(patternNoClass, (_match, dataKey, attrs, close) => {
        // Avoid adding duplicate class if one exists (defensive check)
        if (attrs.includes('class=')) {
          return _match;
        }
        return `${dataKey}${attrs} class="${overrideString}"${close}`;
      });
    }
  });

  return result;
}


// ============================================================================
// Link Element Selectors
// ============================================================================

/**
 * Select link attributes for an element.
 * Returns null if element doesn't have link attributes.
 *
 * Handles key formats:
 * - Instance root (el-abc123): Gets linkAttributes from element
 * - Instance child (el-abc123:a-0): Gets from linkOverrides[selector]
 * - Source (src/Hero.astro:5:1): Gets from sourceLinkAttributes map
 */
export function selectLinkAttributes(doc: Y.Doc, key: string): LinkAttributes | null {
  const parsed = parseKey(key);
  if (!parsed) return null;

  const elements = doc.getMap('elements');

  if (parsed.type === 'instance-root') {
    const yElement = elements.get(parsed.instanceId) as Y.Map<unknown> | null;
    if (!yElement) return null;

    const linkAttrs = yElement.get('linkAttributes') as Y.Map<unknown> | undefined;
    return linkAttrs ? yMapToLinkAttributes(linkAttrs) : null;
  }

  if (parsed.type === 'instance-child') {
    const yElement = elements.get(parsed.instanceId) as Y.Map<unknown> | null;
    if (!yElement) return null;

    // Check both storage locations:
    // 1. unifiedOverrides - where Override API stores href when link is created
    // 2. linkOverrides - where UPDATE_LINK_ATTRIBUTE stores target/ariaLabel

    let href = '';
    let target: '_blank' | '_self' | '_parent' | '_top' | undefined;
    let ariaLabel: string | undefined;

    // Read from unifiedOverrides (href stored by Override API)
    const unifiedOverrides = yElement.get('unifiedOverrides') as Y.Map<Y.Map<unknown>> | undefined;
    if (unifiedOverrides) {
      const selectorEntry = unifiedOverrides.get(parsed.selector) as Y.Map<unknown> | undefined;
      if (selectorEntry) {
        const hrefMap = selectorEntry.get('href') as Y.Map<unknown> | undefined;
        if (hrefMap) {
          href = (hrefMap.get('href') as string) || '';
          target = hrefMap.get('target') as '_blank' | '_self' | '_parent' | '_top' | undefined;
        }
      }
    }

    // Read from linkOverrides (href/target/ariaLabel stored by UPDATE_LINK_ATTRIBUTE)
    // linkOverrides values take precedence (updated via LinkBlock UI)
    const linkOverrides = yElement.get('linkOverrides') as Y.Map<Y.Map<unknown>> | undefined;
    if (linkOverrides) {
      const selectorAttrs = linkOverrides.get(parsed.selector) as Y.Map<unknown> | undefined;
      if (selectorAttrs) {
        const linkHref = selectorAttrs.get('href') as string | undefined;
        if (linkHref) {
          href = linkHref;
        }
        const linkTarget = selectorAttrs.get('target') as string | undefined;
        if (linkTarget) {
          target = linkTarget as '_blank' | '_self' | '_parent' | '_top';
        }
        ariaLabel = selectorAttrs.get('ariaLabel') as string | undefined;
      }
    }

    // Return null only if no data found at all
    // (href may exist in DOM but not Yjs, we still need to return ariaLabel/target if set)
    if (!href && !target && !ariaLabel) return null;

    return { href, target, rel: undefined, title: undefined, ariaLabel };
  }

  if (parsed.type === 'source') {
    const sourceLinkAttributes = doc.getMap('sourceLinkAttributes');
    const attrs = sourceLinkAttributes.get(key) as Y.Map<unknown> | undefined;
    return attrs ? yMapToLinkAttributes(attrs) : null;
  }

  return null;
}

// ============================================================================
// Image Override Application (for export)
// ============================================================================

/**
 * Replace a single attribute on an <img> tag string.
 * If the attribute exists, replaces its value. If not, adds it after `<img`.
 */
function replaceImgAttribute(imgTag: string, attr: string, value: string): string {
  const attrRe = new RegExp(`\\b${attr}\\s*=\\s*(?:"[^"]*"|'[^']*')`, 'i');
  if (attrRe.test(imgTag)) {
    return imgTag.replace(attrRe, `${attr}="${value}"`);
  }
  // Add attribute after <img / <video
  return imgTag.replace(/^(<(?:img|video)\b)/i, `$1 ${attr}="${value}"`);
}

/** Remove a (possibly bare boolean) attribute from a single tag string. */
function stripTagAttribute(tag: string, attr: string): string {
  return tag.replace(new RegExp(`\\s+${attr}(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]*))?(?=[\\s/>])`, 'i'), '');
}

/** Video boolean attributes stored as 'true'/'false' strings (see ImageAttributes). */
const VIDEO_BOOL_ATTRS = ['autoplay', 'loop', 'muted', 'controls'] as const;

/** Apply one selector's attr record to a single <img>/<video> tag string. */
function applyAttrsToMediaTag(tag: string, attrs: Record<string, string>): string {
  let result = tag;
  for (const plain of ['src', 'alt', 'loading'] as const) {
    if (attrs[plain] !== undefined) result = replaceImgAttribute(result, plain, attrs[plain]);
  }
  for (const bool of VIDEO_BOOL_ATTRS) {
    if (attrs[bool] === undefined) continue;
    result = attrs[bool] === 'false'
      ? stripTagAttribute(result, bool)
      : replaceImgAttribute(result, bool, 'true');
  }
  return result;
}

/**
 * Apply image/video attribute overrides to <img>/<video> tags in markup.
 *
 * - imageAttributes (root-level): applies when the root element is <img>/<video>
 * - imageOverrides (per-selector, e.g. img-0, video-0): applies to the Nth tag
 *   of that kind in markup (bridge selectors count per tag name)
 */
function applyImageAttributeOverrides(
  markup: string,
  imageAttributes: Y.Map<unknown> | undefined,
  imageOverrides: Y.Map<Y.Map<unknown>> | undefined
): string {
  if ((!imageAttributes || imageAttributes.size === 0) &&
      (!imageOverrides || imageOverrides.size === 0)) {
    return markup;
  }

  const collectAttrs = (yAttrs: Y.Map<unknown>): Record<string, string> => {
    const attrs: Record<string, string> = {};
    for (const name of ['src', 'alt', 'loading', ...VIDEO_BOOL_ATTRS]) {
      const v = yAttrs.get(name) as string | undefined;
      if (v !== undefined) attrs[name] = v;
    }
    return attrs;
  };

  // Keyed by selector ('img-0', 'video-1') — indices count per tag name.
  const attrsBySelector = new Map<string, Record<string, string>>();

  // imageAttributes applies to the root tag (index 0 when root is <img>/<video>)
  const rootTag = markup.match(/^\s*<(img|video)\b/i)?.[1]?.toLowerCase();
  if (imageAttributes && imageAttributes.size > 0 && rootTag) {
    const attrs = collectAttrs(imageAttributes);
    if (Object.keys(attrs).length > 0) attrsBySelector.set(`${rootTag}-0`, attrs);
  }

  // imageOverrides per selector (e.g., img-0, video-0)
  if (imageOverrides && imageOverrides.size > 0) {
    imageOverrides.forEach((selectorAttrs, selector) => {
      const m = selector.match(/^(img|video)-(\d+)$/i);
      if (!m) return;
      const attrs = collectAttrs(selectorAttrs as Y.Map<unknown>);
      if (Object.keys(attrs).length > 0) {
        const key = selector.toLowerCase();
        const existing = attrsBySelector.get(key);
        attrsBySelector.set(key, existing ? { ...existing, ...attrs } : attrs);
      }
    });
  }

  if (attrsBySelector.size === 0) return markup;

  // Replace attributes on matching <img>/<video> tags.
  // Use data-sq-orig-idx marker (injected by tagImgOriginalIndices) to match
  // by original position — survives deletion/reorder that shift sequential indices.
  const mediaTagRe = /<(img|video)\b[^>]*\/?>/gi;
  const tagCounts: Record<string, number> = {};
  return markup.replace(mediaTagRe, (match, tag: string) => {
    const tagLower = tag.toLowerCase();
    const seqIdx = tagCounts[tagLower] || 0;
    tagCounts[tagLower] = seqIdx + 1;
    const origIdxMatch = match.match(/data-sq-orig-idx="(\d+)"/);
    const lookupIdx = origIdxMatch ? parseInt(origIdxMatch[1], 10) : seqIdx;
    const attrs = attrsBySelector.get(`${tagLower}-${lookupIdx}`);
    if (!attrs) return match;
    return applyAttrsToMediaTag(match, attrs);
  });
}

// ============================================================================
// Image Element Selectors
// ============================================================================

/** Convert a Y.Map with src/alt/loading keys to an ImageAttributes object. */
function yMapToImageAttributes(yMap: Y.Map<unknown>): ImageAttributes {
  return {
    src: (yMap.get('src') as string) || '',
    alt: yMap.get('alt') as string | undefined,
    loading: yMap.get('loading') as 'lazy' | 'eager' | undefined,
    autoplay: yMap.get('autoplay') as 'true' | 'false' | undefined,
    loop: yMap.get('loop') as 'true' | 'false' | undefined,
    muted: yMap.get('muted') as 'true' | 'false' | undefined,
    controls: yMap.get('controls') as 'true' | 'false' | undefined,
  };
}

/**
 * Select image attributes for an element.
 * Returns null if element doesn't have image attributes.
 *
 * Handles key formats:
 * - Instance root (el-abc123): Gets imageAttributes from element
 * - Instance child (el-abc123:img-0): Gets from imageOverrides[selector]
 * - Source (src/Hero.astro:5:1): Gets from sourceImageAttributes map
 */
export function selectImageAttributes(doc: Y.Doc, key: string): ImageAttributes | null {
  const parsed = parseKey(key);
  if (!parsed) return null;

  const elements = doc.getMap('elements');

  if (parsed.type === 'instance-root') {
    const yElement = elements.get(parsed.instanceId) as Y.Map<unknown> | null;
    if (!yElement) return null;

    const imageAttrs = yElement.get('imageAttributes') as Y.Map<unknown> | undefined;
    if (imageAttrs && imageAttrs.size > 0) return yMapToImageAttributes(imageAttrs);

    const staticMarkup = yElement.get('staticMarkup') as string | undefined;
    return staticMarkup ? extractImageAttrsFromMarkup(staticMarkup, null) : null;
  }

  if (parsed.type === 'instance-child') {
    const yElement = elements.get(parsed.instanceId) as Y.Map<unknown> | null;
    if (!yElement) return null;

    const imageOverrides = yElement.get('imageOverrides') as Y.Map<Y.Map<unknown>> | undefined;
    const selectorAttrs = imageOverrides?.get(parsed.selector) as Y.Map<unknown> | undefined;
    if (selectorAttrs && selectorAttrs.size > 0) return yMapToImageAttributes(selectorAttrs);

    const staticMarkup = yElement.get('staticMarkup') as string | undefined;
    return staticMarkup ? extractImageAttrsFromMarkup(staticMarkup, parsed.selector) : null;
  }

  if (parsed.type === 'source') {
    const sourceImageAttributes = doc.getMap('sourceImageAttributes');
    const attrs = sourceImageAttributes.get(key) as Y.Map<unknown> | undefined;
    return attrs ? yMapToImageAttributes(attrs) : null;
  }

  return null;
}

/**
 * Extract image attributes from staticMarkup HTML.
 * If selector is null, uses the first img in the markup (instance-root).
 * If selector is provided (e.g., "img-0"), finds the img at that index.
 * Returns null if no img element found at the given position.
 */
function extractImageAttrsFromMarkup(staticMarkup: string, selector: string | null): ImageAttributes | null {
  try {
    let img: Element | null = null;

    if (selector) {
      img = findElementBySelectorInMarkup(staticMarkup, selector);
      if (!img || (img.tagName.toLowerCase() !== 'img' && img.tagName.toLowerCase() !== 'video')) return null;
    } else {
      // instance-root: the root tag must be <img>/<video>
      const parser = new DOMParser();
      const doc = parser.parseFromString(staticMarkup, 'text/html');
      const root = doc.body.firstElementChild;
      if (!root || (root.tagName.toLowerCase() !== 'img' && root.tagName.toLowerCase() !== 'video')) return null;
      img = root;
    }

    const attrs: ImageAttributes = {
      src: img.getAttribute('src') || '',
      alt: img.getAttribute('alt') || undefined,
      loading: (img.getAttribute('loading') as 'lazy' | 'eager') || undefined,
    };
    if (img.tagName.toLowerCase() === 'video') {
      for (const bool of ['autoplay', 'loop', 'muted', 'controls'] as const) {
        attrs[bool] = img.hasAttribute(bool) ? 'true' : 'false';
      }
    }
    return attrs;
  } catch {
    return null;
  }
}
