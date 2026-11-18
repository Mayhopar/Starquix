// src/store/types.ts

import type { GridCellInfo, ElementRect, SourceLocation } from '@/bridge';
import type { VariableCollection, VariableMode, DesignVariable, VariableValue } from '@/core/variables/types';
import type { ContentCollection, CollectionField, BlogSlotSettings } from '@/core/collections/types';
import type { ProjectFontEntry } from './fontCommands';

export type Breakpoint = 'base' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

export const BREAKPOINTS: Record<Breakpoint, number> = {
  base: 375,
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
};

export const BREAKPOINT_ORDER: Breakpoint[] = [
  'base',
  'sm',
  'md',
  'lg',
  'xl',
  '2xl',
];

export interface ClassData {
  base: string[];
  sm: string[];
  md: string[];
  lg: string[];
  xl: string[];
  '2xl': string[];
}

/** Fresh empty ClassData. Returns a new object each call so callers
 *  can mutate without touching others'. */
export function emptyClassData(): ClassData {
  return { base: [], sm: [], md: [], lg: [], xl: [], '2xl': [] };
}

export type ElementType = 'component' | 'slot' | 'frame' | 'text' | 'image' | 'svg' | 'instance' | 'link';

type InstanceType = 'local' | 'theme';

export type LinkAttributes = {
  href: string;
  target?: '_blank' | '_self' | '_parent' | '_top';
  rel?: string;  // Space-separated: nofollow, noopener, noreferrer, etc.
  title?: string;
  ariaLabel?: string;
};

export type ImageAttributes = {
  src: string;
  alt?: string;
  loading?: 'lazy' | 'eager';
  /** Video-only boolean attrs, stored as 'true'/'false' strings — always truthy
   *  so UPDATE_IMAGE_ATTRIBUTE's delete-when-empty never fires; 'false' means
   *  "strip the attribute from markup" (staticMarkup may bake it in). */
  autoplay?: 'true' | 'false';
  loop?: 'true' | 'false';
  muted?: 'true' | 'false';
  controls?: 'true' | 'false';
};

export interface ElementData {
  id: string;
  pageId: string;
  parentId: string | null;
  index: number;
  type: ElementType;
  componentType?: string;
  slotName?: string;
  /** Nested-component placement key on a child instance (task-098): slot name
   *  for slot-fallback children, `name-N` for non-slot placements. Joins the
   *  parent master's childOverrides + <sq-child data-sq-placement> splice. */
  placementKey?: string;
  classes: ClassData;
  textContent?: string;
  text?: string;  // For text elements
  tag?: 'h1' | 'h2' | 'h3' | 'p' | 'span';  // For text elements
  attributes?: Record<string, string>;
  /** Raw HTML markup for section templates - IMMUTABLE after creation */
  staticMarkup?: string;

  // Instance discriminator - determines source and edit behavior
  instanceType?: InstanceType;

  // For local instances (instanceType === 'local')
  templateId?: string;
  overrides?: Record<string, Partial<ElementData>>;

  // For template children
  isTemplateChild?: boolean;

  // For theme instances (instanceType === 'theme')
  themeId?: string;
  componentPath?: string;  // Path to component in theme, e.g., "src/components/Card.astro"

  /** Class overrides for instance elements, keyed by selector (e.g., "h1-0", "p-0") */
  classOverrides?: Record<string, ClassData>;
  /** Text overrides for instance elements, keyed by selector (e.g., "h1-0", "p-0") */
  textOverrides?: Record<string, string>;
  /** Markup overrides for instance elements (when adding/editing links), keyed by selector */
  markupOverrides?: Record<string, string>;
  /** Href overrides for standalone <a> elements, keyed by selector */
  hrefOverrides?: Record<string, { href: string; target?: '_blank' | '_self' }>;
  /** Link counters for generating unique link keys, keyed by selector (e.g., "p-0" -> 3 means next link is a-3) */
  linkCounters?: Record<string, number>;

