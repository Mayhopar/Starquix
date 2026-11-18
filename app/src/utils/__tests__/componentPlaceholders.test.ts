import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '@/store/commands';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';
import { expandComponentTags } from '@/utils/canvasHtml';
import {
  extractComponentPlaceholders,
  expandPlaceholders,
} from '@/utils/componentPlaceholders';
import { collapseInlinedChildren } from '@/utils/collapseInlinedChildren';

const CARD_PATH = 'src/components/library/BlogCard.astro';
const HEADER_PATH = 'src/components/library/Header.astro';
const SLOT_PATH = 'src/components/library/BlogSlot.astro';

const lib = (name: string, path: string, html: string): ScannedComponent => ({
  name, path, source: 'built-in', html, category: 'Test', props: [], slots: [], dependencies: [],
});

const CARD_HTML = '<div class="bg-stone-200 rounded"><h3>{title}</h3></div>';
const HEADER_HTML = '<header class="p-4">Site</header>';

const BLOGSLOT_SRC = `<section class="bg-stone-100 w-full p-10">
  <div class="grid grid-cols-3 gap-4" data-blog-source="posts">
    <slot name="posts">
      <BlogCard />
    </slot>
  </div>
</section>`;

describe('extractComponentPlaceholders', () => {
  it('component inside a named slot fallback → placementKey = slot name, slot wrapper kept', () => {
    const { html, placements } = extractComponentPlaceholders(BLOGSLOT_SRC, [lib('BlogCard', CARD_PATH, CARD_HTML)]);
    expect(html).toContain('<slot name="posts">');
    expect(html).toContain(`data-sq-astro-source="${CARD_PATH}"`);
    expect(html).toContain('data-sq-placement="posts"');
    expect(html).toContain('data-sq-slot-fallback="posts"');
    expect(html).not.toContain('<BlogCard');
    expect(placements).toEqual([{ name: 'BlogCard', path: CARD_PATH, placementKey: 'posts', slotFallback: 'posts' }]);
  });

  it('components outside any slot → name-N occurrence keys', () => {
    const src = '<div><Header /><main>hi</main><Header /></div>';
    const { html, placements } = extractComponentPlaceholders(src, [lib('Header', HEADER_PATH, HEADER_HTML)]);
    expect(placements.map((p) => p.placementKey)).toEqual(['header-0', 'header-1']);
    expect(placements[0].slotFallback).toBeUndefined();
    expect(html).toContain('data-sq-placement="header-0"');
    expect(html).toContain('data-sq-placement="header-1"');
  });

  it('component not in library is left untouched', () => {
    const src = '<div><Mystery /></div>';
    const { html, placements } = extractComponentPlaceholders(src, [lib('Header', HEADER_PATH, HEADER_HTML)]);
    expect(html).toBe(src);
    expect(placements).toEqual([]);
  });
});

