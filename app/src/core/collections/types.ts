export type FieldType = 'text' | 'date' | 'image' | 'url' | 'boolean' | 'list';

export interface CollectionField {
  id: string;
  name: string;
  type: FieldType;
  required: boolean;
}

export interface BlogSlotSettings {
  postsPerPage: number;
  sortBy: 'date-desc' | 'date-asc' | 'title-asc' | 'title-desc';
  pagination: 'none' | 'numbered' | 'load-more';
  layout: 'grid' | 'list';
  columns: number;
  gap: string;
  /** Link mode: 'auto' (default), 'none', or a field name for custom URL */
  postLinkMode?: string;
}

export interface ContentCollection {
  id: string;
  name: string;
  fields: CollectionField[];
  createdAt: string;
}

export interface PostMeta {
  slug: string;
  frontmatter: Record<string, unknown>;
  body: string;
  filePath: string;
  /** Source forms refused by the existing property writer; display-only metadata. */
  readOnlyPropertyKeys?: readonly string[];
}

export interface DiscoveredCollection {
  name: string;
  posts: PostMeta[];
  inferredFields: Array<{ name: string; type: string }>;
}

export const DEFAULT_FIELDS: CollectionField[] = [
  { id: 'f-title', name: 'title', type: 'text', required: true },
  // The post surface renders `subtitle` under the title by default. Optional, so
  // a post without one is valid and the element simply is not there — the same
  // conditional-render case the frontmatter binding already handles.
  { id: 'f-subtitle', name: 'subtitle', type: 'text', required: false },
  { id: 'f-date', name: 'date', type: 'date', required: true },
  { id: 'f-description', name: 'description', type: 'text', required: false },
  { id: 'f-thumbnail', name: 'thumbnail', type: 'image', required: false },
  { id: 'f-draft', name: 'draft', type: 'boolean', required: false },
];

export const BLOG_SLOT_COMPONENT_TYPE = 'BlogSlot';
export const BLOG_SLOT_DEFAULTS_KEY = '__blogslot-defaults';
/**
 * Sentinel collectionId meaning "no collection bound". Matches no entry in
 * contentCollections, so ViewportFrame augments the slot with posts: [] and
 * bridge Phase 5 renders the "No posts yet" empty state. Already written by
 * BlogSettingsBlock lazy-init and ensureBlogSlotBinding.
 */
export const UNBOUND_COLLECTION_ID = '__defaults';
export const BLOG_CARD_COMPONENT_NAME = 'BlogCard';
export const BLOG_CARD_INSTANCE_SUFFIX = ':blogcard';
export const BLOG_POSTS_WRAPPER_SUFFIX = ':posts';
export const BLOG_PAGINATION_WRAPPER_SUFFIX = ':pagination';
export const BLOG_PAGINATION_NUMBERED_COMPONENT = 'BlogPaginationNumbered';
export const BLOG_PAGINATION_LOAD_MORE_COMPONENT = 'BlogPaginationLoadMore';
export const BLOG_PAGINATION_SLOT_NAME = 'pagination';
export const blogCardKey = (slotKey: string): string => `${slotKey}${BLOG_CARD_INSTANCE_SUFFIX}`;

/** componentType → settings.pagination enum. Treats anything-not-load-more as 'numbered'. */
export function paginationKindFromComponent(componentType: string | null | undefined): BlogSlotSettings['pagination'] {
  if (!componentType) return 'none';
  return componentType === BLOG_PAGINATION_LOAD_MORE_COMPONENT ? 'load-more' : 'numbered';
}

/** settings.pagination → componentType. `'none'` returns null (no element to render). */
export function componentFromPaginationKind(kind: BlogSlotSettings['pagination']): string | null {
  if (kind === 'none') return null;
  return kind === 'load-more' ? BLOG_PAGINATION_LOAD_MORE_COMPONENT : BLOG_PAGINATION_NUMBERED_COMPONENT;
}

export const DEFAULT_BLOG_SETTINGS: BlogSlotSettings = {
  postsPerPage: 3,
  sortBy: 'date-desc',
  pagination: 'none',
  layout: 'grid',
  columns: 3,
  gap: 'gap-4',
  postLinkMode: 'auto',
};

export function createDefaultCollection(name: string): ContentCollection {
  return {
    id: crypto.randomUUID(),
    name,
    fields: DEFAULT_FIELDS.map(f => ({ ...f, id: crypto.randomUUID() })),
    createdAt: new Date().toISOString(),
  };
}
