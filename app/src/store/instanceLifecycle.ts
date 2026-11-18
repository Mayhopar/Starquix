// src/store/instanceLifecycle.ts
// Instance lifecycle logic extracted from DesignBar (task: AI tool parity).
// Pure functions with injected deps — no React. DesignBar keeps its React
// state (isMakingComponent), toasts, and refreshComponents(); the AI tools
// call these directly.

import * as Y from 'yjs';
import type { EditorCommand } from './types';
import { emptyClassData } from './types';
import { applyCommand } from './commands';
import { OVERRIDE_FIELDS } from './commands';
import { selectPageDrawnElements, selectPageRootElements, applyAllOverrides } from './selectors';
import { baseMarkup, placementKeyOf } from './masters';
import { serializeDrawnTree, generateComponentName } from './serializeDrawnTree';
import { generateId } from '@/utils/generateId';
import { COMPONENT_EDITOR_PAGE_ID } from './constants';
import {
  BLOG_SLOT_DEFAULTS_KEY,
  BLOG_SLOT_COMPONENT_TYPE,
  componentFromPaginationKind,
} from '@/core/collections/types';
import {
  ensureBlogSlotBinding,
  syncPaginationChild,
  resolveBlogSettings,
  blogSlotSettingsDivergence,
} from '@/core/collections/yjsAccessors';
import { isEditedSourceClassEntry, SOURCE_OVERRIDE_MAP_NAMES } from './sourceOverrideEntries';
import { captureWriteBackSourceScan, collectWriteBackPayloads } from '@/utils/pushOverridesToSource';
import { queueSourceWrites } from '@/utils/pendingSourceWrites';
import type { useUndoContext } from '@/context/UndoContext';
import { stripDataKeys, extractClassByTagIndex } from './constants';
import { getOriginalClassesFromMarkup } from '@/utils/markupQuery';
import { sameTokenSet } from '@/core/classes/index';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';
import { acceptDocumentMutation, commitMutationSnapshot, type MutationSnapshot } from './documentMutation';
import { acceptFileChanges, finishAcceptedFiles } from '@/services/durableEdits/fileAcceptance';

function lifecycleSnapshot(takeSnapshot: ReturnType<typeof useUndoContext>['takeSnapshot']): MutationSnapshot {
  let commit: (() => void) | void;
  return { stage: () => { commit = takeSnapshot(undefined, undefined, true); }, commit: () => { commit?.(); } };
}

/**
 * Drop every per-placement override on an instance so it snaps back to its live
 * base (the `masters` overlay). Shared by ↻ (reset) and Push (which bakes the
 * overrides into `masters` first). currentPageId is needed to clear the
 * page-keyed child-order + drawn-child overrides.
 */
function dropInstanceOverrides(
  dispatch: import('./durableDispatch').EditorDispatch,
  instanceId: string,
  currentPageId: string | null,
): void {
  dispatch({ type: 'CLEAR_INSTANCE_OVERRIDES', elementId: instanceId });
  if (currentPageId) {
    dispatch({ type: 'CLEAR_INSTANCE_CHILD_ORDERS', pageId: currentPageId, instanceId });
    dispatch({ type: 'CLEAR_INSTANCE_DRAWN_ELEMENTS', pageId: currentPageId, instanceId });
  }
}

/**
 * A pushed/reset child's master-level divergence is now baked or dropped —
 * clear the parent master's per-placement childOverrides entry (task-098).
 * No-op for plain root instances (no parent / no placement key).
 */
function clearParentChildOverrides(
  doc: Y.Doc,
  dispatch: import('./durableDispatch').EditorDispatch,
  yEl: Y.Map<unknown>,
): void {
  const parentId = yEl.get('parentId') as string | null | undefined;
  if (!parentId) return;
  const parent = doc.getMap('elements').get(parentId) as Y.Map<unknown> | undefined;
  const parentSource = parent?.get('astroSource') as string | undefined;
  const key = placementKeyOf(yEl);
  if (!parentSource || !key) return;
  dispatch({ type: 'SET_MASTER_CHILD_OVERRIDES', astroSource: parentSource, placementKey: key, overrides: null });
}