describe('expandPlaceholders', () => {
  const placeholder = (path: string, key: string) =>
    `<sq-child data-sq-astro-source="${path}" data-sq-placement="${key}"></sq-child>`;

  it('expands from masters markup when present, library html otherwise', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: CARD_PATH, markup: '<div class="edited">M</div>' });
    const markup = `<section>${placeholder(CARD_PATH, 'posts')}${placeholder(HEADER_PATH, 'header-0')}</section>`;
    const out = expandPlaceholders(doc, markup, SLOT_PATH, [lib('Header', HEADER_PATH, HEADER_HTML)]);
    expect(out).toContain('<div class="edited">M</div>'); // masters wins
    expect(out).toContain(HEADER_HTML); // library fallback
    expect(out).not.toContain('sq-child');
  });

  it('base override REPLACES the whole class attr — stale prefixed tokens must not survive and conflict', () => {
    // Regression ("orange class present but card paints white"): the child's
    // master carried xl:bg-white from an old push; the base-set replace kept
    // existing prefixed tokens, so xl:bg-white and the override's
    // xl:bg-orange-500 both landed on the element and white won by stylesheet
    // order. resolveOverrideClasses contract: an override is the FULL intended
    // set — replace, never a union.
    const doc = new Y.Doc();
    applyCommand(doc, {
      type: 'SET_MASTER_MARKUP', astroSource: CARD_PATH,
      markup: '<div class="p-4 h-full xl:bg-white">t</div>',
    });
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: SLOT_PATH, markup: '<section></section>' });
    applyCommand(doc, {
      type: 'SET_MASTER_CHILD_OVERRIDES', astroSource: SLOT_PATH, placementKey: 'posts',
      overrides: { 'div-0': { base: ['p-4', 'bg-neutral-400', 'h-full', 'xl:bg-orange-500'] } },
    });
    const out = expandPlaceholders(doc, `<section>${placeholder(CARD_PATH, 'posts')}</section>`, SLOT_PATH, []);
    expect(out).toContain('class="p-4 bg-neutral-400 h-full xl:bg-orange-500"');
    expect(out).not.toContain('xl:bg-white');
  });

  it('applies parent childOverrides with replace semantics + bp prefixes', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: CARD_PATH, markup: CARD_HTML });
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: SLOT_PATH, markup: '<section></section>' });
    applyCommand(doc, {
      type: 'SET_MASTER_CHILD_OVERRIDES', astroSource: SLOT_PATH, placementKey: 'posts',
      overrides: { 'div-0': { base: ['bg-white'], lg: ['bg-black'] } },
    });
    const out = expandPlaceholders(doc, `<section>${placeholder(CARD_PATH, 'posts')}</section>`, SLOT_PATH, []);
    expect(out).toContain('class="bg-white lg:bg-black"'); // replace, not merge with bg-stone-200
    expect(out).not.toContain('bg-stone-200');
  });

  it('missing child (no masters, no library) → empty string + warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const doc = new Y.Doc();
    const out = expandPlaceholders(doc, `<section>${placeholder(CARD_PATH, 'posts')}</section>`, SLOT_PATH, []);
    expect(out).toBe('<section></section>');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('cycle A→B→A: inner A becomes empty + warn, no infinite loop', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const doc = new Y.Doc();
    const A = 'src/components/A.astro';
    const B = 'src/components/B.astro';
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: A, markup: `<div class="a">${placeholder(B, 'b-0')}</div>` });
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: B, markup: `<div class="b">${placeholder(A, 'a-0')}</div>` });
    const out = expandPlaceholders(doc, `<main>${placeholder(A, 'a-0')}</main>`, 'src/pages/page.astro', []);
    expect(out).toBe('<main><div class="a"><div class="b"></div></div></main>');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('round-trip: extract → expand ≈ expandComponentTags (modulo source markers)', () => {
    const library = [lib('BlogCard', CARD_PATH, CARD_HTML)];
    const doc = new Y.Doc();
    const { html } = extractComponentPlaceholders(BLOGSLOT_SRC, library);
    const expanded = expandPlaceholders(doc, html, SLOT_PATH, library);
    const legacy = expandComponentTags(BLOGSLOT_SRC, library).replace(/ data-sq-component-src="[^"]*"/g, '');
    expect(expanded).toBe(legacy);
  });
});

describe('collapseInlinedChildren', () => {
  it('collapses marker-rooted subtree to sq-child + extracts root-class patch when it differs', () => {
    const inlined = `<section class="bg-stone-100"><slot name="posts"><div data-sq-component-src="${CARD_PATH}" class="bg-rose-500 rounded"><h3>{title}</h3></div></slot></section>`;
    const { markup, patches } = collapseInlinedChildren(inlined, new Map([[CARD_PATH, CARD_HTML]]));
    expect(markup).toContain('<sq-child');
    expect(markup).toContain(`data-sq-astro-source="${CARD_PATH}"`);
    expect(markup).toContain('data-sq-placement="posts"');
    expect(markup).not.toContain('data-sq-component-src');
    expect(patches).toEqual({ posts: { 'div-0': { base: ['bg-rose-500', 'rounded'] } } });
  });

  it('no patch when root class equals the child base root class', () => {
    const inlined = `<section><slot name="posts"><div data-sq-component-src="${CARD_PATH}" class="bg-stone-200 rounded"><h3>{title}</h3></div></slot></section>`;
    const { markup, patches } = collapseInlinedChildren(inlined, new Map([[CARD_PATH, CARD_HTML]]));
    expect(markup).toContain('<sq-child');
    expect(patches).toEqual({});
  });

  it('markup without markers is returned byte-for-byte untouched', () => {
    const already = `<section><sq-child data-sq-astro-source="${CARD_PATH}" data-sq-placement="posts"></sq-child></section>`;
    const { markup, patches } = collapseInlinedChildren(already, new Map());
    expect(markup).toBe(already);
    expect(patches).toEqual({});
  });

  it('non-slot marker → name-N placement key from the source basename', () => {
    const inlined = `<div><header data-sq-component-src="${HEADER_PATH}" class="p-4">Site</header></div>`;
    const { markup, patches } = collapseInlinedChildren(inlined, new Map([[HEADER_PATH, HEADER_HTML]]));
    expect(markup).toContain('data-sq-placement="header-0"');
    expect(patches).toEqual({});
  });
});
