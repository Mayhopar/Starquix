import * as Y from 'yjs';
import type { BlogSlotSettings } from './types';
import type { EditorCommand } from '@/store/types';
import { emptyClassData } from '@/store/types';
import { generateId } from '@/utils/generateId';
import {
  DEFAULT_BLOG_SETTINGS,
  UNBOUND_COLLECTION_ID,
  BLOG_SLOT_DEFAULTS_KEY,
  paginationKindFromComponent,
} from './types';
import type { BlogSlotBinding } from '@/store/collectionSelectors';
import { selectResolvedStaticMarkup } from '@/store/selectors';
import {
  BlogSlotBindingSchema,
  BlogSlotSettingsSchema,
  ySlotToPlain,
  reportShapeDrift,
} from './schemas';

/**
 * Single entry point for reading the blog Yjs shape. Every access goes through
 * a typed, fallback-aware accessor here — so if the underlying shape drifts
 * (e.g. `postsPerPage` stored as a string), we catch and fix it in one place
 * instead of in every call site.
 *
 * Intended call sites: export/blog/*, useCollectionsPersistence. Do NOT bypass these with inline `.get('settings')`
 * reads in new code.
 */

export type { BlogSlotBinding };

/**
 * Read a blog-slot binding (collectionId + settings + per-element bindings).
 * Returns null if the slot isn't bound to any collection.
 *
 * Parses through Zod: in dev a shape drift (e.g. postsPerPage stored as a
 * string) is reported and produces null. In prod the same drift falls
 * through to null; every consumer already handles the null case.
 */
export function readBlogSlotBinding(doc: Y.Doc, slotKey: string): BlogSlotBinding | null {
  const ySlot = doc.getMap('blogSlotBindings').get(slotKey);
  if (!ySlot) return null;

  const plain = ySlotToPlain(ySlot);
  const result = BlogSlotBindingSchema.safeParse(plain);
  if (!result.success) {
    reportShapeDrift(`readBlogSlotBinding(${slotKey})`, result.error);
    return null;
  }
  return result.data as BlogSlotBinding;
}

/**
 * All blog-slot bindings in the doc, keyed by slotKey. Drops any slot
 * whose shape fails Zod validation (drift is reported, not propagated).
 */
export function readAllBlogSlotBindings(doc: Y.Doc): Record<string, BlogSlotBinding> {
  const result: Record<string, BlogSlotBinding> = {};
  doc.getMap('blogSlotBindings').forEach((_, key) => {
    const binding = readBlogSlotBinding(doc, key);
    if (binding) result[key] = binding;
  });
  return result;
}

/**
 * Read the full override-applied static markup for an element. Returns null
 * if the element doesn't exist or has no markup.
 */
export function readResolvedStaticMarkup(doc: Y.Doc, elementId: string): string | null {
  return selectResolvedStaticMarkup(doc, elementId);
}

/**
 * Read a drawn element's Tailwind classes out of the `sourceClasses` map.
 * Drawn elements (and their children) don't store classes on the element
 * itself — they live keyed by element id (or `${parentId}:${childKey}`) in
 * the top-level sourceClasses map. Returns '' if no entry exists.
 */
export function readDrawnElementClasses(doc: Y.Doc, elementId: string): string {
  const sourceClasses = doc.getMap('sourceClasses');
  const entry = sourceClasses.get(elementId) as Y.Map<unknown> | undefined;
  return (entry?.get('classes') as string) || '';
}

/**
 * Coerce a raw blogSlotBinding Y.Map's `settings` child into a typed
 * BlogSlotSettings with defaults filled in. Use when you already hold the
 * Y.Map (e.g. inside a mutation or a patch-defaults routine) and don't want
 * the full doc lookup of readBlogSlotBinding.
 *
 * Parses through Zod. If the settings shape is malformed, reports drift
 * and returns DEFAULT_BLOG_SETTINGS so the caller still gets a usable value.
 */
export function readBlogSettingsFromYSlot(ySlot: Y.Map<unknown>): BlogSlotSettings {
  const ySettings = ySlot.get('settings');
  const plain: Record<string, unknown> = {};
  if (ySettings && typeof (ySettings as { forEach?: unknown }).forEach === 'function') {
    (ySettings as { forEach: (fn: (v: unknown, k: string) => void) => void }).forEach((v, k) => {
      plain[k] = v;
    });
  }
  const result = BlogSlotSettingsSchema.safeParse(plain);
  if (!result.success) {
    reportShapeDrift('readBlogSettingsFromYSlot', result.error);
    return { ...DEFAULT_BLOG_SETTINGS };
  }
  return result.data as BlogSlotSettings;
}

/**
 * Read the explicitly-set settings fields on a slot binding, with NO Zod
 * defaulting. Returns an empty object if the binding (or its settings
 * sub-map) doesn't exist. Used for drift detection where "field was set
 * to default-equal value" must be distinguishable from "field missing".
 */