  // Link element specific attributes
  linkAttributes?: LinkAttributes;
  /** True if this element was converted to a link (wraps existing content) */
  isWrapperLink?: boolean;
  /** Original element type before conversion to link, for unwrapping */
  originalType?: ElementType;
  /** Link overrides for instance children, keyed by selector */
  linkOverrides?: Record<string, LinkAttributes>;

  /** Image element specific attributes */
  imageAttributes?: ImageAttributes;
  /** Image attribute overrides for instance children */
  imageOverrides?: Record<string, ImageAttributes>;

  /** Selectors of child elements that are hidden (deletion override) */
  deletedSelectors?: string[];

  /** Custom render order of child selectors (reorder override) */
  orderOverrides?: string[];

  /** Pending cross-parent source moves (task-078): "childSelector>parentSelector"
   *  entries (empty parent = move to the file top level). Consumed by the
   *  component editor's write-back (pushOverridesToSource → reparentOverrides). */
  reparentOverrides?: string[];

  /** Relative path to the .astro source file (e.g., "library/Hero.astro") */
  astroSource?: string;

  /** True if this element was drawn on canvas (not from source) */
  isDrawn?: boolean;

  /** Slot type for drawn slot elements: 'slot' = generic placeholder, 'blog' = BlogSlot */
  slotType?: 'slot' | 'blog';

  /** Filled-slot metadata: set by fillDrawnSlot, cleared by CLEAR_DRAWN_SLOT_FILL */
  slotComponentId?: string;
  slotComponentName?: string;
  slotComponentMarkup?: string;
  slotComponentPath?: string;

  /**
   * Marks this element as a binding to collection content (the post body).
   * Codegen emits a bare <Content /> tag when set; the layers tree shows
   * a "bound to collection" icon. Only meaningful on blog post pages.
   *
   * 'layout-chrome' marks the derived, editor-only element that carries the
   * applied layout's chrome markup + overrides so a page's layout reuses the
   * component-instance lifecycle. It is NEVER in rootElementIds and is never
   * seen by codegen (which reads page.layoutName/layoutProps). See layoutElement.ts.
   */
  bindingType?: 'collection-content' | 'layout-chrome';

  /**
   * Registry-only: auto-created children when this element is added via
   * ADD_ELEMENT. Each entry is materialised as a real Yjs element with
   * `parentId` set to the new element and `slotName` carried through.
   * NOT persisted onto the Y.Map — stripped at write time.
   */
  defaultChildren?: ReadonlyArray<Partial<ElementData> & { componentType: string }>;
}

export const SLOT_FILL_FIELDS = [
  'slotComponentId',
  'slotComponentName',
  'slotComponentMarkup',
  'slotComponentPath',
] as const satisfies readonly (keyof ElementData)[];

/**
 * Optional scalar element fields round-tripped by undo snapshots with
 * delete-when-absent semantics: undoing the action that SET the field must
 * REMOVE it (e.g. undoing a link conversion clears isWrapperLink).
 * UndoContext capture/restore iterates this list — add new optional scalar
 * fields HERE, not as one-off lines in UndoContext.
 */
export const ELEMENT_OPTIONAL_SNAPSHOT_FIELDS = [
  'isWrapperLink',
  'originalType',
  'bindingType',
] as const satisfies readonly (keyof ElementData)[];

/** Data for elements drawn on the canvas (not from source files) */
interface DrawnElementData {
  key: string;
  tag: string;
  classes: string;
  textContent: string;
  parentKey: string | null;
  insertIndex: number;
  pageId: string;
  /** Slot type: 'slot' for generic slot, 'blog' for blog slot */
  slotType?: 'slot' | 'blog';
  /** Blog slot: initial classes for the `:posts` wrapper child, sourced from BlogSlot.astro. */
  postsClasses?: string;
  /** Blog slot: raw BlogSlot.astro HTML at drop time. Vector shapes: inline SVG markup. */
  staticMarkup?: string;
  /** Pen tool: PenPath JSON string (anchors + closed). Editor-only; staticMarkup is derived from it. */
  penPath?: string;
  /** Relative path to the .astro source file (for push-to-master parity with components). */
  astroSource?: string;
}

