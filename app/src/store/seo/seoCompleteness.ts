import type { SeoPageData } from './types';

interface ScoredField {
  key: string;
  label: string;
  weight: number;
  filled: boolean;
}

export interface CompletenessResult {
  score: number;
  maxScore: number;
  percentage: number;
  filledCount: number;
  totalCount: number;
  hint: string | null;
  color: 'green' | 'yellow' | 'red';
  /** Unfilled fields, highest weight first — surfaced to the AI via read_page_seo */
  unfilled: Array<{ key: string; label: string; weight: number }>;
}

/**
 * @param explicitKeys keys actually present in the page's seo Y.Map (set by the
 * user or the AI) — get both args from hydrateSeoData. Enum fields whose
 * correct value IS the default (ogType 'website' on a landing page,
 * semanticPageType 'landing', ogLocale 'en_US') count as filled once
 * explicitly chosen — otherwise a landing page can never reach 100%. Required
 * so no caller silently falls back to the old defaults-score-zero behavior.
 */
export function computeCompleteness(seo: SeoPageData, explicitKeys: Set<string>): CompletenessResult {
  const chosen = (key: string) => explicitKeys.has(key);
  const fields: ScoredField[] = [
    // Critical (3pts)
    { key: 'title', label: 'Add a page title', weight: 3, filled: !!seo.title },
    { key: 'description', label: 'Add a meta description', weight: 3, filled: !!seo.description },
    // Important (2pts)
    { key: 'ogImage', label: 'Add an Open Graph image', weight: 2, filled: !!seo.ogImage },
    { key: 'ogImageAlt', label: 'Add alt text for OG image', weight: 2, filled: !!seo.ogImageAlt },
    { key: 'structuredData', label: 'Add structured data (JSON-LD)', weight: 2, filled: seo.structuredData.length > 0 },
    { key: 'canonicalUrl', label: 'Set a canonical URL', weight: 2, filled: !!seo.canonicalUrl },
    // Recommended (1pt)
    { key: 'ogTitle', label: 'Add an OG title', weight: 1, filled: !!seo.ogTitle },
    { key: 'ogDescription', label: 'Add an OG description', weight: 1, filled: !!seo.ogDescription },
    { key: 'ogType', label: 'Set OG type', weight: 1, filled: chosen('ogType') || seo.ogType !== 'website' },
    { key: 'twitterCardType', label: 'Set Twitter card type', weight: 1, filled: !!seo.twitterCardType },
    { key: 'semanticPageType', label: 'Set semantic page type', weight: 1, filled: chosen('semanticPageType') || seo.semanticPageType !== 'landing' },
    { key: 'aiDescription', label: 'Add an AI description', weight: 1, filled: !!seo.aiDescription },
    // Nice-to-have (0.5pts)
    { key: 'author', label: 'Add an author', weight: 0.5, filled: !!seo.author },
    { key: 'ogUrl', label: 'Set OG URL', weight: 0.5, filled: !!seo.ogUrl },
    { key: 'twitterSite', label: 'Add Twitter @site handle', weight: 0.5, filled: !!seo.twitterSite },
    { key: 'twitterCreator', label: 'Add Twitter @creator handle', weight: 0.5, filled: !!seo.twitterCreator },
    { key: 'ogLocale', label: 'Set OG locale', weight: 0.5, filled: chosen('ogLocale') || (seo.ogLocale !== 'en_US' && !!seo.ogLocale) },
    { key: 'llmsTxtEntry', label: 'Add llms.txt content', weight: 0.5, filled: !!seo.llmsTxtEntry },
    { key: 'favicon', label: 'Add a favicon', weight: 0.5, filled: !!seo.favicon },
  ];

  const score = fields.reduce((acc, f) => acc + (f.filled ? f.weight : 0), 0);
  const maxScore = fields.reduce((acc, f) => acc + f.weight, 0);
  const percentage = maxScore > 0 ? (score / maxScore) * 100 : 0;
  const filledCount = fields.filter(f => f.filled).length;
  const totalCount = fields.length;

  // Hint: highest-weight unfilled field
  const unfilled = fields.filter(f => !f.filled).sort((a, b) => b.weight - a.weight);
  const hint = unfilled.length > 0 ? unfilled[0].label : null;

  const color = percentage > 80 ? 'green' : percentage > 50 ? 'yellow' : 'red';

  return {
    score, maxScore, percentage, filledCount, totalCount, hint, color,
    unfilled: unfilled.map(({ key, label, weight }) => ({ key, label, weight })),
  };
}