export function readBlogSettingsRaw(doc: Y.Doc, slotKey: string): Record<string, unknown> {
  const ySlot = doc.getMap('blogSlotBindings').get(slotKey) as Y.Map<unknown> | undefined;
  const ySettings = ySlot?.get('settings') as Y.Map<unknown> | undefined;
  if (!ySettings) return {};
  const out: Record<string, unknown> = {};
  ySettings.forEach((v, k) => { out[k] = v; });
  return out;
}

/** ONE LOGIC resolver: instance sparse override → master defaults → app default, per field.
 *  Sparse truth = readBlogSettingsRaw (the Zod parse in readBlogSlotBinding FILLS defaults — never use it here). */
export function resolveBlogSettings(doc: Y.Doc, instanceId: string): BlogSlotSettings {
  const master = readBlogSettingsRaw(doc, BLOG_SLOT_DEFAULTS_KEY);
  const own = instanceId === BLOG_SLOT_DEFAULTS_KEY ? {} : readBlogSettingsRaw(doc, instanceId);
  const out = { ...DEFAULT_BLOG_SETTINGS } as BlogSlotSettings & Record<string, unknown>;
  for (const k of Object.keys(DEFAULT_BLOG_SETTINGS)) {
    if (master[k] !== undefined) out[k] = master[k];
    if (own[k] !== undefined) out[k] = own[k];
  }
  return out;
}

/** Master settings revision — bumped by every UPDATE_BLOG_SLOT_SETTINGS on the defaults key. 0 = never touched. */
export function readMasterSettingsRev(doc: Y.Doc): number {
  const ySlot = doc.getMap('blogSlotBindings').get(BLOG_SLOT_DEFAULTS_KEY) as Y.Map<unknown> | undefined;
  return (ySlot?.get('settingsRev') as number) ?? 0;
}

/** Master rev the instance's last local settings edit was based on. 0 = never stamped. */
export function readInstanceSettingsBaseRev(doc: Y.Doc, instanceId: string): number {
  const ySlot = doc.getMap('blogSlotBindings').get(instanceId) as Y.Map<unknown> | undefined;
  return (ySlot?.get('settingsBaseRev') as number) ?? 0;
}

/**
 * Scaffold an empty blog-slot binding if one doesn't already exist. Mirrors
 * the lazy-init shape created by BlogSettingsBlock + SET_BLOG_SLOT_COLLECTION
 * — wrapped here so callers (e.g. master→instance reload reconciliation) don't
 * duplicate the Y.Map construction or bypass the boundary.
 *
 * Idempotent. Uses 'sync' origin so the structural init doesn't show up in
 * undo history.
 */
export function ensureBlogSlotBinding(doc: Y.Doc, slotKey: string): void {
  const blogBindings = doc.getMap('blogSlotBindings');
  if (blogBindings.has(slotKey)) return;
  doc.transact(() => {
    getOrCreateSlotScaffold(blogBindings, slotKey);
  }, 'sync');
}

/**
 * THE canonical binding scaffold — get-or-create the slot entry and fill any
 * missing sub-maps. Non-transacting: command handlers run inside applyCommand's
 * transaction; ensureBlogSlotBinding wraps it in a 'sync' transact for React
 * callers. Every scaffold construction goes through here (3 sites used to
 * hand-assemble the shape).
 */
export function getOrCreateSlotScaffold(blogBindings: Y.Map<unknown>, slotKey: string): Y.Map<unknown> {
  let ySlot = blogBindings.get(slotKey) as Y.Map<unknown> | undefined;
  if (!ySlot) {
    ySlot = new Y.Map<unknown>();
    ySlot.set('collectionId', UNBOUND_COLLECTION_ID);
    blogBindings.set(slotKey, ySlot);
  }
  if (!ySlot.get('settings')) ySlot.set('settings', new Y.Map());
  if (!ySlot.get('bindings')) ySlot.set('bindings', new Y.Map());
  return ySlot;
}

/**
 * Build the canonical Y.Map shape for a blog-slot binding from plain data —
 * the write-side counterpart of `ySlotToPlain`. Snapshot restore and any
 * future plain→Yjs path must use this instead of hand-assembling the shape.
 */
export function plainSlotToYMap(b: {
  collectionId: string;
  settings: Record<string, unknown>;
  bindings: Record<string, string>;
  settingsRev?: number;
  settingsBaseRev?: number;
}): Y.Map<unknown> {
  const ySlot = new Y.Map<unknown>();
  ySlot.set('collectionId', b.collectionId);
  const ySettings = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(b.settings)) ySettings.set(k, v);
  ySlot.set('settings', ySettings);
  const yBindings = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(b.bindings)) yBindings.set(k, v);
  ySlot.set('bindings', yBindings);
  if (typeof b.settingsRev === 'number') ySlot.set('settingsRev', b.settingsRev);
  if (typeof b.settingsBaseRev === 'number') ySlot.set('settingsBaseRev', b.settingsBaseRev);
  return ySlot;
}

/**
 * Locate a named child element (by slotName) parented to the given BlogSlot
 * instance. Returns `null` when there is no such child.
 * Centralised so every drift / sync / reset / template path uses the same
 * key shape.
 */