/** True when the instance carries any override the bake/clear would act on. */
function hasInstanceOverrides(doc: Y.Doc, yEl: Y.Map<unknown>, instanceId: string): boolean {
  for (const f of OVERRIDE_FIELDS) {
    const v = yEl.get(f);
    if (v instanceof Y.Map && v.size > 0) return true;
    if (v instanceof Y.Array && v.length > 0) return true;
  }
  for (const mapName of SOURCE_OVERRIDE_MAP_NAMES) {
    let found = false;
    doc.getMap(mapName).forEach((_v, k) => {
      if (k !== instanceId && !k.startsWith(instanceId + ':')) return;
      // Inert registration entries never justify enabling Push
      // (sourceOverrideEntries.ts contract).
      if (mapName === 'sourceClasses' && !isEditedSourceClassEntry(_v as Y.Map<unknown>, k)) return;
      found = true;
    });
    if (found) return true;
  }
  return false;
}

/**
 * DEEP divergence scan for the DesignBar asterisk — the value-aware sibling
 * of the presence-only `hasInstanceOverrides` above (which gates Push/bake).
 * Differences are deliberate: this one resolves originals via the masters
 * OVERLAY (staticMarkup goes stale after a master edit/push), treats
 * base-only class overrides whose token SET equals the original as no-ops,
 * and skips inert (non-edited) sourceClasses registrations. Pure Y.Doc scan
 * — DesignBar wraps it in a useYjsValue.
 */
export function selectInstanceDivergence(
  doc: Y.Doc,
  instanceId: string,
  currentPageId: string | null,
): boolean {
  return collectInstanceDivergence(doc, instanceId, currentPageId, { firstOnly: true }).length > 0;
}

/**
 * The same scan, reporting WHICH element keys diverged instead of collapsing to
 * a boolean (owner acceptance criterion 2, 2026-08-03).
 *
 * `selectInstanceDivergence` lit the DesignBar `*` for every selection inside a
 * dirty instance, so an untouched sibling claimed an edit it never received and
 * nothing named the element that actually moved. Attributing each finding to a
 * key fixes both ends with ONE state machine — this function is the only body;
 * the boolean above is `length > 0`.
 *
 * Attribution rules (from the write sites in commands.ts):
 *   - `classOverrides` / `markupOverrides` / `linkOverrides` / `overrides` /
 *     `imageOverrides` / `unifiedOverrides` are keyed by CHILD SELECTOR →
 *     `instanceId:selector`.
 *   - `imageAttributes` on the instance element is the ROOT's own attribute map
 *     (UPDATE_IMAGE_ATTRIBUTE, instance-root branch) → `instanceId`.
 *   - `deletedSelectors` / `orderOverrides` / `childOrders` are changes to the
 *     STRUCTURE the instance owns → `instanceId`. (childOrders is already keyed
 *     by a real element key, so it reports that key.)
 *   - `sourceText` / `sourceClasses` are keyed by the element key itself.
 *
 * `firstOnly` preserves the original short-circuit, so the boolean caller never
 * pays for the DOMParser-backed comparisons once something has already been
 * found.
 */
