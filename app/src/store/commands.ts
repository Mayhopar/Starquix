// src/store/commands.ts
import * as Y from 'yjs';
import type { EditorCommand, ElementData } from './types';
import { parseKey, SLOT_FILL_FIELDS, emptyClassData } from './types';
import { isWrapperKey } from './keyKind';
import { classDataToYMap, BREAKPOINT_STORAGE_KEY } from './createEditorDoc';
import { addDataKeysToHtml, COMPONENT_EDITOR_PAGE_ID } from './constants';
import { gridCommandClasses } from '@/utils/gridGeometry';
import { getInstanceOverrideAPI } from './overrides';
import { applyVariableCommand } from './variableCommands';
import { applyCollectionCommand, isCollectionCommand } from './collectionCommands';
import { applyFontCommand, isFontCommand } from './fontCommands';
import { isCollectionBoundPage, isPostPageYMap } from './selectors';
import { coerceSeoValueToYjs } from './seoCoercion';
import { BLOG_SLOT_COMPONENT_TYPE, DEFAULT_BLOG_SETTINGS } from '@/core/collections/types';
import { plainSlotToYMap } from '@/core/collections/yjsAccessors';
import { generateId } from '@/utils/generateId';
import { ensureLayoutElement, removeLayoutElement } from './layoutElement';
import { MASTERS_MAP, readMasterMarkupRev, placementKeyOf, type MasterChildOverrides } from './masters';
import { ensureSqIdInMasters } from './sqId';
import { computeSelectorRemap, stripSqIds, type SelectorRemap } from './selectorRemap';
import { recordOrphans, remapElementOverrides, remapMasterChildOverrides, ORPHANS_MAP } from './overrideOrphans';
import { getClassWriteBaseline, getFileValue } from '@/services/classWriteBaseline';
import { IMAGE_BASE_FIELD, isImageBookkeepingField, sourceOwnedImageValues, LINK_MARKUP_FIELD, LINK_MARKUP_OWNER_FIELD, SOURCE_OWNED_FIELD, linkMarkupFlatText, spliceLinkMarkupText } from './sourceOverrideEntries';

/** Get an existing Y.Map child, or create and insert a new one. */
function getOrCreateYMap<T = unknown>(parent: Y.Map<any>, key: string): Y.Map<T> {
  let map = parent.get(key) as Y.Map<T> | undefined;
  if (!map) {
    map = new Y.Map<T>();
    parent.set(key, map);
  }
  return map;
}

/**
 * Every per-instance override field stored on a Yjs element. Used when the
 * underlying markup is replaced (master refresh) or removed (drawn slot
 * fill cleared) — the override keys are tied to the old markup's selectors,
 * so they have to be wiped together.
 */
/** task-102 ↻ axis: an instance override write re-bases the element against
 *  the CURRENT master markup rev — ↻ shows only when the master moves later. */
function stampMasterBaseRev(doc: Y.Doc, instanceId: string): void {
  const el = doc.getMap('elements').get(instanceId) as Y.Map<unknown> | undefined;
  const astroSource = el?.get('astroSource') as string | undefined;
  if (!el || !astroSource) return;
  const rev = readMasterMarkupRev(doc, astroSource);
  // Yjs set never short-circuits equal values — skip the redundant CRDT write
  // on keystroke-adjacent paths (text/class edits) when the rev is unchanged.
  if (el.get('masterBaseRev') !== rev) el.set('masterBaseRev', rev);
}

/** Stamp variant for source-keyed commands — only instance-scoped keys re-base. */
function stampMasterBaseRevForSourceKey(doc: Y.Doc, sourceKey: string): void {
  const parsed = parseKey(sourceKey);
  if (parsed?.type === 'instance-child') stampMasterBaseRev(doc, parsed.instanceId);
}

/** task-118: an instance-child override write anchors a data-sq-id in the
 *  masters markup so a later structural source edit can rebind the selector.
 *  Source-domain keys (file:line:col) are out of scope. */
function mintSqIdForSourceKey(doc: Y.Doc, sourceKey: string): void {
  const parsed = parseKey(sourceKey);
  if (parsed?.type !== 'instance-child') return;
  const el = doc.getMap('elements').get(parsed.instanceId) as Y.Map<unknown> | undefined;
  if (el) ensureSqIdInMasters(doc, el, parsed.selector);
}

export const OVERRIDE_FIELDS = [
  'classOverrides',
  'markupOverrides',
  'overrides',
  'linkOverrides',
  'hrefOverrides',
  'imageOverrides',
  'attributeOverrides',
  'imageAttributes',
  'linkAttributes',
  'deletedSelectors',
  'orderOverrides',
  'renderOrderOverrides',
  'unifiedOverrides',
  'linkCounters',
] as const;

export function clearAllOverrideFields(yEl: Y.Map<unknown>): void {
  for (const f of OVERRIDE_FIELDS) yEl.delete(f);
}

/** Find the parent page ID for a given page */
function findParentPageId(pages: Y.Map<unknown>, pageId: string): string | null {
  let parentId: string | null = null;
  pages.forEach((value, key) => {
    const page = value as Y.Map<unknown>;
    const children = page.get('children') as Y.Array<string> | undefined;
    if (children?.toArray().includes(pageId)) {
      parentId = key;
    }
  });
  return parentId;
}

/** Delete sourceClasses, sourceText, sourceImageAttributes, and sourceLinkAttributes entries for an element and its children (key:selector) */
function deleteSourceEntries(doc: Y.Doc, elementId: string): void {
  const sourceClasses = doc.getMap('sourceClasses');
  const sourceText = doc.getMap('sourceText');
  const keysToDelete: string[] = [];
  sourceClasses.forEach((_value, key) => {
    if (key === elementId || key.startsWith(elementId + ':')) {
      keysToDelete.push(key);
    }
  });
  for (const key of keysToDelete) {
    sourceClasses.delete(key);
    if (sourceText.has(key)) sourceText.delete(key);
  }

  // Also clean sourceText entries that exist without corresponding sourceClasses entries
  // (e.g., drawn elements or instance children that had text edited via UPDATE_SOURCE_TEXT
  // but were never registered via REGISTER_SOURCE_ELEMENT)
  const sourceTextKeysToDelete: string[] = [];
  sourceText.forEach((_value, key) => {
    if ((key === elementId || key.startsWith(elementId + ':')) && !keysToDelete.includes(key)) {
      sourceTextKeysToDelete.push(key);
    }
  });
  for (const key of sourceTextKeysToDelete) {
    sourceText.delete(key);
  }

  // Clean up sourceImageAttributes and sourceLinkAttributes for source-type elements
  // (keyed by source location, e.g., src/Hero.astro:5:1, which IS the elementId for source elements)
  const sourceImageAttributes = doc.getMap('sourceImageAttributes');
  if (sourceImageAttributes.has(elementId)) {
    sourceImageAttributes.delete(elementId);
  }
  const sourceLinkAttributes = doc.getMap('sourceLinkAttributes');
  if (sourceLinkAttributes.has(elementId)) {
    sourceLinkAttributes.delete(elementId);
  }
}

/** Clean childOrders entries referencing a deleted element on a given page.
 *  Removes entries where the element is a parent (parentKey matches) and
 *  removes the element from child arrays where it appears as a child. */
function cleanChildOrdersForElement(pages: Y.Map<unknown>, pageId: string, elementId: string): void {
  const page = pages.get(pageId) as Y.Map<unknown> | undefined;
  if (!page) return;
  const childOrders = page.get('childOrders') as Y.Map<Y.Array<string>> | undefined;
  if (!childOrders) return;

  const matches = (key: string) => key === elementId || key.startsWith(elementId + ':');

  // Pass 1: Remove parentKey entries belonging to the deleted element
  const parentKeysToDelete: string[] = [];
  for (const parentKey of childOrders.keys()) {
    if (matches(parentKey)) {
      parentKeysToDelete.push(parentKey);
    }
  }
  for (const key of parentKeysToDelete) {
    childOrders.delete(key);
  }

  // Pass 2: Remove the element from child arrays in remaining entries
  for (const [parentKey, children] of childOrders.entries()) {
    const arr = children as Y.Array<string>;
    const indicesToDelete: number[] = [];
    for (let i = 0; i < arr.length; i++) {
      if (matches(arr.get(i))) {
        indicesToDelete.push(i);
      }
    }
    // Delete in reverse order to preserve indices
    for (let i = indicesToDelete.length - 1; i >= 0; i--) {
      arr.delete(indicesToDelete[i], 1);
    }
    if (arr.length === 0) {
      childOrders.delete(parentKey);
    }
  }
}

/**
 * Cascade-delete drawn elements whose parentId references any of the given seed keys.
 * Recursively finds drawn elements nested inside other drawn elements.
 *
 * When `matchSubKeys` is true, also matches drawn elements whose parentId starts
 * with a seed key followed by ':' (e.g., "elem-abc:section-0" matches seed "elem-abc").
 * This is needed when removing source elements that have sub-element children.
 */
function cascadeDeleteDrawnChildren(
  elements: Y.Map<unknown>,
  pages: Y.Map<unknown>,
  doc: Y.Doc,
  pageId: string,
  seedKeys: string[],
  matchSubKeys: boolean,
): void {
  const deletedKeys = new Set<string>(seedKeys);
  const orphanedDrawnKeys: string[] = [];

  let foundNew = true;
  while (foundNew) {
    foundNew = false;
    elements.forEach((value, key) => {
      if (deletedKeys.has(key)) return;
      const yEl = value as Y.Map<unknown>;
      if (!yEl.get('isDrawn')) return;
      const parentId = yEl.get('parentId') as string | null;
      if (!parentId) return;

      const isMatch = deletedKeys.has(parentId) ||
        (matchSubKeys && [...deletedKeys].some(dk => parentId.startsWith(dk + ':')));

      if (isMatch) {
        orphanedDrawnKeys.push(key);
        deletedKeys.add(key);
        foundNew = true;
      }
    });
  }

  for (const drawnKey of orphanedDrawnKeys) {
    cleanChildOrdersForElement(pages, pageId, drawnKey);
    deleteSourceEntries(doc, drawnKey);
    elements.delete(drawnKey);
  }
}

/**
 * Remove a single element: pop from rootElementIds (if root), clean child
 * orders + source entries, cascade-delete drawn children, and drop from the
 * elements map. Shared by REMOVE_ELEMENT and DELETE_PAGE_LAYOUT_WITH_CONTENT.
 */
/** Get-or-create an element's `deletedSelectors` Y.Array and append `selector`
 *  once (dedup). Shared by DELETE_INSTANCE_CHILD and the REMOVE_ELEMENT
 *  placement-child branch — one copy of the append invariant. */
function appendDeletedSelector(el: Y.Map<unknown>, selector: string): void {
  let ds = el.get('deletedSelectors') as Y.Array<string> | undefined;
  if (!ds) {
    ds = new Y.Array<string>();
    el.set('deletedSelectors', ds);
  }
  if (!ds.toArray().includes(selector)) ds.push([selector]);
}