export function findBlogSlotChild(
  doc: Y.Doc,
  parentId: string,
  slotName: string,
): { id: string; componentType: string; el: Y.Map<unknown> } | null {
  const elements = doc.getMap('elements') as Y.Map<Y.Map<unknown>>;
  let result: { id: string; componentType: string; el: Y.Map<unknown> } | null = null;
  elements.forEach((el, id) => {
    if (result) return;
    if (el.get('parentId') === parentId && el.get('slotName') === slotName) {
      result = { id, componentType: (el.get('componentType') as string) || '', el };
    }
  });
  return result;
}

/**
 * Locate the pagination child element (slotName='pagination') parented to
 * the given BlogSlot instance. Returns `null` when there is no such child.
 */
export function findBlogSlotPaginationChild(
  doc: Y.Doc,
  parentId: string,
): { id: string; componentType: string } | null {
  return findBlogSlotChild(doc, parentId, 'pagination');
}


/**
 * THE pagination-child sync: converge the slot's pagination child to the
 * desired component (null = none). One implementation for all three flows —
 * user settings change (BlogSettingsBlock), instance ↻ reset
 * (instanceLifecycle), and the load-time migration (useBlogSlotMigration) —
 * which had drifted into three copies of the remove/add dance.
 * No-ops when the existing child already matches. `addWhenAbsent: false`
 * restricts to remove/swap (the migration's ADD path owns creation there).
 */
export function syncPaginationChild(
  doc: Y.Doc,
  dispatch: (cmd: EditorCommand) => unknown,
  parentId: string,
  desired: string | null,
  library: Array<{ name: string; path?: string; html: string }>,
  opts: { addWhenAbsent?: boolean; generatedId?: string } = {},
): void {
  const existing = findBlogSlotChild(doc, parentId, 'pagination');
  if (existing && existing.componentType === desired) return;
  if (!existing && opts.addWhenAbsent === false) return;
  // Read pageId BEFORE any remove — a detached Y.Map reads undefined.
  const pageId =
    (existing?.el.get('pageId') as string | undefined) ??
    ((doc.getMap('elements').get(parentId) as Y.Map<unknown> | undefined)?.get('pageId') as string | undefined);
  if (existing) dispatch({ type: 'REMOVE_ELEMENT', elementId: existing.id });
  if (!desired) return;
  const component = library.find((c) => c.name === desired);
  if (!component || !pageId) return;
  dispatch({
    type: 'ADD_ELEMENT',
    element: {
      id: opts.generatedId ?? generateId(),
      pageId,
      parentId,
      index: 0,
      type: 'component',
      instanceType: 'local',
      componentType: desired,
      slotName: 'pagination',
      classes: emptyClassData(),
      staticMarkup: component.html,
      astroSource: component.path || '',
      classOverrides: {},
    },
  });
}

/** The four master-synced settings fields (layout/columns/gap stay per-instance). */
export const SYNCED_SETTINGS_FIELDS = ['pagination', 'postsPerPage', 'sortBy', 'postLinkMode'] as const;

export type SyncedBlogSettings = Pick<BlogSlotSettings, (typeof SYNCED_SETTINGS_FIELDS)[number]>;

/** Any sparse override on a synced field? (layout/columns/gap never sync, never light *) */
function hasSyncedOverride(own: Record<string, unknown>): boolean {
  return SYNCED_SETTINGS_FIELDS.some((f) => own[f] !== undefined);
}

/**
 * task-102 ONE LOGIC — * = a sparse override EXISTS (rule 2), never value
 * comparison: absence of an override means live inheritance, so an untouched
 * instance can never diverge, and an override equal to the master's value
 * still counts (the user chose it). Returns the instance's RESOLVED synced
 * settings (what push writes to the master) or null when no override exists.
 */
export function blogSlotSettingsDivergence(
  doc: Y.Doc,
  instanceId: string,
): SyncedBlogSettings | null {
  const own = readBlogSettingsRaw(doc, instanceId);
  if (!hasSyncedOverride(own)) return null;
  const resolved = resolveBlogSettings(doc, instanceId);
  // resolveBlogSettings seeds every field from DEFAULT_BLOG_SETTINGS —
  // no post-resolve field can be undefined.
  return {
    pagination: resolved.pagination,
    postsPerPage: resolved.postsPerPage,
    sortBy: resolved.sortBy,
    postLinkMode: resolved.postLinkMode,
  };
}

/**
 * task-102 ONE LOGIC — ↻ (rule 3, outranks *): overrides exist AND the master
 * rev moved past my last edit's baseRev AND a field I overrode actually
 * differs from the master's defined value. A master bump on a field the
 * instance never touched flows live (rule 1) and must not nag.
 */
export function blogSlotSettingsOutdated(doc: Y.Doc, instanceId: string): boolean {
  const own = readBlogSettingsRaw(doc, instanceId);
  if (!hasSyncedOverride(own)) return false;
  if (readMasterSettingsRev(doc) <= readInstanceSettingsBaseRev(doc, instanceId)) return false;
  const master = readBlogSettingsRaw(doc, BLOG_SLOT_DEFAULTS_KEY);
  return SYNCED_SETTINGS_FIELDS.some(
    (f) => own[f] !== undefined && master[f] !== undefined && own[f] !== master[f],
  );
}