export function collectInstanceDivergence(
  doc: Y.Doc,
  instanceId: string,
  currentPageId: string | null,
  opts: { firstOnly?: boolean } = {},
): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  /** @returns true when the caller should stop scanning. */
  const hit = (key: string): boolean => {
    if (!seen.has(key)) {
      seen.add(key);
      found.push(key);
    }
    return !!opts.firstOnly;
  };

  const yEl = doc.getMap('elements').get(instanceId) as Y.Map<unknown> | undefined;
  if (!yEl) return found;

  const rawMarkup = (yEl.get('staticMarkup') as string) || '';
  if (!rawMarkup) return found;

  // Cheap presence checks first — any hit short-circuits before the
  // DOMParser-backed class comparisons below.
  const deletedSelectors = yEl.get('deletedSelectors') as Y.Array<string> | undefined;
  if (deletedSelectors && deletedSelectors.length > 0 && hit(instanceId)) return found;
  const orderOverrides = yEl.get('orderOverrides') as Y.Array<string> | undefined;
  if (orderOverrides && orderOverrides.length > 0 && hit(instanceId)) return found;
  for (const mapName of ['markupOverrides', 'linkOverrides', 'overrides', 'imageOverrides', 'unifiedOverrides'] as const) {
    const m = yEl.get(mapName) as Y.Map<unknown> | undefined;
    if (!m || m.size === 0) continue;
    for (const selector of m.keys()) {
      if (hit(`${instanceId}:${selector}`)) return found;
    }
  }
  const imageAttributes = yEl.get('imageAttributes') as Y.Map<unknown> | undefined;
  if (imageAttributes && imageAttributes.size > 0 && hit(instanceId)) return found;

  // Child order overrides (stored in pages[pageId].childOrders, keyed by parentKey)
  if (currentPageId) {
    const childOrders = (doc.getMap('pages').get(currentPageId) as Y.Map<unknown> | undefined)
      ?.get('childOrders') as Y.Map<Y.Array<string>> | undefined;
    if (childOrders && childOrders.size > 0) {
      for (const parentKey of childOrders.keys()) {
        if ((parentKey === instanceId || parentKey.startsWith(instanceId + ':')) && hit(parentKey)) return found;
      }
    }
  }

  // Text changes (stored in sourceText map, keyed by instanceId:selector)
  for (const textKey of doc.getMap('sourceText').keys()) {
    if (textKey.startsWith(instanceId + ':') && hit(textKey)) return found;
  }

  // Overlay-resolved base: after a master edit/push, `masters` is the live
  // base and staticMarkup is stale — every original-classes comparison below
  // must use the overlay or it false-positives.
  const resolvedMarkup = baseMarkup(doc, yEl) || rawMarkup;

  // classOverrides: the store is a FULL-REPLACEMENT (setClasses dumps the
  // flat class string into 'base'), so a base-only entry whose token SET
  // equals the original markup classes is a NO-OP override.
  const classOverrides = yEl.get('classOverrides') as Y.Map<Y.Map<Y.Array<string>>> | undefined;
  if (classOverrides) {
    for (const [selector, selectorMap] of classOverrides.entries()) {
      const base = (selectorMap.get('base') as Y.Array<string> | undefined)?.toArray() ?? [];
      let hasOtherBp = false;
      selectorMap.forEach((bpClasses, bp) => {
        if (bp !== 'base' && bpClasses.length > 0) hasOtherBp = true;
      });
      if (hasOtherBp) {
        if (hit(`${instanceId}:${selector}`)) return found;
        continue;
      }
      if (base.length === 0) continue; // empty entry — no-op
      const original = getOriginalClassesFromMarkup(resolvedMarkup, selector) || '';
      if (!sameTokenSet(base, original) && hit(`${instanceId}:${selector}`)) return found;
    }
  }

  // Edited sourceClasses entries: compare against the overlay original.
  // Inert (non-edited) registrations never count (sourceOverrideEntries.ts).
  const sourceClasses = doc.getMap('sourceClasses');
  const prefix = instanceId + ':';
  for (const [classKey, value] of sourceClasses.entries()) {
    if (!classKey.startsWith(prefix)) continue;
    const entry = value as Y.Map<unknown>;
    if (!isEditedSourceClassEntry(entry, classKey)) continue;
    const selector = classKey.slice(prefix.length);
    const currentClasses = (entry.get('classes') as string) || '';
    const tagName = selector.replace(/-\d+$/, '');
    const selectorIndex = parseInt(selector.replace(/^[a-z]+-/, ''), 10);
    const originalClasses = extractClassByTagIndex(resolvedMarkup, tagName, selectorIndex);
    if (originalClasses === null) continue;
    // Token-SET compare — the scanner registers classes in DOM order.
    if (!sameTokenSet(currentClasses.split(/\s+/).filter(Boolean), stripDataKeys(originalClasses))
        && hit(classKey)) return found;
  }

  return found;
}

export interface ResetInstanceArgs {
  doc: Y.Doc;
  dispatch: import('./durableDispatch').EditorDispatch;
  takeSnapshot: ReturnType<typeof useUndoContext>['takeSnapshot'];
  instanceId: string;
  currentPageId: string | null;
  isBlogSlot: boolean;
  /** Built-in component library — used to materialise the pagination child on blog-slot reset. */
  builtIn: ScannedComponent[];
}