function removeElementInternal(
  doc: Y.Doc,
  pages: Y.Map<unknown>,
  elements: Y.Map<unknown>,
  elementId: string,
): boolean {
  const element = elements.get(elementId) as Y.Map<unknown> | undefined;
  if (!element) return false;

  const pageId = element.get('pageId') as string;
  const parentId = element.get('parentId') as string | null;

  if (!parentId) {
    const page = pages.get(pageId) as Y.Map<unknown> | undefined;
    if (page) {
      const rootIds = page.get('rootElementIds') as Y.Array<string> | undefined;
      if (rootIds) {
        const idx = rootIds.toArray().indexOf(elementId);
        if (idx !== -1) rootIds.delete(idx, 1);
      }
    }
  }

  cleanChildOrdersForElement(pages, pageId, elementId);
  deleteSourceEntries(doc, elementId);
  cascadeDeleteDrawnChildren(elements, pages, doc, pageId, [elementId], true);

  elements.delete(elementId);
  return true;
}

/** Create a Y.Map from a source location object */
/**
 * task-141: classify a drawn element's shape for media resolve. No shape kind
 * is stored on the record — penPath geometry is the truth: closed 4-anchor
 * all-corner = rect, closed 4-anchor all-curve = ellipse, no penPath = plain
 * frame. Everything else (polygon/pen/line/arrow) is 'other' (v2).
 */
function classifyDrawnMediaShape(penPath: string | undefined): 'frame' | 'rect' | 'ellipse' | 'other' {
  if (!penPath) return 'frame';
  try {
    const p = JSON.parse(penPath) as { closed?: boolean; anchors?: Array<{ corner?: boolean }> };
    if (!p.closed || !Array.isArray(p.anchors) || p.anchors.length !== 4) return 'other';
    if (p.anchors.every(a => a.corner === true)) return 'rect';
    if (p.anchors.every(a => a.corner === false)) return 'ellipse';
    return 'other';
  } catch {
    return 'other';
  }
}

function sourceLocationToYMap(loc: import('@/bridge').SourceLocation): Y.Map<unknown> {
  if (!loc.file || loc.file.trim() === '') {
    throw new Error('Source location requires non-empty file path');
  }
  if (loc.line <= 0 || loc.column < 0 || !Number.isInteger(loc.line) || !Number.isInteger(loc.column)) {
    throw new Error(`Invalid source location: line=${loc.line}, column=${loc.column}`);
  }
  const yMap = new Y.Map<unknown>(Object.entries(loc).filter(([key]) => key === 'sourceVersion' || key === 'sourceRevision'));
  yMap.set('file', loc.file);
  yMap.set('line', loc.line);
  yMap.set('column', loc.column);
  return yMap;
}

/**
 * All elements get `instanceId:selector` data-keys so reset-to-original
 * works on every element, including the root.
 */
export function addKeysToMarkup(html: string, instanceId: string): string {
  return addDataKeysToHtml(html, (sel) => `${instanceId}:${sel}`);
}

/**
 * Build the Y.Map for a new element from an ElementData spec. Used by
 * ADD_ELEMENT and by wrappers like `wrapPostPageInBlogPost` so both paths
 * stamp the same fields and data-keys. Does NOT touch
 * `rootElementIds` or write into `elements` — the caller owns insertion
 * and parent-tree wiring.
 */
/** Recursive plain→Y conversion for pasted override/extra fields. */
function plainToY(value: unknown): unknown {
  if (Array.isArray(value)) {
    const arr = new Y.Array<unknown>();
    arr.push(value.map(plainToY));
    return arr;
  }
  if (value !== null && typeof value === 'object') {
    const map = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) map.set(k, plainToY(v));
    return map;
  }
  return value;
}

export function createElementYMap(element: ElementData): Y.Map<unknown> {
  const yEl = new Y.Map();
  yEl.set('id', element.id);
  yEl.set('pageId', element.pageId);
  yEl.set('parentId', element.parentId);
  yEl.set('index', element.index);
  yEl.set('type', element.type);

  if (element.componentType) yEl.set('componentType', element.componentType);
  if (element.slotName) yEl.set('slotName', element.slotName);
  if (element.placementKey) yEl.set('placementKey', element.placementKey);
  if (element.attributes && Object.keys(element.attributes).length > 0) {
    yEl.set('attributes', element.attributes);
  }
  if (element.textContent) yEl.set('textContent', element.textContent);
  if (element.staticMarkup) {
    yEl.set('staticMarkup', addKeysToMarkup(element.staticMarkup, element.id));
  }

  yEl.set('classes', classDataToYMap(element.classes));

  if (element.instanceType) yEl.set('instanceType', element.instanceType);
  if (element.astroSource) yEl.set('astroSource', element.astroSource);
  if (element.bindingType) yEl.set('bindingType', element.bindingType);

  // classOverrides is always initialized so UPDATE_THEME_INSTANCE_CLASS_OVERRIDE
  // works on any element regardless of how it was added.
  yEl.set('classOverrides', new Y.Map());

  return yEl;
}

/**
 * Remove orphaned link selector overrides from all override maps on an instance element.
 * Called after MARKUP_CHANGED when links are removed from the markup.
 */
export function cleanOrphanedLinkOverrides(
  instance: Y.Map<unknown>,
  validLinkSelectors: Set<string>
): void {
  const overrideMapKeys = ['classOverrides', 'markupOverrides', 'linkOverrides', 'hrefOverrides', 'unifiedOverrides'] as const;
  for (const mapKey of overrideMapKeys) {
    const overrideMap = instance.get(mapKey) as Y.Map<unknown> | undefined;
    if (overrideMap) {
      const keysToDelete: string[] = [];
      overrideMap.forEach((_, selector) => {
        if (selector.startsWith('a-') && !validLinkSelectors.has(selector)) {
          keysToDelete.push(selector);
        }
      });
      keysToDelete.forEach(key => overrideMap.delete(key));
    }
  }
}

/**
 * Sweep every element tagged to the component-editor page, then delete the
 * page itself. Called before seeding a fresh component instance so we never
 * accumulate orphan elements (drawn slots, post wrappers, instance children)
 * that lived under pageId=COMPONENT_EDITOR_PAGE_ID but never made it into
 * page.rootElementIds. See task-025.
 *
 * Caller is responsible for wrapping in `doc.transact(..., 'sync')` if a
 * single atomic op with subsequent writes is needed.
 */
/**
 * INVARIANT: the EDITOR page's rootElementIds feed the auto-bake / leave-flush
 * master writes (selectEditorRootElementId) — a known CHILD element enshrined
 * there silently retargets the bake and double-renders (task-098 audit).
 * Canvas pages legitimately hold composite keys in rootElementIds (order-
 * override domain), so this is checked only for COMPONENT_EDITOR_PAGE_ID.
 * True when `id` resolves to an element that has a parent — i.e. must never
 * be a root. Unknown ids return false; each caller decides its own policy for
 * those (REORDER keeps them — source/drawn keys are valid there; REPARENT
 * refuses them — a composite data-key can never become an editor root).
 */
export function isKnownChildElement(elements: Y.Map<unknown>, id: string): boolean {
  const el = elements.get(id) as Y.Map<unknown> | undefined;
  return !!el && !!el.get('parentId');
}

export function resetComponentEditorPage(doc: Y.Doc): void {
  const pages = doc.getMap('pages');
  const elements = doc.getMap<Y.Map<unknown>>('elements');

  const toDelete: string[] = [];
  elements.forEach((el, id) => {
    if (el.get('pageId') === COMPONENT_EDITOR_PAGE_ID) {
      toDelete.push(id);
    }
  });
  for (const id of toDelete) elements.delete(id);
  pages.delete(COMPONENT_EDITOR_PAGE_ID);
}

