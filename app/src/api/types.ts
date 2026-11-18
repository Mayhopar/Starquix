// src/api/types.ts

export interface User {
  _id: string;
  email: string;
  name?: string;
}

export interface PageComponent {
  id: string;
  name: string;
  slotName: string;
  image: string;
  staticMarkup: string;
  imageSrcs: string[];
  // Instance type discriminator
  type?: 'instance';
  // For local instances (from component templates)
  templateId?: string;
  overrides?: Record<string, Record<string, unknown>>;
  // For theme instances
  themeId?: string;
  componentPath?: string;
  classOverrides?: Record<string, Record<string, string[]>>;
  // Markup overrides (for links in text)
  markupOverrides?: Record<string, string>;
  // Href overrides (for standalone <a> element href/target)
  hrefOverrides?: Record<string, { href?: string; target?: string }>;
  // Link overrides (for link attributes on instance children)
  linkOverrides?: Record<string, Record<string, unknown>>;
  // Link attributes (for link attributes on instance root)
  linkAttributes?: Record<string, unknown>;
  // Image overrides (for image attributes on instance children)
  imageOverrides?: Record<string, Record<string, unknown>>;
  // Image attributes (for image attributes on instance root)
  imageAttributes?: Record<string, unknown>;
  // Relative path to .astro source file
  astroSource?: string;
}

export interface PageMetadata {
  fonts: string[];
}

export interface Page {
  _id: string;
  name: string;
  components: PageComponent[];
  metadata: PageMetadata | null;
  // Structural: which layout component wraps this page, and its prop values.
  // Optional so legacy saved pages hydrate cleanly as "no layout".
  layoutName?: string | null;
  layoutProps?: Record<string, string>;
  // Page SEO/metadata (Basic SEO, OG, Twitter, robots, structured data, AI).
  // Plain JSON mirror of the page.seo Y.Map. Optional so legacy pages hydrate
  // cleanly as "no seo".
  seo?: Record<string, unknown>;
  /** Explicit home-page flag: this page exports as index.astro. */
  isHome?: boolean;
}

export interface PagesTree {
  id: string;
  children: PagesTree[];
}

export interface Project {
  _id: string;
  name: string;
  pagesTree: PagesTree[];
  pages: Record<string, Page>;
  /** Unified-component master overlay, keyed by astroSource. Absent for pre-feature projects. */
  masters?: Record<string, { markup: string }>;
  /** Content collections seeded into the doc on first-open hydration. */
  contentCollections?: import('@/core/collections/types').ContentCollection[];
  users?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateProjectDto {
  name: string;
}

export interface UpdatePageDto {
  name?: string;
  components?: PageComponent[];
  metadata?: PageMetadata;
  layoutName?: string | null;
  layoutProps?: Record<string, string>;
  seo?: Record<string, unknown>;
}