// ↻ Reset = drop this placement's overrides so it snaps back to the LIVE master
// base (the `masters` overlay). No source round-trip / no masterVersion: the
// master is already live, so clearing the overrides is the whole job. Blog slots
// additionally reconcile their settings against the master's persisted defaults.
export async function resetInstanceToOriginal(args: ResetInstanceArgs): Promise<{ ok: boolean; reason?: string }> {
  const { instanceId, currentPageId, isBlogSlot, builtIn } = args;
  const paginationId = generateId();
  try { await acceptDocumentMutation(args.doc, doc => {
  const dispatch = (action: EditorCommand) => {
    if (action.type === 'CLEAR_INSTANCE_CHILD_ORDERS') {
      const page = doc.getMap<Y.Map<unknown>>('pages').get(action.pageId);
      if (page && !page.has('childOrders')) return true;
    }
    if (!applyCommand(doc, action)) throw new Error(`Reset action refused: ${action.type}`);
    return true;
  };
  dropInstanceOverrides(dispatch, instanceId, currentPageId);

  // EDITOR-ONLY: ↻ on a nested child also drops the parent master's
  // per-placement entry (full snap-back to the child's own master base). On a
  // CANVAS placement the entry belongs to the parent component's master, not
  // this placement — it must survive a placement-local reset.
  const yEl = doc.getMap('elements').get(instanceId) as Y.Map<unknown> | undefined;
  if (yEl && yEl.get('pageId') === COMPONENT_EDITOR_PAGE_ID) {
    clearParentChildOverrides(doc, dispatch, yEl);
  }

  // task-102 ONE LOGIC reset (master wins): DELETE the instance's sparse
  // settings overrides — absence = live inheritance, so the instance runs
  // exactly what resolveBlogSettings yields and * / ↻ clear IMMEDIATELY
  // (existence-based; no value copying that used to leave the asterisk).
  // The pagination child then converges to the resolved setting.
  if (isBlogSlot) {
    dispatch({ type: 'UPDATE_BLOG_SLOT_SETTINGS', slotKey: instanceId, settings: null });
    const resolvedPagination = resolveBlogSettings(doc, instanceId).pagination;
    syncPaginationChild(doc, dispatch, instanceId, componentFromPaginationKind(resolvedPagination), builtIn, { generatedId: paginationId });
  }
  }, lifecycleSnapshot(args.takeSnapshot)); }
  catch (error) { return { ok: false, reason: error instanceof Error ? error.message : String(error) }; }
  return { ok: true };
}

export interface PushInstanceArgs {
  doc: Y.Doc;
  dispatch: import('./durableDispatch').EditorDispatch;
  takeSnapshot: ReturnType<typeof useUndoContext>['takeSnapshot'];
  instanceId: string;
  astroSource: string;
  /** Page the instance lives on — clears page-keyed child/drawn overrides on bake. */
  currentPageId: string | null;
}

/**
 * Push an instance's local overrides into the `masters` overlay, then clear the
 * instance override so every placement of `astroSource` inherits the change. The
 * source intent is accepted with that bake and materialized after the idle
 * boundary. Mirrors `bakeEditorMaster`: the master markup IS exactly what
 * this placement currently renders (`applyAllOverrides(baseMarkup, instance)`).
 * No gate: the Push acts at once and ⌘Z takes it back (owner 2026-11-10).
 */