export interface PageData {
  id: string;
  name: string;
  rootElementIds: string[];
  children: string[];  // Child page IDs for hierarchy
  seo?: Record<string, unknown>; // SEO metadata, stored as plain object
  childOrders?: Record<string, string[]>;  // Sub-element ordering keyed by parent key
  /** 'post' marks this as a blog post template page */
  pageType?: 'post';
  /** Content collection ID this post page is linked to */
  collectionId?: string;
  /** Route prefix for post URLs, e.g. '/blog' */
  routePrefix?: string;
  /** Exactly one page per project: exports as index.astro (root route). */
  isHome?: boolean;
  /** Page-level layout association. null/absent = no layout. One layout per page; nesting forbidden. */
  layoutName?: string | null;
  /** Values for the layout's declared props → emitted as <Layout title="…">. */
  layoutProps?: Record<string, string>;
}

/**
 * Strict structural check on PageData. For the broader signal-based check
 * (postPageBindings entry, legacy name fallback) use `selectIsPostPage`.
 */
export function isPostPageData(
  page: PageData | null | undefined,
): page is PageData & { pageType: 'post' } {
  return page?.pageType === 'post';
}

export type { SourceLocation };

export interface GridGeometry {
  containerRect: ElementRect;
  columns: number[];
  rows: number[];
  columnGap: number;
  rowGap: number;
  cells: GridCellInfo[];
  /** Number of rows from explicit grid-template-rows (before implicit row detection). */
  explicitRowCount: number;
}

