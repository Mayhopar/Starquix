// Regression (2026-07-24): enum fields whose correct value IS the default
// (ogType 'website', semanticPageType 'landing', ogLocale 'en_US') scored 0
// even when explicitly chosen — a landing page could never reach 100%.
import { describe, it, expect } from 'vitest';
import { computeCompleteness } from '@/store/seo/seoCompleteness';
import { createDefaultSeoData, hydrateSeoData } from '@/store/seo/types';

describe('computeCompleteness explicit-choice scoring', () => {
  it('default enum values score 0 when never set', () => {
    const r = computeCompleteness(createDefaultSeoData(), new Set());
    expect(r.unfilled.map(f => f.key)).toEqual(
      expect.arrayContaining(['ogType', 'semanticPageType', 'ogLocale']),
    );
  });

  it('explicitly chosen default enum values count as filled', () => {
    const r = computeCompleteness(
      createDefaultSeoData(),
      new Set(['ogType', 'semanticPageType', 'ogLocale']),
    );
    const unfilledKeys = r.unfilled.map(f => f.key);
    expect(unfilledKeys).not.toContain('ogType');
    expect(unfilledKeys).not.toContain('semanticPageType');
    expect(unfilledKeys).not.toContain('ogLocale');
  });

  it('non-default values still count even when not in explicitKeys', () => {
    const seo = { ...createDefaultSeoData(), ogType: 'article' as const, ogLocale: 'de_DE' };
    const r = computeCompleteness(seo, new Set());
    const unfilledKeys = r.unfilled.map(f => f.key);
    expect(unfilledKeys).not.toContain('ogType');
    expect(unfilledKeys).not.toContain('ogLocale');
  });

  it('hydrateSeoData merges defaults and reports explicit keys', () => {
    const { seo, explicitKeys } = hydrateSeoData({ title: 'T', ogType: 'website' });
    expect(seo.title).toBe('T');
    expect(seo.description).toBe('');
    expect(explicitKeys).toEqual(new Set(['title', 'ogType']));
    expect(hydrateSeoData(undefined).explicitKeys.size).toBe(0);
  });

  it('a fully filled page reaches 100%', () => {
    const seo = {
      ...createDefaultSeoData(),
      title: 't', description: 'd', canonicalUrl: 'https://a.com/', author: 'A',
      ogTitle: 'ot', ogDescription: 'od', ogImageAlt: 'alt', ogUrl: 'https://a.com/',
      ogImage: { type: 'url' as const, value: 'https://a.com/og.webp' },
      favicon: { type: 'url' as const, value: '/favicon.ico' },
      twitterSite: '@a', twitterCreator: '@a',
      structuredData: [{ id: 'sd-1', schemaType: 'WebSite' as const, fields: { name: 'A' } }],
      aiDescription: 'ai', llmsTxtEntry: 'llms',
    };
    const r = computeCompleteness(seo, new Set(['ogType', 'semanticPageType', 'ogLocale', 'twitterCardType']));
    expect(r.percentage).toBe(100);
    expect(r.unfilled).toEqual([]);
  });
});