export async function pushInstanceToSource(args: PushInstanceArgs): Promise<{ ok: boolean; reason?: string }> {
  const { doc, takeSnapshot, instanceId, astroSource, currentPageId } = args;
  const projectId = doc.getMap('meta').get('projectId') as string | undefined;
  if (!projectId) return { ok: false, reason: 'Project storage is not ready' };
  const sourceOwnership = captureWriteBackSourceScan(doc);
  let commitSnapshot: () => void = () => {};
  try { await queueSourceWrites([], [], { doc, stage: staged => {
    // The acceptance lane owns check, collection and bake together. A second
    // Push sees the first accepted clear, so it cannot accept the deletion twice.
    const yEl = staged.getMap('elements').get(instanceId) as Y.Map<unknown> | undefined;
    if (!yEl) throw new Error(`Instance "${instanceId}" not found`);
    const isBlogSlot = yEl.get('componentType') === BLOG_SLOT_COMPONENT_TYPE;
    const settingsPatch = isBlogSlot ? blogSlotSettingsDivergence(staged, instanceId) : null;
    const hasMarkupOverrides = hasInstanceOverrides(staged, yEl, instanceId);
    if (!hasMarkupOverrides && !settingsPatch) throw new Error('No local overrides to push');
    const markup = hasMarkupOverrides ? applyAllOverrides(baseMarkup(staged, yEl), yEl) : null;
    // Page-drawn boxes must not leak into the master source.
    const collected = hasMarkupOverrides ? collectWriteBackPayloads(staged, instanceId, { skipDrawn: true, sourceOwnership }) : null;
    commitSnapshot = takeSnapshot(undefined, undefined, true) || (() => {});
    const dispatch = (command: EditorCommand) => applyCommand(staged, command);
    if (settingsPatch) ensureBlogSlotBinding(staged, BLOG_SLOT_DEFAULTS_KEY);
    if (markup !== null) {
      dispatch({ type: 'SET_MASTER_MARKUP', astroSource, markup });
      dropInstanceOverrides(dispatch, instanceId, currentPageId);
      const stagedElement = staged.getMap('elements').get(instanceId) as Y.Map<unknown>;
      clearParentChildOverrides(staged, dispatch, stagedElement);
    }
    if (settingsPatch) {
      // task-102: write the RESOLVED synced settings to the defaults key
      // (bumps settingsRev), then CLEAR the instance's sparse overrides —
      // it now inherits what it pushed, so * and ↻ are gone; a conflicting
      // sibling sees the rev move and shows ↻.
      dispatch({ type: 'UPDATE_BLOG_SLOT_SETTINGS', slotKey: BLOG_SLOT_DEFAULTS_KEY, settings: settingsPatch });
      dispatch({ type: 'UPDATE_BLOG_SLOT_SETTINGS', slotKey: instanceId, settings: null });
    }
    return collected ?? { payloads: [], skipped: [] };
  } }); }
  catch (error) { return { ok: false, reason: error instanceof Error ? error.message : String(error) }; }

  commitMutationSnapshot({ stage: () => {}, commit: commitSnapshot });
  return { ok: true };
}

export interface MakeComponentArgs {
  doc: Y.Doc;
  currentPageId: string;
  /** Drawn root key to convert into a component */
  key: string;
  /** Existing component names (for unique name generation) */
  existingNames: string[];
  takeSnapshot: ReturnType<typeof useUndoContext>['takeSnapshot'];
}

