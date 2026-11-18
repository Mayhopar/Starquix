export interface ImageField {
  type: 'upload' | 'url';
  value: string;
  preview?: string;
}

export interface StructuredDataEntry {
  id: string;
  schemaType: 'LocalBusiness' | 'Article' | 'Product' | 'FAQ'
    | 'Organization' | 'WebSite' | 'Event' | 'Recipe'
    | 'Course' | 'VideoObject' | 'HowTo' | 'BreadcrumbList'
    | 'custom';
  fields: Record<string, string>;
  customJson?: string;
}

export interface SeoPageData {
  title: string;
  description: string;
  canonicalUrl: string;
  favicon: ImageField | null;
  author: string;
  keywords: string;
  lang: string;

  robotsIndex: boolean;
  robotsFollow: boolean;
  robotsAdvanced: string[];
  generateSitemap: boolean;
  generateRobotsTxt: boolean;

  ogTitle: string;
  ogDescription: string;
  ogImage: ImageField | null;
  ogImageAlt: string;
  ogType: 'website' | 'article' | 'product' | 'profile';
  ogUrl: string;
  ogSiteName: string;
  ogLocale: string;

  twitterCardType: 'summary' | 'summary_large_image';
  twitterTitle: string;
  twitterDescription: string;
  twitterImage: ImageField | null;
  twitterSite: string;
  twitterCreator: string;

  structuredData: StructuredDataEntry[];

  semanticPageType: 'landing' | 'blog-post' | 'product' | 'docs' | 'about' | 'contact' | 'faq' | 'portfolio';
  aiDescription: string;
  llmsTxtEntry: string;
}

export function createDefaultSeoData(): SeoPageData {
  return {
    title: '',
    description: '',
    canonicalUrl: '',
    favicon: null,
    author: '',
    keywords: '',
    lang: 'en',
    robotsIndex: true,
    robotsFollow: true,
    robotsAdvanced: [],
    generateSitemap: true,
    generateRobotsTxt: true,
    ogTitle: '',
    ogDescription: '',
    ogImage: null,
    ogImageAlt: '',
    ogType: 'website',
    ogUrl: '',
    ogSiteName: '',
    ogLocale: 'en_US',
    twitterCardType: 'summary_large_image',
    twitterTitle: '',
    twitterDescription: '',
    twitterImage: null,
    twitterSite: '',
    twitterCreator: '',
    structuredData: [],
    semanticPageType: 'landing',
    aiDescription: '',
    llmsTxtEntry: '',
  };
}

/**
 * Hydrate a page's raw seo map JSON into the full SeoPageData plus the set of
 * explicitly-set keys. Single source for the default-merge + explicit-keys
 * contract shared by useSeoData (panel) and read_page_seo (AI tool) — the
 * scorer counts deliberate default choices only via explicitKeys, so the two
 * derivations must never diverge.
 */
export function hydrateSeoData(raw: Partial<SeoPageData> | undefined): { seo: SeoPageData; explicitKeys: Set<string> } {
  const seoRaw = raw ?? {};
  return {
    seo: { ...createDefaultSeoData(), ...seoRaw },
    explicitKeys: new Set(Object.keys(seoRaw)),
  };
}