export function applyCommand(doc: Y.Doc, command: EditorCommand): boolean {
  // Delegate variable commands
  if (command.type.startsWith('ADD_VARIABLE') || command.type.startsWith('DELETE_VARIABLE') ||
      command.type.startsWith('RENAME_VARIABLE') || command.type.startsWith('UPDATE_VARIABLE') ||
      command.type.startsWith('SET_DEFAULT_MODE') || command.type.startsWith('REORDER_VARIABLE') ||
      command.type === 'SET_COLLECTION_FROM_CSS') {
    let result = false;
    doc.transact(() => { result = applyVariableCommand(doc, command); });
    return result;
  }

  // Delegate content collection commands
  if (isCollectionCommand(command.type)) {
    let result = false;
    doc.transact(() => { result = applyCollectionCommand(doc, command); });
    return result;
  }

  // Delegate project-font commands
  if (isFontCommand(command.type)) {
    let result = false;
    doc.transact(() => { result = applyFontCommand(doc, command); });
    return result;
  }

  const meta = doc.getMap('meta');
  const pages = doc.getMap('pages');
  const elements = doc.getMap('elements');

  switch (command.type) {
    case 'SET_CURRENT_PAGE': {
      meta.set('currentPageId', command.pageId);
      break;
    }

    // Canvas theme-mode preview (variable mode name, lowercased; null = default mode)
    case 'SET_THEME_MODE': {
      meta.set('currentThemeMode', command.mode);
      break;
    }

    case 'SET_BREAKPOINT': {
      meta.set('currentBreakpoint', command.breakpoint);
      // Persist to localStorage
      try {
        localStorage.setItem(BREAKPOINT_STORAGE_KEY, command.breakpoint);
      } catch {
        // Ignore storage errors
      }
      break;
    }

    case 'ADD_PAGE': {
      // task-036 1:1 lock: a collection has exactly ONE detail page. A second
      // pageType='post' page for the same collection means ambiguous routing.
      if (command.page.pageType === 'post' && command.page.collectionId) {
        let claimed = false;
        pages.forEach((v) => {
          const yp = v as Y.Map<unknown>;
          if (isPostPageYMap(yp) && yp.get('collectionId') === command.page.collectionId) claimed = true;
        });
        if (claimed) {
          console.error(
            `[ADD_PAGE] Refused: collection "${command.page.collectionId}" already has a detail page — a collection has exactly one detail page (task-036 1:1 lock).`
          );
          return false;
        }
      }
      const yPage = new Y.Map();
      yPage.set('id', command.page.id);
      yPage.set('name', command.page.name);
      yPage.set('rootElementIds', Y.Array.from(command.page.rootElementIds));
      yPage.set('children', Y.Array.from(command.page.children || []));
      if (command.page.pageType) yPage.set('pageType', command.page.pageType);
      if (command.page.collectionId) yPage.set('collectionId', command.page.collectionId);
      if (command.page.routePrefix) yPage.set('routePrefix', command.page.routePrefix);
      if (command.page.layoutName) yPage.set('layoutName', command.page.layoutName);
      if (command.page.layoutProps) yPage.set('layoutProps', command.page.layoutProps);
      if (command.page.isHome) yPage.set('isHome', true);
      pages.set(command.page.id, yPage);
      // Register as a root page so the Pages tree (which renders from
      // rootPages) sees it. Skipped when another page already claims it as
      // a child; callers nesting AFTER the fact use MOVE_PAGE, which removes
      // the rootPages entry. Without this, a bare ADD_PAGE (e.g. the AI
      // add_page tool) created an invisible orphan.
      const rootPages = doc.getArray<string>('rootPages');
      if (
        !rootPages.toArray().includes(command.page.id) &&
        findParentPageId(pages, command.page.id) === null
      ) {
        rootPages.push([command.page.id]);
      }
      break;
    }

    case 'DELETE_PAGE': {
      if (pages.size <= 1) return false;

      const page = pages.get(command.pageId) as Y.Map<unknown> | undefined;
      if (!page) return false;

      // Guard: a root page (no parent in another page's children) with children
      // would cascade-delete all descendants. Refuse to do that silently.
      const rootPages = doc.getArray<string>('rootPages');
      const isRootPage =
        rootPages.toArray().includes(command.pageId) ||
        findParentPageId(pages, command.pageId) === null;
      const pageChildren = (page.get('children') as Y.Array<string> | undefined)?.toArray() || [];
      if (isRootPage && pageChildren.length > 0) {
        console.warn(
          `[DELETE_PAGE] Refused to delete root page "${command.pageId}" because it has ${pageChildren.length} child page(s). Move or delete children first.`
        );
        return false;
      }

      // Recursively collect all descendant page IDs
      const pagesToDelete: string[] = [command.pageId];
      const collectDescendants = (pageId: string) => {
        const p = pages.get(pageId) as Y.Map<unknown> | undefined;
        if (!p) return;
        const children = (p.get('children') as Y.Array<string>)?.toArray() || [];
        children.forEach(childId => {
          pagesToDelete.push(childId);
          collectDescendants(childId);
        });
      };
      collectDescendants(command.pageId);

      const deletedHome = pagesToDelete.some(id =>
        (pages.get(id) as Y.Map<unknown> | undefined)?.get('isHome') === true);

      // Delete all elements on these pages
      const elementsToDelete: string[] = [];
      elements.forEach((el, key) => {
        const yEl = el as Y.Map<unknown>;
        if (pagesToDelete.includes(yEl.get('pageId') as string)) {
          elementsToDelete.push(key);
        }
      });

      // Clean up sourceClasses and sourceText entries for deleted elements
      for (const elementId of elementsToDelete) {
        deleteSourceEntries(doc, elementId);
      }

      elementsToDelete.forEach(id => elements.delete(id));

      // Remove from parent's children array or rootPages
      const parentId = findParentPageId(pages, command.pageId);
      if (parentId) {
        const parent = pages.get(parentId) as Y.Map<unknown> | undefined;
        if (parent) {
          const parentChildren = parent.get('children') as Y.Array<string> | undefined;
          if (parentChildren) {
            const idx = parentChildren.toArray().indexOf(command.pageId);
            if (idx !== -1) parentChildren.delete(idx, 1);
          }
        }
      } else {
        const rootPages = doc.getArray('rootPages');
        const idx = rootPages.toArray().indexOf(command.pageId);
        if (idx !== -1) rootPages.delete(idx, 1);
      }

      // Delete all pages
      pagesToDelete.forEach(id => pages.delete(id));

      // The home page was deleted: keep the exactly-one-home invariant by
      // stamping the first remaining root page that SET_HOME_PAGE itself
      // would accept — post/detail pages must never own the root route.
      if (deletedHome) {
        const heirId = doc
          .getArray<string>('rootPages')
          .toArray()
          .find((id) => pages.has(id) && !isCollectionBoundPage(doc, id));
        if (heirId) (pages.get(heirId) as Y.Map<unknown>).set('isHome', true);
      }

      // Clear selection if current page was deleted
      const currentPageId = meta.get('currentPageId') as string | null;
      if (currentPageId && pagesToDelete.includes(currentPageId)) {
        const rootPages = doc.getArray('rootPages');
        const firstPage = rootPages.length > 0 ? rootPages.get(0) : null;
        meta.set('currentPageId', firstPage);
      }
      break;
    }

    case 'RENAME_PAGE': {
      const page = pages.get(command.pageId) as Y.Map<unknown> | undefined;
      if (!page) return false;
      page.set('name', command.name);
      break;
    }

    case 'SET_HOME_PAGE': {
      const page = pages.get(command.pageId) as Y.Map<unknown> | undefined;
      if (!page) return false;
      // Post/detail pages render a single post and must never own the root route.
      if (isCollectionBoundPage(doc, command.pageId)) return false;
      pages.forEach((value, id) => {
        const p = value as Y.Map<unknown>;
        if (id !== command.pageId && p.get('isHome') !== undefined) p.delete('isHome');
      });
      page.set('isHome', true);
      break;
    }

    case 'MOVE_PAGE': {
      const page = pages.get(command.pageId) as Y.Map<unknown> | undefined;
      if (!page) return false;

      // IMPORTANT: Validate new parent exists BEFORE removing from current parent
      // to prevent orphaning the page if new parent doesn't exist
      if (command.newParentId) {
        const newParent = pages.get(command.newParentId) as Y.Map<unknown> | undefined;
        if (!newParent) return false; // Abort early - don't orphan the page
      }

      // Remove from current parent (safe now that we validated new parent)
      const currentParentId = findParentPageId(pages, command.pageId);
      if (currentParentId) {
        const parent = pages.get(currentParentId) as Y.Map<unknown> | undefined;
        if (parent) {
          const children = parent.get('children') as Y.Array<string> | undefined;
          if (children) {
            const idx = children.toArray().indexOf(command.pageId);
            if (idx !== -1) children.delete(idx, 1);
          }
        }
      } else {
        const rootPages = doc.getArray('rootPages');
        const idx = rootPages.toArray().indexOf(command.pageId);
        if (idx !== -1) rootPages.delete(idx, 1);
      }

      // Add to new parent
      if (command.newParentId) {
        const newParent = pages.get(command.newParentId) as Y.Map<unknown>;
        let children = newParent.get('children') as Y.Array<string>;
        if (!children) {
          children = new Y.Array<string>();
          newParent.set('children', children);
        }
        children.insert(command.index, [command.pageId]);
      } else {
        const rootPages = doc.getArray('rootPages');
        rootPages.insert(command.index, [command.pageId]);
      }
      break;
    }

    case 'ADD_ELEMENT': {
      // Validate the page BEFORE inserting: a root element on a missing page
      // used to be written into `elements` anyway — an invisible orphan the
      // caller (e.g. add_page_content) then reported as success.
      const targetPage = command.element.parentId
        ? undefined
        : (pages.get(command.element.pageId) as Y.Map<unknown> | undefined);
      if (!command.element.parentId && !targetPage) {
        console.error('[ADD_ELEMENT] Page not found:', command.element.pageId);
        return false;
      }

      elements.set(command.element.id, createElementYMap(command.element));

      // Add root elements to page's rootElementIds (children use index-based ordering)
      if (!command.element.parentId) {
        const page = targetPage as Y.Map<unknown>;
        let rootIds = page.get('rootElementIds') as Y.Array<string> | undefined;
        if (!rootIds) {
          rootIds = new Y.Array<string>();
          page.set('rootElementIds', rootIds);
        }

        // Layout is now a page-level association (SET_PAGE_LAYOUT); dropping a
        // layout-pathed element no longer reparents existing roots. Content
        // stays a flat, scannable list of real roots.
        // Insert at element.index (render order IS the array order — see
        // selectStaticPageComponents/REORDER_PAGE_ELEMENTS). Historically this
        // always pushed, so every AI section landed at the page bottom no
        // matter what index the tool computed.
        const at = Math.max(0, Math.min(command.element.index ?? rootIds.length, rootIds.length));
        rootIds.insert(at, [command.element.id]);
      }

      // Honour registry-only defaultChildren: materialise each as a real
      // Yjs element with parentId set to the new parent. The field itself
      // is dropped by createElementYMap (it doesn't write `defaultChildren`).
      if (command.element.defaultChildren?.length) {
        command.element.defaultChildren.forEach((child, idx) => {
          const childElement: ElementData = {
            id: child.id ?? generateId(),
            pageId: command.element.pageId,
            parentId: command.element.id,
            index: child.index ?? idx,
            type: child.type ?? 'component',
            instanceType: child.instanceType ?? 'local',
            componentType: child.componentType,
            slotName: child.slotName,
            classes: child.classes ?? emptyClassData(),
            staticMarkup: child.staticMarkup,
            astroSource: child.astroSource,
            classOverrides: child.classOverrides ?? {},
          };
          // Recursive: a defaultChild may itself carry defaultChildren.
          applyCommand(doc, { type: 'ADD_ELEMENT', element: childElement });
        });
      }
      break;
    }

    case 'PASTE_ELEMENTS': {
      const yPage = pages.get(command.pageId) as Y.Map<unknown> | undefined;
      if (!yPage) return false;
      // Masters: create ONLY absent entries (SET_MASTER_MARKUP on an existing key
      // remaps every instance sharing that astroSource — service pre-filters, we re-guard).
      const mastersMap = doc.getMap(MASTERS_MAP);
      for (const m of command.masters) {
        if (!mastersMap.has(m.astroSource)) {
          applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: m.astroSource, markup: m.markup });
        }
      }
      let rootAt = command.index;
      for (const entry of command.elements) {
        const yEl = createElementYMap(entry.element);
        if (entry.extraFields) {
          for (const [k, v] of Object.entries(entry.extraFields)) yEl.set(k, plainToY(v));
        }
        if (entry.classOverrides) yEl.set('classOverrides', plainToY(entry.classOverrides));
        if (entry.unifiedOverrides) yEl.set('unifiedOverrides', plainToY(entry.unifiedOverrides));
        elements.set(entry.element.id, yEl);
        if (entry.element.parentId === null) {
          let rootIds = yPage.get('rootElementIds') as Y.Array<string> | undefined;
          if (!rootIds) { rootIds = new Y.Array<string>(); yPage.set('rootElementIds', rootIds); }
          const at = Math.max(0, Math.min(rootAt, rootIds.length));
          rootIds.insert(at, [entry.element.id]);
          rootAt = at + 1;
        }
        if (entry.blogSlot) {
          doc.getMap('blogSlotBindings').set(entry.element.id, plainSlotToYMap(entry.blogSlot));
        }
      }
      break;
    }

    case 'REMOVE_ELEMENT': {
      const element = elements.get(command.elementId) as Y.Map<unknown> | undefined;
      if (!element) return false;
      if (element.get('bindingType') === 'collection-content') return false; // content slot is not user-deletable
      // Master-editor placement child: the element is only this session's
      // materialization — the durable form is the parent markup's <sq-child>.
      // Record the placement on the editor root's deletedSelectors so the
      // bake strips the placeholder (applyDeletionOverrides) and the leave
      // write-back deletes the component tag from source. Without this the
      // delete was doc-cosmetic: the leftover placeholder re-expanded from
      // the child master (ghost section) and every source re-resolve
      // resurrected the component (live-caught: undeletable Footer).
      if (element.get('pageId') === COMPONENT_EDITOR_PAGE_ID) {
        const parentId = element.get('parentId') as string | null | undefined;
        const parent = parentId ? elements.get(parentId) as Y.Map<unknown> | undefined : undefined;
        const pk = placementKeyOf(element);
        if (parent && pk) appendDeletedSelector(parent, pk);
      }
      return removeElementInternal(doc, pages, elements, command.elementId);
    }

    case 'REORDER_PAGE_ELEMENTS': {
      const page = pages.get(command.pageId) as Y.Map<unknown>;
      if (!page) return false;

      const rootIds = page.get('rootElementIds') as Y.Array<string>;
      if (!rootIds) return false;

      // Accept any truthy ID — source keys, instance IDs, drawn IDs are all valid.
      // The caller is responsible for providing meaningful IDs. EDITOR page
      // exception: see isKnownChildElement (unknown ids stay valid here).
      // The #sq-components wrapper is scanned as root-level (parentKey null),
      // so the scan-seed path used to smuggle its key into render order — drop it.
      const validIds = command.elementIds.filter(Boolean).filter(
        (id) => !isWrapperKey(id) &&
          (command.pageId !== COMPONENT_EDITOR_PAGE_ID || !isKnownChildElement(elements, id)),
      );
      if (validIds.length === 0) return false;

      // Replace the entire array with the new order
      // Note: No nested transaction needed - applyCommand is already called within a transaction
      rootIds.delete(0, rootIds.length);
      rootIds.insert(0, validIds);
      break;
    }

    case 'REGISTER_SOURCE_ELEMENT': {
      const sourceClasses = doc.getMap('sourceClasses');
      const existing = sourceClasses.get(command.sourceKey) as Y.Map<unknown> | undefined;

      if (existing) {
        // Repair orphan entries: if sourceLocation is missing, add it now
        if (!existing.get('sourceLocation') && command.sourceLocation) {
          existing.set('sourceLocation', sourceLocationToYMap(command.sourceLocation));
        }
        return false;  // Entry already registered (classes unchanged)
      }

      const yEntry = new Y.Map();
      yEntry.set('classes', command.classes);
      if (command.sourceLocation) {
        yEntry.set('sourceLocation', sourceLocationToYMap(command.sourceLocation));
      }
      sourceClasses.set(command.sourceKey, yEntry);
      break;
    }

    case 'UPDATE_SOURCE_CLASSES': {
      // #sq-components wrapper is editor infrastructure, never user content —
      // a class override on it reflows EVERY section, and selection refuses
      // infra keys so the damage can't be undone from the UI.
      if (isWrapperKey(command.sourceKey)) return false;
      const sourceClasses = doc.getMap('sourceClasses');
      const yEntry = sourceClasses.get(command.sourceKey) as Y.Map<unknown> | undefined;

      if (yEntry) {
        if (command.sourceLocation) yEntry.set('sourceLocation', sourceLocationToYMap(command.sourceLocation));
        // task-184 ↻ anchor: what the FILE rendered before this element was
        // ever overridden. REGISTER_SOURCE_ELEMENT put the DOM's classes here
        // on the click that preceded the first edit, so the value about to be
        // overwritten IS that. Only-if-absent — a second edit must not re-base
        // the anchor onto the first edit's value, and after a reload the entry
        // is restored with the override in `classes` and the anchor already
        // stamped. See sourceClassBaseValue().
        if (!yEntry.has('baseClasses')) {
          yEntry.set('baseClasses', (yEntry.get('classes') as string) ?? '');
        }
        yEntry.set('classes', command.classes);
        yEntry.set('edited', true);
      } else {
        const newEntry = new Y.Map();
        newEntry.set('classes', command.classes);
        newEntry.set('edited', true);
        if (command.sourceLocation) newEntry.set('sourceLocation', sourceLocationToYMap(command.sourceLocation));
        // A recreated entry can follow an accepted undo that has not reached
        // source yet. Its explicit pre-edit value is the undo anchor; the file
        // cache may still describe the earlier edit. Without an explicit value,
        // retain the scan-baseline fallback for unregistered Layers selections.
        // Empty is a known anchor; undefined means unknown, not empty.
        const original = command.originalClasses ?? getClassWriteBaseline(command.sourceKey);
        if (original !== undefined) newEntry.set('baseClasses', original);
        sourceClasses.set(command.sourceKey, newEntry);
      }
      // Instance-scoped source edit (key = instanceId:selector) re-bases ↻.
      stampMasterBaseRevForSourceKey(doc, command.sourceKey);
      mintSqIdForSourceKey(doc, command.sourceKey);

      break;
    }

    case 'CLEAR_SOURCE_TEXT': {
      const sourceText = doc.getMap('sourceText');
      if (!sourceText.has(command.sourceKey)) return false;
      sourceText.delete(command.sourceKey);
      break;
    }

    case 'CLEAR_SOURCE_IMAGE_ATTRIBUTES': {
      // Idempotent: a structural write fires this unconditionally; "nothing
      // to clear" is the common case, never a refusal.
      doc.getMap('sourceImageAttributes').delete(command.sourceKey);
      break;
    }

    case 'UPDATE_SOURCE_TEXT': {
      if (isWrapperKey(command.sourceKey)) return false; // see UPDATE_SOURCE_CLASSES
      const sourceText = doc.getMap('sourceText');
      const yEntry = sourceText.get(command.sourceKey) as Y.Map<unknown> | undefined;

      // task-184 unit B ↻ anchor: what the FILE rendered before this element
      // was ever overridden. Text has no REGISTER_SOURCE_ELEMENT to read a
      // pre-edit value off, so it takes the OTHER thing that knows what the
      // file renders — the scan puts it in the file-value store for every
      // element, clicked or not. The scan's own value, not the bridge's
      // `originalText`: the scanner trims and truncates, and a base captured
      // in one normalisation compared against a `now` captured in another is a
      // FALSE ↻, which sends the user to discard their own work.
      //
      // Measured live on rig `local_63cmon` before this existed: a real
      // canvas text edit produced NO scan (nothing structural changed), so the
      // first scan to see the key came after the master had already moved and
      // the scan-side repair anchored `baseText` to the MOVED value —
      // persisted as {"textContent":"OVERRIDDEN body copy",
      // "baseText":"MASTER MOVED body copy"} — base === now, ↻ dark.
      //
      // Only-if-absent, exactly like baseClasses above. undefined = the scan
      // never saw this key; unknown stays unknown (no ↻ beats a false one).
      const textBase = command.sourceLocation?.sourceVersion ? command.originalText : getFileValue('text', command.sourceKey);
      if (yEntry) {
        yEntry.delete(SOURCE_OWNED_FIELD);
        if (!yEntry.has('baseText') && textBase !== undefined) yEntry.set('baseText', textBase);
        yEntry.set('textContent', command.textContent);
      } else {
        const newEntry = new Y.Map();
        newEntry.set('textContent', command.textContent);
        if (textBase !== undefined) newEntry.set('baseText', textBase);
        sourceText.set(command.sourceKey, newEntry);
      }
      // Instance-scoped text edit re-bases ↻ (task-102).
      stampMasterBaseRevForSourceKey(doc, command.sourceKey);
      mintSqIdForSourceKey(doc, command.sourceKey);

      // A plain-text edit is newer truth than a stored inline-link markup
      // override UNLESS the markup already renders exactly this text (the
      // wrap flow sends MARKUP_CHANGED first, then EDIT_MODE_EXITED with the
      // same text — keeping it preserves the link). On a mismatch the user
      // typed after wrapping: FIRST try to splice the edit into the markup's
      // text runs (spliceLinkMarkupText) so the wrap persists around the
      // edited text — matching the DOM the user is looking at, where the <a>
      // survives a contentEditable text edit. Only an ambiguous edit (the
      // change spans a tag boundary) drops the markup so reload doesn't
      // resurrect the old text; the EDIT_MODE_EXITED handler then flattens
      // the DOM to match (textEditing.ts).
      {
        const linkAttrs = doc.getMap('sourceLinkAttributes');
        const linkEntry = linkAttrs.get(command.sourceKey) as Y.Map<unknown> | undefined;
        linkEntry?.delete(SOURCE_OWNED_FIELD);
        const storedMarkup = linkEntry?.get(LINK_MARKUP_FIELD);
        if (typeof storedMarkup === 'string'
            && linkMarkupFlatText(storedMarkup) !== command.textContent) {
          const spliced = spliceLinkMarkupText(storedMarkup, command.textContent);
          if (spliced !== null) {
            linkEntry!.set(LINK_MARKUP_FIELD, spliced);
          } else {
            linkEntry!.delete(LINK_MARKUP_FIELD);
            linkEntry!.delete(LINK_MARKUP_OWNER_FIELD);
            if (linkEntry!.size === 0) linkAttrs.delete(command.sourceKey);
          }
        }
      }

      break;
    }

    // Inline link wrap/unwrap persistence for source-tracked elements (the
    // WC/doc overlay tier of MARKUP_CHANGED — see types.ts). Stored as a
    // bookkeeping sibling inside the element's sourceLinkAttributes entry so
    // undo capture, delete cleanup, and placement migration all carry it via
    // the existing map; the scan re-apply posts it back as
    // UPDATE_SOURCE_MARKUP after every preview reload.
    case 'UPDATE_SOURCE_MARKUP': {
      const parsedMarkupKey = parseKey(command.sourceKey);
      if (parsedMarkupKey?.type !== 'source') return false;
      const sourceLinkAttributes = doc.getMap('sourceLinkAttributes');
      const attrs = getOrCreateYMap(sourceLinkAttributes, command.sourceKey);
      attrs.delete(SOURCE_OWNED_FIELD);
      attrs.set(LINK_MARKUP_FIELD, command.markup);
      if (command.sourceLocation) attrs.set(LINK_MARKUP_OWNER_FIELD, JSON.stringify({ location: command.sourceLocation }));
      else attrs.delete(LINK_MARKUP_OWNER_FIELD);
      break;
    }

    case 'UPDATE_STATIC_MARKUP': {
      const yEl = elements.get(command.elementId) as Y.Map<unknown> | undefined;
      if (!yEl) return false;

      // Process markup with instance-prefixed data-key attributes
      const processedMarkup = addKeysToMarkup(command.staticMarkup, command.elementId);
      yEl.set('staticMarkup', processedMarkup);

      // Clear ALL overrides — new markup is the source of truth
      clearAllOverrideFields(yEl);

      // Clear sourceClasses entries for this instance's children (keyed by instanceId:selector)
      // Must happen BEFORE sourceText cleanup — both use the same key pattern.
      // Without this, REGISTER_SOURCE_ELEMENT skips re-registration for reused selectors,
      // keeping stale class data from the old markup.
      const sourceClasses = doc.getMap('sourceClasses');
      const isBlogCard = command.elementId.endsWith(':blogcard');
      const sourceClassKeysToDelete: string[] = [];
      sourceClasses.forEach((_value, classKey) => {
        if (classKey.startsWith(command.elementId + ':')) {
          sourceClassKeysToDelete.push(classKey);
        }
        // Only clean stale dynamic: entries for blog card resets (they affect all slots otherwise)
        if (isBlogCard && classKey.startsWith('dynamic:')) sourceClassKeysToDelete.push(classKey);
      });
      for (const classKey of sourceClassKeysToDelete) {
        sourceClasses.delete(classKey);
      }

      const sourceText = doc.getMap('sourceText');
      const sourceTextKeysToDelete: string[] = [];
      sourceText.forEach((_value, textKey) => {
        if (textKey.startsWith(command.elementId + ':')) {
          sourceTextKeysToDelete.push(textKey);
        }
        if (isBlogCard && textKey.startsWith('dynamic:')) sourceTextKeysToDelete.push(textKey);
      });
      for (const textKey of sourceTextKeysToDelete) {
        sourceText.delete(textKey);
      }
      break;
    }

    // Pen tool node edit: penPath + derived staticMarkup + refit wrapper classes,
    // atomically. Deliberately does NOT clear overrides (that behavior is
    // instance-flavored — see UPDATE_STATIC_MARKUP above). (task-107)
    case 'UPDATE_PEN_PATH': {
      const yEl = elements.get(command.elementId) as Y.Map<unknown> | undefined;
      if (!yEl) return false;
      yEl.set('penPath', command.penPath);
      yEl.set('staticMarkup', command.staticMarkup);
      const sourceClasses = doc.getMap('sourceClasses');
      let yEntry = sourceClasses.get(command.elementId) as Y.Map<unknown> | undefined;
      if (!yEntry) {
        yEntry = new Y.Map();
        sourceClasses.set(command.elementId, yEntry);
      }
      yEntry.set('classes', command.classes);
      break;
    }

    case 'UPDATE_INSTANCE_OVERRIDE': {
      const instance = elements.get(command.instanceId) as Y.Map<unknown> | undefined;
      if (!instance) break;

      const overrides = getOrCreateYMap(instance, 'overrides');
      const childOverride = getOrCreateYMap(overrides, command.childId);

      // Apply updates
      for (const [key, value] of Object.entries(command.updates)) {
        childOverride.set(key, value);
      }
      stampMasterBaseRev(doc, command.instanceId);
      // childId is a selector for instance children; non-selector ids no-op inside.
      ensureSqIdInMasters(doc, instance, command.childId);
      break;
    }

    case 'SET_MASTER_MARKUP': {
      const masters = doc.getMap(MASTERS_MAP);
      let entry = masters.get(command.astroSource) as Y.Map<unknown> | undefined;
      const prevMarkup = entry?.get('markup') as string | undefined;
      if (prevMarkup === command.markup) {
        break; // no-op fast path (ledger #23)
      }

      // task-118: structural remap — one computeSelectorRemap per DISTINCT old
      // markup (ledger #14: with no masters entry yet, placements' frozen
      // staticMarkup may differ per placement), cached by string.
      const remaps = new Map<string, SelectorRemap>();
      const remapFor = (old: string): SelectorRemap => {
        let r = remaps.get(old);
        if (!r) { r = computeSelectorRemap(old, command.markup); remaps.set(old, r); }
        return r;
      };

      const primary = prevMarkup !== undefined ? remapFor(prevMarkup) : undefined;
      // graft: surviving data-sq-ids re-inserted before store (ledger #22)
      const stored = primary?.graftedMarkup ?? command.markup;

      if (!entry) { entry = new Y.Map(); masters.set(command.astroSource, entry); }
      entry.set('markup', stored);
      // ↻ axis (task-102): bump rev only on a REAL change — id-only diffs
      // (graft rounds) are semantically invisible (ledger #21).
      if (stripSqIds(prevMarkup ?? '') !== stripSqIds(stored)) {
        entry.set('rev', (((entry.get('rev') as number) ?? 0) + 1));
      }

      remapMasterChildOverrides(doc, command.astroSource, entry, primary);
      elements.forEach((val) => {
        const el = val as Y.Map<unknown>;
        if (el.get('astroSource') !== command.astroSource) return;
        const r = primary ?? remapFor((el.get('staticMarkup') as string) ?? '');
        if (r.identity) return;
        // orphans FIRST: a rekey landing on an unmatched key would overwrite
        // the data recordOrphans snapshots (only data-holding selectors orphan,
        // ledger #12).
        recordOrphans(doc, command.astroSource, el, r);
        remapElementOverrides(doc, el, r);
      });
      break;
    }

    // task-118 orphan UX: Discard drops the record (entries snapshot and all).
    // Keep is a no-op by design — the record simply stays.
    case 'DISCARD_OVERRIDE_ORPHAN': {
      const orphansMap = doc.getMap(ORPHANS_MAP);
      if (!orphansMap.has(command.orphanId)) return false;
      orphansMap.delete(command.orphanId);
      break;
    }

    case 'SET_MASTER_CHILD_OVERRIDES': {
      const entry = doc.getMap(MASTERS_MAP).get(command.astroSource) as Y.Map<unknown> | undefined;
      if (!entry) break; // no master yet — nothing to attach child overrides to
      // Plain JSON value (not nested Y.Map) so the existing masters observer/persistence fires on entry.set.
      const all = { ...((entry.get('childOverrides') as MasterChildOverrides | undefined) ?? {}) };
      if (command.overrides === null) delete all[command.placementKey];
      else all[command.placementKey] = command.overrides;
      entry.set('childOverrides', all);
      break;
    }

    case 'REMAP_COMPONENT_SOURCE': {
      // Promote/un-promote moved the component file — repoint every element
      // whose componentPath/astroSource still names the old location.
      elements.forEach((value) => {
        const el = value as Y.Map<unknown>;
        if (!(el instanceof Y.Map)) return;
        if (el.get('componentPath') === command.oldPath) el.set('componentPath', command.newPath);
        if (el.get('astroSource') === command.oldPath) el.set('astroSource', command.newPath);
      });
      break;
    }

    case 'ADD_THEME_INSTANCE': {
      const yElement = new Y.Map();
      yElement.set('id', command.element.id);
      yElement.set('pageId', command.element.pageId);
      yElement.set('parentId', command.element.parentId);
      yElement.set('index', command.element.index);
      yElement.set('type', 'instance');
      yElement.set('instanceType', 'theme');  // Explicit discriminator
      yElement.set('themeId', command.element.themeId);
      yElement.set('componentPath', command.element.componentPath);

      // Pre-process staticMarkup to add data-key attributes for class lookup
      const processedMarkup = command.element.staticMarkup
        ? addKeysToMarkup(command.element.staticMarkup, command.element.id)
        : undefined;

      if (processedMarkup) {
        yElement.set('staticMarkup', processedMarkup);
      }

      const yClasses = classDataToYMap(command.element.classes);
      yElement.set('classes', yClasses);

      // Initialize empty classOverrides map
      const yClassOverrides = new Y.Map();
      yElement.set('classOverrides', yClassOverrides);

      elements.set(command.element.id, yElement);

      // Add root elements to page's rootElementIds
      if (!command.element.parentId) {
        const page = pages.get(command.element.pageId) as Y.Map<unknown> | undefined;
        if (page) {
          const rootIds = page.get('rootElementIds') as Y.Array<string> | undefined;
          if (rootIds) {
            rootIds.push([command.element.id]);
          } else {
            // Initialize rootElementIds if missing
            const newRootIds = new Y.Array<string>();
            newRootIds.push([command.element.id]);
            page.set('rootElementIds', newRootIds);
          }
        } else {
          console.error('[ADD_THEME_INSTANCE] Page not found:', command.element.pageId);
        }
      }
      break;
    }

    case 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE': {
      const instance = elements.get(command.instanceId) as Y.Map<unknown> | undefined;
      if (!instance) {
        console.warn('[cmd:UPDATE_THEME_INSTANCE_CLASS_OVERRIDE] instance not found', command.instanceId);
        break;
      }

      // task-102: classes null = delete the selector's class override entry —
      // the store is a FULL-REPLACEMENT (flat class string in 'base'), so a
      // set equal to the original markup must not linger as a no-op override
      // (phantom asterisk). [] means "cleared all classes", not "inherit".
      if (command.classes === null) {
        const existingOverrides = instance.get('classOverrides') as Y.Map<unknown> | undefined;
        existingOverrides?.delete(command.selector);
        break;
      }

      // task-118: anchor the override with a stable id before it's written.
      ensureSqIdInMasters(doc, instance, command.selector);

      const classOverrides = getOrCreateYMap(instance, 'classOverrides');

      let selectorOverride = classOverrides.get(command.selector) as Y.Map<Y.Array<string>> | undefined;
      if (!selectorOverride) {
        selectorOverride = new Y.Map();
        // Initialize all breakpoints
        selectorOverride.set('base', new Y.Array<string>());
        selectorOverride.set('sm', new Y.Array<string>());
        selectorOverride.set('md', new Y.Array<string>());
        selectorOverride.set('lg', new Y.Array<string>());
        selectorOverride.set('xl', new Y.Array<string>());
        selectorOverride.set('2xl', new Y.Array<string>());
        classOverrides.set(command.selector, selectorOverride);
      }

      const bpClasses = selectorOverride.get(command.breakpoint) as Y.Array<string> | undefined;
      if (!bpClasses) {
        // Initialize if breakpoint somehow missing (shouldn't happen but be safe)
        const newArray = new Y.Array<string>();
        newArray.push(command.classes);
        selectorOverride.set(command.breakpoint, newArray);
        return false;
      }
      bpClasses.delete(0, bpClasses.length);
      bpClasses.push(command.classes);
      stampMasterBaseRev(doc, command.instanceId);
      break;
    }

    case 'RESET_THEME_INSTANCE_OVERRIDE': {
      // Reset a specific selector's overrides - removes the override to show original classes/text
      const instance = elements.get(command.instanceId) as Y.Map<unknown> | undefined;
      if (!instance) {
        console.warn(`[Commands] Instance not found for RESET_THEME_INSTANCE_OVERRIDE: ${command.instanceId}`);
        break;
      }

      // Clear all override types for this selector
      const overrideKeys = ['classOverrides', 'overrides', 'textOverrides', 'markupOverrides', 'imageOverrides', 'attributeOverrides', 'linkOverrides', 'hrefOverrides', 'unifiedOverrides'] as const;
      for (const key of overrideKeys) {
        const overrideMap = instance.get(key) as Y.Map<unknown> | undefined;
        if (overrideMap?.has(command.selector)) {
          overrideMap.delete(command.selector);
        }
      }

      // Also remove from deletedSelectors if present
      const deletedSelectors = instance.get('deletedSelectors') as Y.Array<string> | undefined;
      if (deletedSelectors) {
        const idx = deletedSelectors.toArray().indexOf(command.selector);
        if (idx !== -1) {
          deletedSelectors.delete(idx, 1);
        }
      }
      break;
    }

    case 'UPDATE_MARKUP_OVERRIDE': {
      const instance = elements.get(command.instanceId) as Y.Map<unknown> | undefined;
      if (!instance) {
        console.warn(`[Commands] Instance not found for UPDATE_MARKUP_OVERRIDE: ${command.instanceId}`);
        break;
      }

      const markupOverrides = getOrCreateYMap<string>(instance, 'markupOverrides');

      markupOverrides.set(command.selector, command.markup);
      ensureSqIdInMasters(doc, instance, command.selector);
      break;
    }

    case 'UPDATE_LINK_ATTRIBUTE': {
      const parsed = parseKey(command.elementId);
      if (!parsed) {
        console.warn('[SQ-LINKLOG] parseKey FAILED — write dropped:', command.elementId);
        break;
      }

      // Validate attribute-specific constraints
      if (command.attribute === 'target' && command.value &&
          !['_blank', '_self', '_parent', '_top'].includes(command.value)) {
        console.warn(`[UPDATE_LINK_ATTRIBUTE] Invalid target value: ${command.value}`);
        break;
      }

      if (parsed.type === 'instance-root') {
        // Instance root - store linkAttributes directly on element
        const element = elements.get(parsed.instanceId) as Y.Map<unknown> | undefined;
        if (!element) {
          console.warn('[SQ-LINKLOG] instance-root element NOT FOUND — write dropped:', parsed.instanceId);
          break;
        }

        const linkAttrs = getOrCreateYMap(element, 'linkAttributes');

        if (command.value) {
          linkAttrs.set(command.attribute, command.value);
        } else {
          linkAttrs.delete(command.attribute);
        }
      } else if (parsed.type === 'instance-child') {
        const element = elements.get(parsed.instanceId) as Y.Map<unknown> | undefined;
        if (!element) {
          console.warn('[SQ-LINKLOG] instance-child parent element NOT FOUND — write dropped:', parsed.instanceId, 'selector:', parsed.selector);
          break;
        }

        const linkOverrides = getOrCreateYMap<Y.Map<unknown>>(element, 'linkOverrides');
        const selectorAttrs = getOrCreateYMap(linkOverrides, parsed.selector);

        if (command.value) {
          selectorAttrs.set(command.attribute, command.value);
          ensureSqIdInMasters(doc, element, parsed.selector);
        } else {
          selectorAttrs.delete(command.attribute);
          if (selectorAttrs.size === 0) {
            linkOverrides.delete(parsed.selector);
          }
        }
      } else if (parsed.type === 'source') {
        // Source elements - store in sourceLinkAttributes map
        const sourceLinkAttributes = doc.getMap('sourceLinkAttributes');
        const sourceKey = command.elementId;

        const attrs = getOrCreateYMap(sourceLinkAttributes, sourceKey);

        if (command.value) {
          attrs.set(command.attribute, command.value);
        } else {
          attrs.delete(command.attribute);
          if (attrs.size === 0) {
            sourceLinkAttributes.delete(sourceKey);
          }
        }
      }
      break;
    }

    case 'UNWRAP_LINK': {
      const parsedUnwrap = parseKey(command.elementId);
      if (!parsedUnwrap || parsedUnwrap.type === 'source') break;

      const element = elements.get(parsedUnwrap.instanceId) as Y.Map<unknown> | undefined;
      if (!element) break;

      const originalType = element.get('originalType') as string | undefined;
      if (originalType) {
        element.set('type', originalType);
        element.delete('originalType');
      } else {
        // If no original type, default to component
        element.set('type', 'component');
      }

      element.delete('isWrapperLink');
      element.delete('linkAttributes');
      element.delete('linkCounters');

      // Clean up link-related overrides for the unwrapped link's selector
      if (parsedUnwrap.type === 'instance-child') {
        const linkOverrideKeys = ['markupOverrides', 'linkOverrides', 'hrefOverrides', 'classOverrides', 'unifiedOverrides'] as const;
        for (const key of linkOverrideKeys) {
          const overrideMap = element.get(key) as Y.Map<unknown> | undefined;
          if (overrideMap?.has(parsedUnwrap.selector)) {
            overrideMap.delete(parsedUnwrap.selector);
          }
        }
      }
      break;
    }

    case 'UPDATE_PAGE_SEO': {
      const page = pages.get(command.pageId) as Y.Map<unknown> | undefined;
      if (!page) return false;

      const seoMap = getOrCreateYMap(page, 'seo');

      // Handle nested types (ImageField, arrays, etc.) via the shared coercion
      // primitive so hydrateSeoMap rebuilds the exact same Y structure on reload.
      const value = command.value;
      if (value === null || value === undefined) {
        seoMap.delete(command.field);
      } else {
        seoMap.set(command.field, coerceSeoValueToYjs(value));
      }
      break;
    }

    case 'UPDATE_IMAGE_ATTRIBUTE': {
      const parsed = parseKey(command.elementId);
      if (!parsed) {
        break;
      }

      // Validate loading attribute value
      if (command.attribute === 'loading' && command.value &&
          !['lazy', 'eager'].includes(command.value)) {
        console.warn(`[UPDATE_IMAGE_ATTRIBUTE] Invalid loading value: ${command.value}`);
        break;
      }

      if (parsed.type === 'instance-root') {
        // Instance root - store imageAttributes directly on element
        const element = elements.get(parsed.instanceId) as Y.Map<unknown> | undefined;
        if (!element) {
          break;
        }

        const imageAttrs = getOrCreateYMap(element, 'imageAttributes');

        if (command.value) {
          imageAttrs.set(command.attribute, command.value);
        } else {
          imageAttrs.delete(command.attribute);
        }
      } else if (parsed.type === 'instance-child') {
        const element = elements.get(parsed.instanceId) as Y.Map<unknown> | undefined;
        if (!element) {
          break;
        }

        const imageOverrides = getOrCreateYMap<Y.Map<unknown>>(element, 'imageOverrides');
        const selectorAttrs = getOrCreateYMap(imageOverrides, parsed.selector);

        if (command.value) {
          selectorAttrs.set(command.attribute, command.value);
          ensureSqIdInMasters(doc, element, parsed.selector);
        } else {
          selectorAttrs.delete(command.attribute);
          if (selectorAttrs.size === 0) {
            imageOverrides.delete(parsed.selector);
          }
        }
      } else if (parsed.type === 'source') {
        // Source elements - store in sourceImageAttributes map
        const sourceImageAttributes = doc.getMap('sourceImageAttributes');
        const sourceKey = command.elementId;

        const attrs = getOrCreateYMap(sourceImageAttributes, sourceKey);
        const owned = sourceOwnedImageValues(attrs);
        delete owned[command.attribute];
        if (Object.keys(owned).length) attrs.set(SOURCE_OWNED_FIELD, JSON.stringify(owned));
        else attrs.delete(SOURCE_OWNED_FIELD);

        // '' is a VALUE for src / alt on a source key ("no image", "decorative")
        // — never "drop the override": deleting it made the bridge restore the
        // picture (owner 2026-09-20). Clearing an override is
        // CLEAR_SOURCE_IMAGE_ATTRIBUTES. Other attributes keep the old shape.
        if (command.value || (command.value === '' && (command.attribute === 'src' || command.attribute === 'alt'))) {
          attrs.set(command.attribute, command.value);
        } else {
          attrs.delete(command.attribute);
          // task-186 FIX-2: the ↻ anchor rides in this same map, so "no
          // attributes left" is not "size 0" any more. An anchor-only entry
          // would count as an override for anything reading the map's keys
          // (store/componentUsage's "N other placements") while every reader
          // that skips the anchor correctly saw nothing.
          // Only the bookkeeping fields left (the ↻ anchor and the file's own
          // value) means no real attribute survives — the entry is empty.
          const realAttrs = [...attrs.keys()].filter((a) => !isImageBookkeepingField(a));
          if (realAttrs.length === 0) {
            sourceImageAttributes.delete(sourceKey);
          }
        }
      }
      break;
    }

    case 'SET_SLOT_NAME': {
      const element = elements.get(command.elementId) as Y.Map<unknown> | undefined;
      // A slot is identified by EITHER type==='slot' (codegen-shaped element) or
      // slotType==='slot' (the shape the slot draw tool produces — type stays
      // 'frame'/'text', slot identity lives in slotType).
      const isSlot =
        element?.get('type') === 'slot' || element?.get('slotType') === 'slot';
      if (!element || !isSlot) {
        break;
      }
      // attributes is stored as a plain object (codegen reads attrs?.name),
      // so replace it wholesale rather than mutating a Y.Map.
      const existing = (element.get('attributes') as Record<string, string> | undefined) ?? {};
      const next: Record<string, string> = { ...existing };
      const name = command.name.trim();
      if (name) {
        next.name = name;
      } else {
        delete next.name;
      }
      if (Object.keys(next).length > 0) {
        element.set('attributes', next);
      } else {
        element.delete('attributes');
      }
      break;
    }

    case 'UPDATE_INSTANCE_CHILD_ATTRIBUTE': {
      // The selected child (e.g. a layout <slot> in the editor) is a SOURCE
      // element, not a Yjs element — store the attribute override on the editor
      // root instance, keyed by selector. pushOverridesToSource collects these
      // and writes `attr="value"` back into the .astro source (empty value =>
      // remove the attribute). Mirrors UPDATE_THEME_INSTANCE_CLASS_OVERRIDE.
      const instance = elements.get(command.instanceId) as Y.Map<unknown> | undefined;
      if (!instance) {
        console.warn('[cmd:UPDATE_INSTANCE_CHILD_ATTRIBUTE] instance not found', command.instanceId);
        break;
      }
      const attributeOverrides = getOrCreateYMap(instance, 'attributeOverrides');
      let selectorAttrs = attributeOverrides.get(command.selector) as Y.Map<string> | undefined;
      if (!selectorAttrs) {
        selectorAttrs = new Y.Map<string>();
        attributeOverrides.set(command.selector, selectorAttrs);
      }
      // Always store (including '') — '' is a meaningful "remove the attribute"
      // instruction that must round-trip to the write-back endpoint.
      selectorAttrs.set(command.attribute, command.value);
      stampMasterBaseRev(doc, command.instanceId);
      ensureSqIdInMasters(doc, instance, command.selector);
      break;
    }

    case 'SET_ELEMENT_SLOT_NAME': {
      const element = elements.get(command.elementId) as Y.Map<unknown> | undefined;
      if (!element) return false;
      const name = (command.slotName ?? '').trim();
      if (name) {
        element.set('slotName', name);
      } else {
        element.delete('slotName');
      }
      break;
    }

    case 'SET_PAGE_LAYOUT': {
      const page = pages.get(command.pageId) as Y.Map<unknown> | undefined;
      if (!page) return false;
      if (command.layoutName == null) {
        page.delete('layoutName');
        page.delete('layoutProps');
        // Dropping the layout drops the adopted-source version with it.
        page.delete('layoutMasterVersion');
        // ...and the derived editor-only chrome element.
        removeLayoutElement(doc, command.pageId);
      } else {
        page.set('layoutName', command.layoutName);
        page.set('layoutProps', command.layoutProps ?? {});
        // Create/refresh the derived layout-chrome element so the page's layout
        // reuses the component-instance lifecycle. Body comes from layout
        // discovery at the dispatch site; when absent the element is lazily
        // ensured by the DesignBar / render fallback. ensureLayoutElement
        // preserves an existing same-layout element (and its overrides).
        if (command.body != null) {
          ensureLayoutElement(doc, command.pageId, command.layoutName, command.body);
        }
      }
      break;
    }

    // Lazily create the derived layout-chrome element for an already-applied
    // layout (legacy pages, or pages where SET_PAGE_LAYOUT ran without a body).
    // Idempotent and override-preserving via ensureLayoutElement; no-op unless
    // the page still has this exact layout applied.
    case 'ENSURE_LAYOUT_ELEMENT': {
      const page = pages.get(command.pageId) as Y.Map<unknown> | undefined;
      if (!page) return false;
      if (page.get('layoutName') !== command.layoutName) return false;
      ensureLayoutElement(doc, command.pageId, command.layoutName, command.body);
      break;
    }

    case 'DELETE_PAGE_LAYOUT_WITH_CONTENT': {
      const page = pages.get(command.pageId) as Y.Map<unknown> | undefined;
      if (!page) return false;
      // toArray() detaches a snapshot from the live Y.Array up front, so the
      // loop is safe even though removeElementInternal mutates rootElementIds.
      const rootIds = (page.get('rootElementIds') as Y.Array<string> | undefined)?.toArray() ?? [];
      for (const id of rootIds) {
        removeElementInternal(doc, pages, elements, id);
      }
      page.delete('layoutName');
      page.delete('layoutProps');
      removeLayoutElement(doc, command.pageId);
      break;
    }


    case 'ADD_DRAWN_ELEMENT': {
      const { element: drawn } = command;
      // Auto-convert: root-level frames become <section>, nested stay <div>
      const effectiveTag = drawn.tag === 'div' && !drawn.parentKey ? 'section' : drawn.tag;
      const yElement = new Y.Map();
      yElement.set('id', drawn.key);
      yElement.set('pageId', drawn.pageId);
      yElement.set('parentId', drawn.parentKey);
      yElement.set('index', drawn.insertIndex);
      yElement.set('type', effectiveTag === 'section' || effectiveTag === 'div' ? 'frame' : 'text');
      yElement.set('isDrawn', true);
      yElement.set('tag', effectiveTag);
      if (drawn.slotType) {
        yElement.set('slotType', drawn.slotType);
        if (drawn.slotType === 'blog') {
          yElement.set('componentType', BLOG_SLOT_COMPONENT_TYPE);
          yElement.set('astroSource', drawn.astroSource ?? 'library/BlogSlot.astro');
          if (drawn.staticMarkup) {
            yElement.set('staticMarkup', drawn.staticMarkup);
          }
        }
      }

      // Vector shapes: inline SVG markup for non-slot drawn elements (task-106)
      if (!drawn.slotType && drawn.staticMarkup) {
        yElement.set('staticMarkup', drawn.staticMarkup);
      }
      // Pen tool: anchor data for re-editable paths (task-107)
      if (!drawn.slotType && drawn.penPath) {
        yElement.set('penPath', drawn.penPath);
      }

      if (drawn.textContent) {
        yElement.set('textContent', drawn.textContent);
      }

      // Store classes as a simple string for drawn elements
      const sourceClasses = doc.getMap('sourceClasses');
      const yEntry = new Y.Map();
      yEntry.set('classes', drawn.classes);
      sourceClasses.set(drawn.key, yEntry);

      // Initialize empty class data structure
      const yClasses = new Y.Map();
      for (const bp of ['base', 'sm', 'md', 'lg', 'xl', '2xl']) {
        yClasses.set(bp, new Y.Array<string>());
      }
      yElement.set('classes', yClasses);

      elements.set(drawn.key, yElement);

      // Auto-create posts wrapper child for blog slots
      if (drawn.slotType === 'blog') {
        const postsKey = drawn.key + ':posts';
        const yPostsWrapper = new Y.Map();
        yPostsWrapper.set('id', postsKey);
        yPostsWrapper.set('pageId', drawn.pageId);
        yPostsWrapper.set('parentId', drawn.key);
        yPostsWrapper.set('index', 0);
        yPostsWrapper.set('type', 'frame');
        yPostsWrapper.set('isDrawn', true);
        yPostsWrapper.set('tag', 'div');

        const yPostsClasses = new Y.Map();
        for (const bp of ['base', 'sm', 'md', 'lg', 'xl', '2xl']) {
          yPostsClasses.set(bp, new Y.Array<string>());
        }
        yPostsWrapper.set('classes', yPostsClasses);

        const yPostsEntry = new Y.Map();
        const defaultLayout = `grid grid-cols-${DEFAULT_BLOG_SETTINGS.columns} ${DEFAULT_BLOG_SETTINGS.gap}`;
        yPostsEntry.set('classes', drawn.postsClasses ?? defaultLayout);
        sourceClasses.set(postsKey, yPostsEntry);

        elements.set(postsKey, yPostsWrapper);
      }

      // Add to page's rootElementIds if no parent
      if (!drawn.parentKey) {
        const page = pages.get(drawn.pageId) as Y.Map<unknown> | undefined;
        if (page) {
          const rootIds = page.get('rootElementIds') as Y.Array<string> | undefined;
          if (rootIds) {
            rootIds.push([drawn.key]);
          } else {
            // Initialize rootElementIds if missing
            const newRootIds = new Y.Array<string>();
            newRootIds.push([drawn.key]);
            page.set('rootElementIds', newRootIds);
          }
        } else {
          console.error('[ADD_DRAWN_ELEMENT] Page not found:', drawn.pageId);
        }
      }

      break;
    }

    case 'REMOVE_DRAWN_ELEMENT': {
      const drawnEl = elements.get(command.elementKey) as Y.Map<unknown> | undefined;
      if (!drawnEl) return false;

      const pageId = drawnEl.get('pageId') as string;
      const parentId = drawnEl.get('parentId') as string | null;

      // Remove from page's rootElementIds if root
      if (!parentId) {
        const page = pages.get(pageId) as Y.Map<unknown> | undefined;
        if (page) {
          const rootIds = page.get('rootElementIds') as Y.Array<string> | undefined;
          if (rootIds) {
            const idx = rootIds.toArray().indexOf(command.elementKey);
            if (idx !== -1) rootIds.delete(idx, 1);
          }
        }
      }

      // Clean up childOrders entries referencing this element
      cleanChildOrdersForElement(pages, pageId, command.elementKey);

      // Remove sourceClasses and sourceText entries for this element and its children
      deleteSourceEntries(doc, command.elementKey);

      // Cascade delete drawn children nested inside this drawn element
      cascadeDeleteDrawnChildren(
        elements, pages, doc, pageId, [command.elementKey], false,
      );

      // Clean up blog slot binding if this was a blog slot
      const blogBindings = doc.getMap('blogSlotBindings');
      if (blogBindings.has(command.elementKey)) {
        blogBindings.delete(command.elementKey);
      }

      elements.delete(command.elementKey);
      break;
    }

    case 'CLEAR_DRAWN_SLOT_FILL': {
      const slotEl = elements.get(command.slotKey) as Y.Map<unknown> | undefined;
      if (!slotEl) return false;
      if (!slotEl.get('isDrawn') || !slotEl.get('slotType')) return false;

      for (const f of SLOT_FILL_FIELDS) slotEl.delete(f);
      // Per-instance overrides are keyed against the inner markup we just
      // dropped, so they have to go too.
      clearAllOverrideFields(slotEl);
      break;
    }

    case 'RESOLVE_DRAWN_MEDIA': {
      // task-141: a drawn frame/rect/ellipse becomes an <img>/<video> via
      // staticMarkup; 'none' un-resolves back to the plain container render.
      const mediaEl = elements.get(command.key) as Y.Map<unknown> | undefined;
      if (!mediaEl || !mediaEl.get('isDrawn') || mediaEl.get('slotType')) return false;

      if (command.kind === 'none') {
        mediaEl.delete('staticMarkup');
        break;
      }

      const shape = classifyDrawnMediaShape(mediaEl.get('penPath') as string | undefined);
      if (shape === 'other') {
        // ponytail: polygon/pen/line clip-path media is v2 — flagged, not silent
        console.warn('[RESOLVE_DRAWN_MEDIA] unsupported shape for media resolve:', command.key);
        return false;
      }

      const classEntry = doc.getMap('sourceClasses').get(command.key) as Y.Map<unknown> | undefined;
      let mediaClasses = (classEntry?.get('classes') as string) || '';
      if (shape === 'ellipse' && !mediaClasses.split(/\s+/).includes('rounded-full')) {
        mediaClasses = (mediaClasses + ' rounded-full').trim();
      }
      const mediaSrc = String(command.src ?? '').replace(/"/g, '&quot;');
      mediaEl.set('staticMarkup', command.kind === 'video'
        ? `<video src="${mediaSrc}" autoplay muted loop playsinline class="${mediaClasses}"></video>`
        : `<img src="${mediaSrc}" alt="" class="${mediaClasses}" />`);
      break;
    }

    case 'RESOLVE_INSTANCE_MEDIA': {
      // task-141: Media.astro-born instances only — staticMarkup must be
      // exactly one empty <div data-sq-media> root (or an already-resolved
      // img/video for re-resolve). Anything else is refused: this is a
      // narrow markup rewrite, NOT UPDATE_STATIC_MARKUP (which wipes
      // classOverrides + sourceClasses).
      const instEl = elements.get(command.key) as Y.Map<unknown> | undefined;
      if (!instEl) return false;
      const instMarkup = ((instEl.get('staticMarkup') as string | undefined) ?? '').trim();
      const rootMatch = instMarkup.match(/^<(div|img|video)\b([^>]*?)\/?>(?:\s*<\/\1>)?$/i);
      if (!rootMatch) return false;
      const instTag = rootMatch[1].toLowerCase();
      const instAttrs = rootMatch[2];
      if (instTag === 'div' && !/data-sq-media/.test(instAttrs)) return false;
      const instClassMatch = instAttrs.match(/class\s*=\s*(["'])(.*?)\1/);
      const instClasses = instClassMatch ? instClassMatch[2] : '';

      if (command.kind === 'none') {
        instEl.set('staticMarkup', `<div data-sq-media='true' class='${instClasses}'></div>`);
        break;
      }
      const instSrc = String(command.src ?? '').replace(/"/g, '&quot;');
      instEl.set('staticMarkup', command.kind === 'video'
        ? `<video src="${instSrc}" autoplay muted loop playsinline class="${instClasses}"></video>`
        : `<img src="${instSrc}" alt="" class="${instClasses}" />`);
      break;
    }

    case 'DELETE_INSTANCE_CHILD': {
      const instance = elements.get(command.instanceId) as Y.Map<unknown> | undefined;
      if (!instance) return false;
      if (instance.get('bindingType') === 'collection-content') return false; // content slot is not user-deletable

      appendDeletedSelector(instance, command.selector);
      // task-118: anchor the deletion so it survives structural source edits.
      ensureSqIdInMasters(doc, instance, command.selector);

      // Dual-write: mark as deleted in unifiedOverrides
      const delApi = getInstanceOverrideAPI(elements, command.instanceId);
      if (delApi) {
        delApi.clearOverride(command.selector);
      }

      // Cascade delete drawn elements parented to this instance child.
      // The full data-key of the deleted child is "instanceId:selector".
      const deletedChildKey = command.instanceId + ':' + command.selector;
      const pageId_ic = (instance.get('pageId') as string) || '';
      cascadeDeleteDrawnChildren(
        elements, pages, doc, pageId_ic, [deletedChildKey], false,
      );
      break;
    }

    case 'REPARENT_ELEMENT': {
      const page = pages.get(command.pageId) as Y.Map<unknown> | undefined;
      if (!page) return false;

      const parsed = parseKey(command.elementKey);

      const rootIds = page.get('rootElementIds') as Y.Array<string> | undefined;
      if (!rootIds) return false;

      // Determine the element ID for rootElementIds (which stores IDs, not data-keys)
      const elementId = parsed?.type === 'instance-root' ? parsed.instanceId : command.elementKey;

      // 1. Find and remove from current location
      let removed = false;

      // Try rootElementIds first
      for (let i = 0; i < rootIds.length; i++) {
        if (rootIds.get(i) === elementId) {
          rootIds.delete(i, 1);
          removed = true;
          break;
        }
      }

      // If not in rootElementIds, search childOrders
      if (!removed) {
        const childOrders = page.get('childOrders') as Y.Map<Y.Array<string>> | undefined;
        if (childOrders) {
          for (const [parentKey, children] of childOrders.entries()) {
            const arr = children as Y.Array<string>;
            for (let i = 0; i < arr.length; i++) {
              if (arr.get(i) === command.elementKey) {
                arr.delete(i, 1);
                // Clean up empty entry
                if (arr.length === 0) {
                  childOrders.delete(parentKey);
                }
                removed = true;
                break;
              }
            }
            if (removed) break;
          }
        }
      }

      // 2. Insert into new location
      if (command.newParentKey === null) {
        // Becoming a root element — use element ID format. EDITOR page: see
        // isKnownChildElement; here unknown ids are ALSO refused (a composite
        // data-key can never become an editor root).
        if (command.pageId === COMPONENT_EDITOR_PAGE_ID && (!elements.has(elementId) || isKnownChildElement(elements, elementId))) {
          console.warn('[REPARENT_ELEMENT] editor page: refusing root insert of', elementId);
          break;
        }
        const clampedIndex = Math.min(command.insertIndex, rootIds.length);
        rootIds.insert(clampedIndex, [elementId]);
      } else {
        // Becoming a child — use data-key format
        const childOrders = getOrCreateYMap<Y.Array<string>>(page, 'childOrders');
        let arr = childOrders.get(command.newParentKey);
        if (!arr) {
          arr = new Y.Array<string>();
          childOrders.set(command.newParentKey, arr);
        }
        const clampedIndex = Math.min(command.insertIndex, arr.length);
        arr.insert(clampedIndex, [command.elementKey]);
      }

      // 3. Persist parentId so drawn elements retain their parent after page switch.
      // selectPageDrawnElements reads this to build the RENDER payload's parentKey.
      const yEl = elements.get(command.elementKey) as Y.Map<unknown> | undefined;
      if (yEl) {
        yEl.set('parentId', command.newParentKey);

        // Auto-convert drawn frame tag: root → section, nested → div
        if (yEl.get('isDrawn')) {
          const currentTag = yEl.get('tag') as string;
          if (currentTag === 'div' && !command.newParentKey) {
            yEl.set('tag', 'section');
          } else if (currentTag === 'section' && command.newParentKey) {
            yEl.set('tag', 'div');
          }
        }
      }

      // 4. Source-move recording (task-078): when the moved element is an
      // instance-child of a host with `astroSource` (the component editor), record
      // the cross-parent move on the host so pushOverridesToSource can emit a
      // `reparentOverrides` entry and the write-back's moveElement persists it to
      // the .astro. Encoded "childSelector>parentSelector"; empty parent = root.
      // Gated to SAME-host or root moves — a cross-instance move (different host)
      // can't be expressed as one file's override, so it stays render-only.
      if (parsed?.type === 'instance-child') {
        const hostId = parsed.instanceId;
        const hostEl = elements.get(hostId) as Y.Map<unknown> | undefined;
        if (hostEl && hostEl.get('astroSource')) {
          const childSel = parsed.selector;
          let parentSel: string | null | undefined;
          if (command.newParentKey === null || command.newParentKey === hostId) {
            parentSel = ''; // root / top level of the component file
          } else {
            const np = parseKey(command.newParentKey);
            parentSel = np?.type === 'instance-child' && np.instanceId === hostId
              ? np.selector
              : undefined; // cross-instance / non-source → don't persist to source
          }
          if (parentSel !== undefined) {
            let yReparent = hostEl.get('reparentOverrides') as Y.Array<string> | undefined;
            if (!yReparent) { yReparent = new Y.Array<string>(); hostEl.set('reparentOverrides', yReparent); }
            // Last move wins: drop any prior record for this child selector.
            for (let i = yReparent.length - 1; i >= 0; i--) {
              if ((yReparent.get(i) as string).startsWith(childSel + '>')) yReparent.delete(i, 1);
            }
            yReparent.push([`${childSel}>${parentSel}`]);
          }
        }
      }
      break;
    }

    case 'SET_CHILD_ORDER': {
      const parsedParent = parseKey(command.parentKey);
      if (parsedParent?.type === 'source') {
        console.error(
          '[SET_CHILD_ORDER] refusing source-location parentKey:',
          command.parentKey,
        );
        return false;
      }

      const page = pages.get(command.pageId) as Y.Map<unknown> | undefined;
      if (!page) return false;

      const childOrders = getOrCreateYMap<Y.Array<string>>(page, 'childOrders');

      // Skip no-op replays: identical childKeys → don't rewrite the Y.Array
      // or notify any observers (the auto-flush listens on childOrders'
      // parent path, so a redundant rewrite re-arms the 800ms debounce).
      const existing = childOrders.get(command.parentKey) as Y.Array<string> | undefined;
      if (existing && existing.length === command.childKeys.length) {
        let identical = true;
        for (let i = 0; i < existing.length; i++) {
          if (existing.get(i) !== command.childKeys[i]) { identical = false; break; }
        }
        if (identical) break;
      }

      const arr = new Y.Array<string>();
      arr.insert(0, command.childKeys);
      childOrders.set(command.parentKey, arr);

      // Mirror onto the host instance's `orderOverrides` so source write-back
      // sees it. Only mirror when ALL children share one host — partial sets
      // would write half-truths. Prefer caller-supplied `sourceSelectors`
      // when present: those are translated for sub-component renders
      // (e.g. `section-0` for `<CTA />` becomes `cta-0`, which resolves
      // against the parent .astro source AST).
      let hostInstanceId: string | null = null;
      let mixedInstances = false;
      const selectors: string[] = [];
      for (let i = 0; i < command.childKeys.length; i++) {
        const parsed = parseKey(command.childKeys[i]);
        if (parsed?.type !== 'instance-child') continue;
        if (!hostInstanceId) hostInstanceId = parsed.instanceId;
        else if (parsed.instanceId !== hostInstanceId) { mixedInstances = true; break; }
        const upstream = command.sourceSelectors?.[i];
        selectors.push(upstream && upstream.length > 0 ? upstream : parsed.selector);
      }
      if (!mixedInstances && hostInstanceId && selectors.length > 0) {
        const hostEl = elements.get(hostInstanceId) as Y.Map<unknown> | undefined;
        if (hostEl && hostEl.get('astroSource')) {
          let yOrder = hostEl.get('orderOverrides') as Y.Array<string> | undefined;
          if (!yOrder) {
            yOrder = new Y.Array<string>();
            hostEl.set('orderOverrides', yOrder);
          }
          if (yOrder.length > 0) yOrder.delete(0, yOrder.length);
          yOrder.insert(0, selectors);
        }
      }

      // Render-domain mirror: drives applyRenderOrder in resolved markup.
      // No astroSource gate — markup resolution is independent of write-back.
      if (!mixedInstances && hostInstanceId) {
        const parsedParentKey = parseKey(command.parentKey);
        const renderSelectors = command.childKeys
          .map((k) => parseKey(k))
          .filter((p): p is Extract<ReturnType<typeof parseKey>, { type: 'instance-child' }> =>
            p?.type === 'instance-child' && p.instanceId === hostInstanceId)
          .map((p) => p.selector);
        if (parsedParentKey?.type === 'instance-child' && renderSelectors.length > 0) {
          const hostEl = elements.get(hostInstanceId) as Y.Map<unknown> | undefined;
          if (hostEl) {
            const yRoo = getOrCreateYMap<Y.Array<string>>(hostEl, 'renderOrderOverrides');
            const arr = new Y.Array<string>();
            arr.insert(0, renderSelectors);
            yRoo.set(parsedParentKey.selector, arr);
          }
        }
      }
      break;
    }

    case 'CLEAR_INSTANCE_CHILD_ORDERS': {
      const page = pages.get(command.pageId) as Y.Map<unknown> | undefined;
      if (!page) return false;
      const childOrders = page.get('childOrders') as Y.Map<Y.Array<string>> | undefined;
      if (!childOrders) return false;
      for (const parentKey of [...childOrders.keys()]) {
        if (parentKey === command.instanceId || parentKey.startsWith(command.instanceId + ':')) {
          childOrders.delete(parentKey);
        }
      }
      break;
    }

    // Drop every per-placement override on an instance so it snaps back to its
    // live base (the `masters` overlay → staticMarkup fallback). Shared by ↻
    // (reset) and Push (which bakes the overrides into `masters` first).
    case 'CLEAR_INSTANCE_OVERRIDES': {
      const yEl = elements.get(command.elementId) as Y.Map<unknown> | undefined;
      if (!yEl) return false;
      clearAllOverrideFields(yEl);
      deleteSourceEntries(doc, command.elementId);
      break;
    }

    case 'GRID_PLACE_ELEMENT':
    case 'SET_GRID_SPAN': {
      const sourceClasses = doc.getMap('sourceClasses');
      const yEntry = sourceClasses.get(command.key) as Y.Map<unknown> | undefined;
      if (!yEntry) break;

      yEntry.set('classes', gridCommandClasses((yEntry.get('classes') as string) || '', command));
      break;
    }

    case 'CLEAR_PAGE_DRAWN_ELEMENTS': {
      const keysToRemove: string[] = [];

      elements.forEach((_value, key) => {
        const yEl = _value as Y.Map<unknown>;
        if (!yEl.get('isDrawn')) return;
        if ((yEl.get('pageId') as string) !== command.pageId) return;
        keysToRemove.push(key);
      });

      for (const key of keysToRemove) {
        const yEl = elements.get(key) as Y.Map<unknown>;
        const parentId = yEl.get('parentId') as string | null;

        // Remove from rootElementIds
        if (!parentId) {
          const page = pages.get(command.pageId) as Y.Map<unknown> | undefined;
          if (page) {
            const rootIds = page.get('rootElementIds') as Y.Array<string> | undefined;
            if (rootIds) {
              const idx = rootIds.toArray().indexOf(key);
              if (idx !== -1) rootIds.delete(idx, 1);
            }
          }
        }

        cleanChildOrdersForElement(pages, command.pageId, key);
        deleteSourceEntries(doc, key);
        elements.delete(key);
      }

      break;
    }

    case 'CLEAR_INSTANCE_DRAWN_ELEMENTS': {
      const instanceKeysToRemove: string[] = [];

      elements.forEach((_value, key) => {
        const yEl = _value as Y.Map<unknown>;
        if (!yEl.get('isDrawn')) return;
        if ((yEl.get('pageId') as string) !== command.pageId) return;
        const parentId = yEl.get('parentId') as string | undefined;
        if (parentId === command.instanceId || (parentId && parentId.startsWith(command.instanceId + ':'))) {
          instanceKeysToRemove.push(key);
        }
      });

      for (const key of instanceKeysToRemove) {
        cleanChildOrdersForElement(pages, command.pageId, key);
        deleteSourceEntries(doc, key);
        elements.delete(key);
      }

      break;
    }

  }
  return true;
}