export async function makeComponentFromDrawn(
  args: MakeComponentArgs,
): Promise<{ ok: boolean; componentName?: string; instanceId?: string; reason?: string }> {
  const { doc, currentPageId, key, existingNames, takeSnapshot } = args;

  try {
    const drawnElements = selectPageDrawnElements(doc, currentPageId);
    const astroContent = serializeDrawnTree(drawnElements, key);
    if (!astroContent) throw new Error('Could not serialize element');

    const tagName = drawnElements.find(e => e.key === key)?.tag || 'div';
    const componentName = generateComponentName(tagName, existingNames);

    const componentPath = `${componentName}.astro`;
    const staticMarkup = astroContent;

    const rootDrawn = drawnElements.find(e => e.key === key);
    const parentKey = rootDrawn?.parentKey || null;
    const rootEl = doc.getMap('elements').get(key) as Y.Map<unknown> | undefined;
    const insertIndex = rootEl ? (rootEl.get('index') as number) || 0 : 0;

    const subtreeKeys = drawnElements
      .filter(e => {
        if (e.key === key) return true;
        let current: string | null = e.parentKey;
        while (current) {
          if (current === key) return true;
          current = drawnElements.find(d => d.key === current)?.parentKey || null;
        }
        return false;
      })
      .map(e => e.key);

    const instanceId = `el-${crypto.randomUUID().slice(0, 8)}`;

    // Single transaction: remove drawn subtree + add instance + select
    // This produces one Yjs change event → one RENDER cycle → no visual flash
    const accepted = await acceptFileChanges(`wc://${doc.getMap('meta').get('projectId')}`, [{
      file: `src/components/library/${componentPath}`, beforeSource: null, afterSource: astroContent,
    }], doc, staged => {
      if (serializeDrawnTree(selectPageDrawnElements(staged, currentPageId), key) !== astroContent) throw new Error('Drawn component changed before acceptance');
      for (const childKey of subtreeKeys.reverse()) {
        if (!applyCommand(staged, { type: 'REMOVE_DRAWN_ELEMENT', elementKey: childKey })) throw new Error('Drawn replacement refused');
      }

      if (!applyCommand(staged, {
        type: 'ADD_THEME_INSTANCE',
        element: {
          id: instanceId,
          pageId: currentPageId,
          parentId: parentKey,
          index: insertIndex,
          type: 'instance',
          instanceType: 'theme',
          themeId: componentName,
          componentPath,
          staticMarkup,
          classes: emptyClassData(),
        },
      })) throw new Error('Component insertion refused');
    }, lifecycleSnapshot(takeSnapshot));
    void finishAcceptedFiles(accepted);

    return { ok: true, componentName, instanceId };
  } catch (err) {
    console.error('[MakeComponent]', err);
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export interface CreateComponentArgs {
  doc: Y.Doc;
  currentPageId: string;
  name: string;
  staticMarkup: string;
  existingNames: string[];
  replaceElementId?: string;
  /** task-122: Assets folder (single word — @category tag / library subdir) */
  category?: string;
  takeSnapshot: ReturnType<typeof useUndoContext>['takeSnapshot'];
}

/** task-122: Assets folders = @category tags; the endpoint regex only matches \w+ */
export function isValidCategory(category: string): boolean {
  return /^\w+$/.test(category);
}

/**
 * task-121: create a library component from raw HTML markup (AI path).
 * Save-first / doc-second ordering matches makeComponentFromDrawn — a failed
 * save must leave the doc untouched.
 */
export async function createComponentFromMarkup(
  args: CreateComponentArgs,
): Promise<{ ok: boolean; componentName?: string; instanceId?: string; reason?: string }> {
  const { doc, currentPageId, name, staticMarkup, existingNames, replaceElementId, category, takeSnapshot } = args;
  try {
    const cleaned = staticMarkup.replace(/\s+(?:data-key|data-sq-id)="[^"]*"/g, '').trim();
    if (!cleaned.startsWith('<')) throw new Error('staticMarkup must contain one root HTML element');
    if (category && !isValidCategory(category)) {
      throw new Error(`Category "${category}" must be a single word (letters/digits/underscore), e.g. "Marketing"`);
    }

    // PascalCase + dedupe. generateComponentName uppercases the first char.
    const base = name.replace(/[^a-zA-Z0-9]+(\w)/g, (_, c: string) => c.toUpperCase()).replace(/[^a-zA-Z0-9]/g, '') || 'Component';
    const componentName = generateComponentName(base, existingNames);

    // Resolve placement BEFORE the save so a bad replace target costs no write.
    let parentId: string | null = null;
    let insertIndex: number;
    if (replaceElementId) {
      const yEl = doc.getMap('elements').get(replaceElementId) as Y.Map<unknown> | undefined;
      if (!yEl) throw new Error(`Element "${replaceElementId}" not found — use read_page_content to list elements`);
      if (yEl.get('instanceType') || replaceElementId.startsWith('layoutchrome-')) {
        throw new Error('Cannot convert a component instance or layout chrome — pass a plain element id');
      }
      parentId = (yEl.get('parentId') as string | null) ?? null;
      insertIndex = (yEl.get('index') as number) ?? 0;
    } else {
      insertIndex = selectPageRootElements(doc, currentPageId).length;
    }

    const componentPath = `${category ? category.toLowerCase() + '/' : ''}${componentName}.astro`;
    const instanceId = `el-${crypto.randomUUID().slice(0, 8)}`;
    const accepted = await acceptFileChanges(`wc://${doc.getMap('meta').get('projectId')}`, [{
      file: `src/components/library/${componentPath}`, beforeSource: null, afterSource: cleaned,
    }], doc, staged => {
      if (!staged.getMap('pages').has(currentPageId)) throw new Error('Component page no longer exists');
      if (replaceElementId && !applyCommand(staged, { type: 'REMOVE_ELEMENT', elementId: replaceElementId })) throw new Error('Component replacement refused');
      if (!applyCommand(staged, {
        type: 'ADD_THEME_INSTANCE',
        element: {
          id: instanceId, pageId: currentPageId, parentId, index: insertIndex,
          type: 'instance', instanceType: 'theme', themeId: componentName,
          componentPath, staticMarkup: cleaned, classes: emptyClassData(),
        },
      })) throw new Error('Component insertion refused');
    }, lifecycleSnapshot(takeSnapshot));
    void finishAcceptedFiles(accepted);

    return { ok: true, componentName, instanceId };
  } catch (err) {
    console.error('[CreateComponent]', err);
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