// Command types for mutations
export type EditorCommand =
  | { type: 'SET_CURRENT_PAGE'; pageId: string }
  | { type: 'SET_BREAKPOINT'; breakpoint: Breakpoint }
  | { type: 'SET_THEME_MODE'; mode: string | null }
  | { type: 'ADD_PAGE'; page: PageData }
  | { type: 'DELETE_PAGE'; pageId: string }
  | { type: 'RENAME_PAGE'; pageId: string; name: string }
  | { type: 'SET_HOME_PAGE'; pageId: string }
  | { type: 'MOVE_PAGE'; pageId: string; newParentId: string | null; index: number }
  | { type: 'ADD_ELEMENT'; element: ElementData }
  | {
      type: 'PASTE_ELEMENTS';
      pageId: string;
      /** Insert position in rootElementIds for the first pasted root (⌘K rootInsertIndex policy). */
      index: number;
      /** Only astroSources ABSENT from the target masters map — service guarantees this
       *  (SET_MASTER_MARKUP on an existing key remaps every instance sharing it). */
      masters: Array<{ astroSource: string; markup: string }>;
      /** Flat, parents-first. parentId===null ⇒ page root (inserted at index++). */
      elements: Array<{
        element: ElementData;
        extraFields?: Record<string, unknown>;     // isDrawn, tag, penPath, slotType, …
        classOverrides?: Record<string, unknown>;
        unifiedOverrides?: Record<string, unknown>;
        blogSlot?: { collectionId: string; settings: Record<string, unknown>; bindings: Record<string, string> } | null;
      }>;
    }
  | { type: 'REMOVE_ELEMENT'; elementId: string }
  | { type: 'REORDER_PAGE_ELEMENTS'; pageId: string; elementIds: string[] }
  // Source-keyed class commands for unified undo
  | { type: 'REGISTER_SOURCE_ELEMENT'; sourceKey: string; classes: string; sourceLocation?: SourceLocation }
  | { type: 'UPDATE_SOURCE_CLASSES'; sourceKey: string; classes: string; originalClasses?: string; sourceLocation?: SourceLocation }
  | { type: 'UPDATE_SOURCE_TEXT'; sourceKey: string; textContent: string; originalText?: string; sourceLocation?: SourceLocation }
  // Drop a text override entirely (a REFUSED file write must not leave the
  // canvas value behind as an overlay — on a page view it would paint over
  // what the file really renders).
  | { type: 'CLEAR_SOURCE_TEXT'; sourceKey: string }
  /** A structural image-fill write made the FILE the truth for this key (img ⇄ container): drop the session's src/alt override so a rescan can't repaint the old image over it. */
  | { type: 'CLEAR_SOURCE_IMAGE_ATTRIBUTES'; sourceKey: string }
  // Inline link wrap/unwrap on a source-tracked element (MARKUP_CHANGED): the
  // element's sanitized innerHTML, stored as the LINK_MARKUP_FIELD bookkeeping
  // sibling in its sourceLinkAttributes entry and re-applied by the scan
  // handler after every preview reload. This is the WC overlay tier — in
  // local/server mode the file write is the materialization and this entry is
  // the cross-file / reload-window carrier.
  | { type: 'UPDATE_SOURCE_MARKUP'; sourceKey: string; markup: string; sourceLocation?: SourceLocation }
  | { type: 'UPDATE_STATIC_MARKUP'; elementId: string; staticMarkup: string }
  // Pen tool: penPath + derived staticMarkup + refit wrapper classes, atomically (task-107).
  // Unlike UPDATE_STATIC_MARKUP this never touches instance overrides.
  | { type: 'UPDATE_PEN_PATH'; elementId: string; penPath: string; staticMarkup: string; classes: string }
  // Template commands
  | { type: 'UPDATE_INSTANCE_OVERRIDE'; instanceId: string; childId: string; updates: Partial<ElementData> }
  | { type: 'SET_MASTER_MARKUP'; astroSource: string; markup: string }
  | { type: 'SET_MASTER_CHILD_OVERRIDES'; astroSource: string; placementKey: string; overrides: Record<string, Record<string, string[]>> | null }
  // task-118: drop an orphaned-override record (keep/discard UX; undoable)
  | { type: 'DISCARD_OVERRIDE_ORPHAN'; orphanId: string }
  // Theme instance commands
  | { type: 'ADD_THEME_INSTANCE'; element: ElementData }
  // Promote/un-promote moved a component file; repoint every instance at the new path.
  // Not undoable: same component at a new address (mirrors placement-key migration).
  | { type: 'REMAP_COMPONENT_SOURCE'; oldPath: string; newPath: string }
  // classes: null = delete the selector's class override → live inheritance (task-102)
  | { type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE'; instanceId: string; selector: string; breakpoint: Breakpoint; classes: string[] | null }
  | { type: 'RESET_THEME_INSTANCE_OVERRIDE'; instanceId: string; selector: string }
  // Link commands
  | { type: 'UPDATE_MARKUP_OVERRIDE'; instanceId: string; selector: string; markup: string }
  // Link element commands (for <a> element attribute editing)
  | { type: 'UPDATE_LINK_ATTRIBUTE'; elementId: string; attribute: keyof LinkAttributes; value: string }
  | { type: 'UNWRAP_LINK'; elementId: string }
  // Image element commands (for <img> element attribute editing)
  | { type: 'UPDATE_IMAGE_ATTRIBUTE'; elementId: string; attribute: keyof ImageAttributes; value: string }
  // Slot element: set/clear the name attribute (empty name = default slot)
  | { type: 'SET_SLOT_NAME'; elementId: string; name: string }
  // Source-child attribute override on an editor instance (e.g. a layout's
  // <slot> selected in the editor is a SOURCE child, not a Yjs element — its
  // name is stored as an attributeOverride on the root and written back to the
  // .astro source). Empty value = remove the attribute. selector is relative to
  // the instance's staticMarkup (e.g. 'slot-0').
  | { type: 'UPDATE_INSTANCE_CHILD_ATTRIBUTE'; instanceId: string; selector: string; attribute: string; value: string }
  // Place a content root into a named layout slot (null/'' = default slot).
  | { type: 'SET_ELEMENT_SLOT_NAME'; elementId: string; slotName: string | null }
  // Page-level layout: associate (or detach with layoutName=null) a layout with a page.
  | { type: 'SET_PAGE_LAYOUT'; pageId: string; layoutName: string | null; layoutProps?: Record<string, string>; body?: string }
  | { type: 'ENSURE_LAYOUT_ELEMENT'; pageId: string; layoutName: string; body: string }
  // Page-level layout destructive delete: remove the layout association AND every root content element.
  | { type: 'DELETE_PAGE_LAYOUT_WITH_CONTENT'; pageId: string }
  | { type: 'UPDATE_PAGE_SEO'; pageId: string; field: string; value: unknown }
  // Drawn element commands
  | { type: 'ADD_DRAWN_ELEMENT'; element: DrawnElementData }
  | { type: 'REMOVE_DRAWN_ELEMENT'; elementKey: string }
  | { type: 'CLEAR_DRAWN_SLOT_FILL'; slotKey: string }
  | { type: 'RESOLVE_DRAWN_MEDIA'; key: string; kind: 'image' | 'video' | 'none'; src?: string }
  | { type: 'RESOLVE_INSTANCE_MEDIA'; key: string; kind: 'image' | 'video' | 'none'; src?: string }
  | { type: 'CLEAR_PAGE_DRAWN_ELEMENTS'; pageId: string }
  | { type: 'CLEAR_INSTANCE_DRAWN_ELEMENTS'; pageId: string; instanceId: string }
  // Instance child override commands
  | { type: 'DELETE_INSTANCE_CHILD'; instanceId: string; selector: string }
  | { type: 'SET_CHILD_ORDER'; pageId: string; parentKey: string; childKeys: string[]; sourceSelectors?: string[] }
  | { type: 'CLEAR_INSTANCE_CHILD_ORDERS'; pageId: string; instanceId: string }
  | { type: 'CLEAR_INSTANCE_OVERRIDES'; elementId: string }
  | { type: 'GRID_PLACE_ELEMENT'; key: string; gridColumn: string; gridRow: string; sourceLocation?: SourceLocation }
  | { type: 'SET_GRID_SPAN'; key: string; gridColumn: string; gridRow: string; sourceLocation?: SourceLocation }
  | { type: 'REPARENT_ELEMENT'; pageId: string; elementKey: string; newParentKey: string | null; insertIndex: number }
  // Variable commands
  | { type: 'ADD_VARIABLE_COLLECTION'; collection: VariableCollection }
  | { type: 'DELETE_VARIABLE_COLLECTION'; collectionId: string }
  | { type: 'RENAME_VARIABLE_COLLECTION'; collectionId: string; name: string }
  | { type: 'ADD_VARIABLE_MODE'; collectionId: string; mode: VariableMode }
  | { type: 'DELETE_VARIABLE_MODE'; collectionId: string; modeId: string }
  | { type: 'RENAME_VARIABLE_MODE'; collectionId: string; modeId: string; name: string }
  | { type: 'SET_DEFAULT_MODE'; collectionId: string; modeId: string }
  | { type: 'REORDER_VARIABLE_MODES'; collectionId: string; modeIds: string[] }
  | { type: 'ADD_VARIABLE'; collectionId: string; variable: DesignVariable }
  | { type: 'DELETE_VARIABLE'; collectionId: string; variableId: string }
  | { type: 'UPDATE_VARIABLE_NAME'; collectionId: string; variableId: string; name: string }
  | { type: 'UPDATE_VARIABLE_VALUE'; collectionId: string; variableId: string; modeId: string; value: VariableValue }
  | { type: 'UPDATE_VARIABLE_TYPE'; collectionId: string; variableId: string; newType: 'color' | 'number' | 'string' }
  | { type: 'REORDER_VARIABLES'; collectionId: string; variableIds: string[] }
  | { type: 'SET_COLLECTION_FROM_CSS'; collectionId: string; collection: VariableCollection }
  // Content collection commands
  | { type: 'ADD_CONTENT_COLLECTION'; collection: ContentCollection }
  | { type: 'DELETE_CONTENT_COLLECTION'; collectionId: string }
  | { type: 'RENAME_CONTENT_COLLECTION'; collectionId: string; name: string }
  | { type: 'ADD_COLLECTION_FIELD'; collectionId: string; field: CollectionField }
  | { type: 'DELETE_COLLECTION_FIELD'; collectionId: string; fieldId: string }
  | { type: 'RENAME_COLLECTION_FIELD'; collectionId: string; fieldId: string; name: string }
  // Blog slot commands
  | { type: 'SET_BLOG_SLOT_COLLECTION'; slotKey: string; collectionId: string }
  | { type: 'UNBIND_BLOG_SLOT'; slotKey: string }
  // settings: null = clear all synced overrides → live inheritance (task-102 push/reset)
  | { type: 'UPDATE_BLOG_SLOT_SETTINGS'; slotKey: string; settings: Partial<BlogSlotSettings> | null }
  | { type: 'SET_CONTENT_BINDING'; elementKey: string; slotKey: string; fieldName: string }
  | { type: 'REMOVE_CONTENT_BINDING'; elementKey: string; slotKey: string }
  // Post page commands
  | { type: 'SET_POST_PAGE_COLLECTION'; pageId: string; collectionId: string }
  | { type: 'SET_POST_PAGE_BINDING'; pageId: string; elementKey: string; fieldName: string }
  | { type: 'REMOVE_POST_PAGE_BINDING'; pageId: string; elementKey: string }
  // Project font commands (task-112)
  | { type: 'SET_PROJECT_FONT'; family: string; entry: ProjectFontEntry }
  | { type: 'REMOVE_PROJECT_FONT'; family: string };
  // task-028: REGISTER_BLOG_PAGINATION / REMOVE_BLOG_PAGINATION removed —
  // pagination is now a normal Yjs instance child of BlogSlot.

// ============================================================================
// Unified Key Parsing
// ============================================================================

/**
 * Parsed key - unified format for all element types
 */
type ParsedKey =
  | { type: 'instance-root'; instanceId: string }
  | { type: 'instance-child'; instanceId: string; selector: string }
  | { type: 'source'; file: string; line: number; col: number; placement?: string };

/**
 * task-149: the local-mode placement segment. Capture group 1 is the placement
 * (`p`/`q` + 16 hex); an optional `#N` repeat suffix may follow it. Anchored
 * and hex-strict so a source path that legitimately contains `~` cannot match.
 *
 * task-159/160: the prefix classifies the identity SCHEME, so every stored key
 * is self-describing in localStorage, in a log and in a bug report:
 *   - `s…` = the STAMPED id (`#<data-sq-id>` chain, read from the user's own
 *     source) — current
 *   - `q…` = the ordinal id (`<file>|<specifier>#<ordinal>` chain) — task-159;
 *     still emitted as the primary for any invocation without a stamp
 *   - `p…` = the original coordinate id (`<file>:<line>:<col>` chain)
 * All three must keep parsing: a user with outstanding work has `p…` or `q…`
 * keys on disk until `migratePlacementKeys` has seen the page they live on.
 */
const PLACEMENT_TAIL = /~([pqs][0-9a-f]{16})(?=#\d+$|$)/;

/**
 * Parse any element key into its components.
 * Unified key parser for all element types.
 *
 * Key formats:
 * - Instance root: "el-abc123"
 * - Instance child: "el-abc123:h1-0"
 * - Source element: "src/Hero.astro:5:1"
 *
 * A source key has three legal tails, all optional and in this order:
 * - `~p<16 hex>` — task-149 local-mode PLACEMENT (which invocation of the
 *   defining component this element belongs to). Returned as `placement`.
 * - `#N`         — the scanner's intra-placement repeat counter.
 * - `~p<16 hex>#N` — both.
 *
 * The placement is stripped EXPLICITLY rather than relying on `parseInt`
 * truncating at the first non-digit (which is why `#N` has always parsed).
 * That leniency is invisible and one `Number()` away from silently yielding
 * NaN and dropping every placement-scoped override.
 */
export function parseKey(key: string | null | undefined): ParsedKey | null {
  if (!key || typeof key !== 'string') return null;

  // Contains slash or file extension → source element
  if (key.includes('/') || /\.(astro|tsx?|jsx?)\b/.test(key)) {
    const placementMatch = PLACEMENT_TAIL.exec(key);
    const placement = placementMatch ? placementMatch[1] : undefined;
    const bare = placementMatch
      ? key.slice(0, placementMatch.index) + key.slice(placementMatch.index + placementMatch[0].length)
      : key;
    const parts = bare.split(':');
    if (parts.length >= 3) {
      const col = parseInt(parts.pop()!, 10);
      const line = parseInt(parts.pop()!, 10);
      const file = parts.join(':');
      if (!isNaN(line) && !isNaN(col)) {
        return placement
          ? { type: 'source', file, line, col, placement }
          : { type: 'source', file, line, col };
      }
    }
    return null;
  }

  // Check for instance child pattern: instanceId:tag-N
  const colonIdx = key.lastIndexOf(':');
  if (colonIdx > 0) {
    const possibleSelector = key.slice(colonIdx + 1);
    // Selector pattern: tag-number (e.g., div-0, h1-0, section-0)
    // Note: Tag names can contain numbers (h1, h2, etc.), so use [a-z][a-z0-9]* not [a-z]+
    if (/^[a-z][a-z0-9]*-\d+$/i.test(possibleSelector)) {
      return {
        type: 'instance-child',
        instanceId: key.slice(0, colonIdx),
        selector: possibleSelector
      };
    }
  }

  // Otherwise → instance root
  return { type: 'instance-root', instanceId: key };
}

/** True for drawn-element keys (`drawn-…`), used to distinguish them from
 *  source-tracked instance keys throughout the editor. */
export function isDrawnKey(key: string | null | undefined): boolean {
  return !!key && key.startsWith('drawn-');
}

/** True for blog-card dynamic-content keys (`dynamic:…`). parseKey classifies
 *  `dynamic:<hash>:h2-0` as instance-child (the prefix reads as an instanceId),
 *  so consumers that must exclude dynamic keys need this explicit predicate. */
export function isDynamicKey(key: string | null | undefined): boolean {
  return !!key && key.startsWith('dynamic:');
}

// ============================================================================
// Unified Override Types (V2)
// ============================================================================

/**
 * Unified override structure for a single element selector.
 * Replaces the 5 separate maps: overrides, classOverrides, textOverrides, markupOverrides, hrefOverrides
 */
export interface ElementOverride {
  /** Inline style overrides (replaces `overrides` map) */
  styles?: Record<string, string>;

  /** Class modifications (replaces `classOverrides` map) */
  classes?: ClassData;

  /** Content override - text OR markup, mutually exclusive (replaces textOverrides + markupOverrides) */
  content?: {
    type: 'text' | 'markup';
    value: string;
  };

  /** Link URL override (replaces `hrefOverrides` map) */
  href?: {
    href: string;
    target?: '_blank' | '_self';
  };
}

/**
 * Serialized format for persistence and undo snapshots.
 * Version 2 indicates unified structure.
 */
export interface SerializedOverrides {
  version: 2;
  entries: Record<string, ElementOverride>;
}
