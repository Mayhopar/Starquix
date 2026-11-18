import { expect, it } from 'vitest';
import { describeProperties, isEmptyValue, propertyLabel, propertyValueSummary } from '../propertyDescriptors';
import type { CollectionField } from '@/core/collections/types';
const field = (name: string, type: CollectionField['type']): CollectionField => ({ id: name, name, type, required: true });
it('never coerces schema conflicts, nulls, objects or mixed arrays into an editable scalar/list', () => {
  const fields = [field('flag', 'boolean'), field('tags', 'list'), field('number', 'text'), field('blank', 'date'), field('raw', 'text')];
  const descriptors = describeProperties(fields, { flag: false, tags: ['a', 1], number: 12, blank: null, raw: { raw: 'a: b' }, extra: 'keep' }, 'schema');
  expect(descriptors.map(d => [d.key, d.editor])).toEqual([['flag', 'boolean'], ['tags', 'readonly'], ['number', 'readonly'], ['blank', 'readonly'], ['raw', 'readonly'], ['extra', 'readonly']]);
  expect(descriptors[descriptors.length - 1]?.source).toBe('extra');
});
it('treats inferred required metadata as optional and conflicting field declarations as readonly', () => {
  const descriptors = describeProperties([field('tags', 'list'), field('tags', 'text'), field('date', 'date')], { tags: ['one'], date: '2026-09-09T01:02:03Z' }, 'inferred');
  expect(descriptors.map(d => [d.editor, d.required])).toEqual([['readonly', false], ['date', false]]);
});

it('source metadata refuses a string without disabling supported multiline strings or legacy inputs', () => {
  const fields = [field('blocked', 'text'), field('supported', 'text')];
  const values = { blocked: 'First\nSecond', supported: 'First\nSecond' };
  expect(describeProperties(fields, values, 'inferred', ['blocked']).map(d => d.editor)).toEqual(['readonly', 'text']);
  expect(describeProperties(fields, values, 'inferred').map(d => d.editor)).toEqual(['text', 'text']);
});

it('labels a frontmatter key in sentence case and keeps acronyms', () => {
  expect(['draft', 'pubDate', 'heroImage', 'hero_image', 'og-image', 'canonicalURL', 'SEOTitle', 'h1Title'].map(propertyLabel))
    .toEqual(['Draft', 'Pub date', 'Hero image', 'Hero image', 'Og image', 'Canonical URL', 'SEO title', 'H1 title']);
});
it('treats undefined, empty strings and empty lists as Empty, never false or 0', () => {
  expect([undefined, '', [], false, 0, null, ['a']].map(isEmptyValue)).toEqual([true, true, true, false, false, false, false]);
  expect(propertyValueSummary([])).toBe('Empty');
  expect(propertyValueSummary(['a', 'b'])).toBe('2 items');
});
