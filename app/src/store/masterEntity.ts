/**
 * Single source of truth for "master entity" detection. Both the layers panel
 * (ElementsTree) and the DesignBar must treat the same set of keys as masters,
 * so adding a new master kind only requires editing this file.
 *
 * Two flavours:
 *   1. Yjs masters — element ids whose Yjs entry carries master markers.
 *   2. Rendered roots — `addKeysToMarkup` writes every tag of a placed
 *      instance's staticMarkup with `${instanceId}:${tag-N}`, so the DOM
 *      root never matches the bare Yjs id. The rendered root is the topmost
 *      scanned key whose parsed instanceId is a Yjs master AND whose parent
 *      lives outside that instance subtree.
 *   3. Post roots — per-post BlogCard renderings. Each card carries the
 *      same `postSlug` on every node via `closest()`, so the root is the
 *      topmost scanned node whose parent does not share that postSlug.
 */
import type * as Y from 'yjs';
import { parseKey } from './types';
import {
  BLOG_SLOT_COMPONENT_TYPE,
  BLOG_CARD_COMPONENT_NAME,
  blogCardKey,
} from '@/core/collections/types';

export interface ParentLookup {
  key: string;
  parentKey: string | null;
  postSlug?: string;
}

export function isMasterYjsEntry(yEl: Y.Map<unknown> | undefined): boolean {
  if (!yEl) return false;
  const type = yEl.get('type') as string | undefined;
  return (
    type === 'component' ||
    type === 'instance' ||
    !!yEl.get('slotType') ||
    !!yEl.get('staticMarkup') ||
    yEl.get('componentType') === BLOG_SLOT_COMPONENT_TYPE
  );
}

export function collectMasterInstanceIds(doc: Y.Doc): string[] {
  const elements = doc.getMap('elements');
  const result: string[] = [];
  elements.forEach((value, key) => {
    if (isMasterYjsEntry(value as Y.Map<unknown>)) result.push(key);
  });
  return result.sort();
}

/**
 * Narrower than isMasterYjsEntry: only REAL component markers. Excludes the
 * bare-staticMarkup case so AI-added plain frames (add_page_content: type
 * 'frame' + staticMarkup, no componentType) don't read as components in the
 * Layers icon. isMasterYjsEntry stays broad — DesignBar override routing
 * still treats every staticMarkup carrier as a master.
 */
export function isComponentYjsEntry(yEl: Y.Map<unknown> | undefined): boolean {
  if (!yEl) return false;
  const type = yEl.get('type') as string | undefined;
  return (
    type === 'component' ||
    type === 'instance' ||
    !!yEl.get('slotType') ||
    !!yEl.get('componentType')
  );
}

export const collectComponentInstanceIds = (doc: Y.Doc): string[] =>
  collectInstanceIds(doc, (yEl) => isComponentYjsEntry(yEl));

function collectInstanceIds(
  doc: Y.Doc,
  predicate: (yEl: Y.Map<unknown>) => boolean,
): string[] {
  const elements = doc.getMap('elements');
  const result: string[] = [];
  elements.forEach((value, key) => {
    if (predicate(value as Y.Map<unknown>)) result.push(key);
  });
  return result.sort();
}

export function isBlogSlotYjsEntry(yEl: Y.Map<unknown> | undefined): boolean {
  return !!yEl && yEl.get('componentType') === BLOG_SLOT_COMPONENT_TYPE;
}

export const collectBlogSlotInstanceIds = (doc: Y.Doc): string[] =>
  collectInstanceIds(doc, isBlogSlotYjsEntry);

export function isRenderedMasterRoot(
  scannedKey: string,
  parentKey: string | null,
  masterInstanceIds: ReadonlySet<string>,
): boolean {
  const parsed = parseKey(scannedKey);
  const ownInstance = parsed?.type === 'instance-child' ? parsed.instanceId : scannedKey;
  if (!masterInstanceIds.has(ownInstance)) return false;
  if (!parentKey) return true;
  const parentParsed = parseKey(parentKey);
  const parentInstance =
    parentParsed?.type === 'instance-child' ? parentParsed.instanceId : parentKey;
  return parentInstance !== ownInstance;
}

export function buildMasterEntityKeys(
  masterInstanceIds: Iterable<string>,
  scanned: ReadonlyArray<ParentLookup>,
): Set<string> {
  const out = new Set<string>(masterInstanceIds);
  for (const el of scanned) {
    if (isRenderedMasterRoot(el.key, el.parentKey, out)) out.add(el.key);
  }
  return out;
}

/** True if a scanned element is the topmost node carrying its postSlug. */
export function isPostRootElement(
  el: ParentLookup,
  byKey: ReadonlyMap<string, ParentLookup>,
): boolean {
  if (!el.postSlug) return false;
  const parent = el.parentKey ? byKey.get(el.parentKey) : undefined;
  return !parent || parent.postSlug !== el.postSlug;
}

export function collectPostRootKeys(
  scanned: ReadonlyArray<ParentLookup>,
  byKey: ReadonlyMap<string, ParentLookup>,
): Set<string> {
  const set = new Set<string>();
  for (const el of scanned) {
    if (isPostRootElement(el, byKey)) set.add(el.key);
  }
  return set;
}

/**
 * Walks parentKey from a post root up to the nearest master entity (the
 * containing blog slot). Returns null if no master ancestor is reachable.
 */
export function findContainingSlotKey(
  postRootKey: string,
  byKey: ReadonlyMap<string, ParentLookup>,
  masterEntityKeys: ReadonlySet<string>,
): string | null {
  let cursor = byKey.get(postRootKey)?.parentKey ?? null;
  while (cursor) {
    if (masterEntityKeys.has(cursor)) return cursor;
    cursor = byKey.get(cursor)?.parentKey ?? null;
  }
  return null;
}

/**
 * Component name registered on the slot's `:blogcard` Yjs entry, with the
 * `BlogCard` literal as a fallback. Shared so DesignBar heading and layers
 * label always read from the same source.
 */
export function readBlogCardComponentName(doc: Y.Doc, slotKey: string | null): string {
  if (!slotKey) return BLOG_CARD_COMPONENT_NAME;
  const elements = doc.getMap('elements');
  const card = elements.get(blogCardKey(slotKey)) as Y.Map<unknown> | undefined;
  return (card?.get('componentType') as string | undefined) || BLOG_CARD_COMPONENT_NAME;
}
