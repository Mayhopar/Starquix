// app/src/ai/tools/__tests__/autoContext.test.ts
// Pages block must carry exact hrefs (pageRoute = single URL source) so the AI
// never guesses slugs when linking pages together.
import { describe, it, expect } from 'vitest';
import { createEditorDoc } from '@/store/createEditorDoc';
import { applyCommand } from '@/store/commands';
import type { PageData } from '@/store/types';
import { buildAutoContext, formatAutoContext, buildVariablesContext } from '../autoContext';

const page = (id: string, name: string, extra: Partial<PageData> = {}): PageData =>
  ({ id, name, rootElementIds: [], children: [], ...extra } as PageData);

function seedDoc() {
  const doc = createEditorDoc();
  applyCommand(doc, { type: 'ADD_PAGE', page: page('p-home', 'Home', { isHome: true }) });
  applyCommand(doc, { type: 'ADD_PAGE', page: page('p-about', 'About Us') });
  applyCommand(doc, { type: 'ADD_PAGE', page: page('p-post', 'Post Page', { pageType: 'post', routePrefix: '/blog' }) });
  return doc;
}

describe('buildAutoContext pages', () => {
  it('returns id, name, href for every page; home is /', () => {
    const ctx = buildAutoContext(seedDoc(), null);
    expect(ctx.pages).toEqual(expect.arrayContaining([
      { id: 'p-home', name: 'Home', href: '/', isPost: false },
      { id: 'p-about', name: 'About Us', href: '/about-us', isPost: false },
    ]));
  });

  // Files-truth pages are NAMED by their route: the AI must be told
  // '/works/inito', not the slugified '/works-inito' (a dead link it would write).
  it('a route-named (files-truth) page keeps its route as the href', () => {
    const doc = seedDoc();
    applyCommand(doc, { type: 'ADD_PAGE', page: page('works-inito', '/works/inito') });
    expect(buildAutoContext(doc, null).pages.find(p => p.id === 'works-inito')?.href).toBe('/works/inito');
  });

  it('marks post pages and gives them no static href', () => {
    const ctx = buildAutoContext(seedDoc(), null);
    const post = ctx.pages.find(p => p.id === 'p-post');
    expect(post).toEqual({ id: 'p-post', name: 'Post Page', href: null, isPost: true });
  });
});

describe('formatAutoContext pages block', () => {
  it('prints hrefs, ids, the must-use instruction, and the post marker', () => {
    const out = formatAutoContext(buildAutoContext(seedDoc(), null));
    expect(out).toContain('Home → / [id: p-home]');
    expect(out).toContain('About Us → /about-us [id: p-about]');
    expect(out).toContain('exact hrefs');            // the "always use these" instruction
    expect(out).toContain('dynamic post detail page'); // post pages excluded from nav-linking
  });

  it('omits the Pages block when the doc has no pages', () => {
    const doc = createEditorDoc();
    const out = formatAutoContext(buildAutoContext(doc, null));
    expect(out).not.toContain('Pages');
  });
});

// task-262/263: the editor and Tailwind 3.4 read a bare text-/border-[var()] as a
// colour only by inference — the model is told the typed forms, which cannot be misread.
describe('buildVariablesContext', () => {
  it('recommends the typed colour forms for text and border', () => {
    const doc = createEditorDoc();
    applyCommand(doc, { type: 'ADD_VARIABLE_COLLECTION', collection: { id: 'c', name: 'Colors', modes: [{ id: 'm', name: 'Light', isDefault: true }], variables: [] } });
    const out = buildVariablesContext(doc);
    expect(out).toContain('text-[color:var(--name)]');
    expect(out).toContain('border-[color:var(--name)]');
    expect(out).not.toContain('text-[var(--name)]');
  });
});

// task-267: the chat could not see which fonts the project has.
describe('formatAutoContext fonts', () => {
  it('names the project font families, and says nothing when there are none', () => {
    const doc = seedDoc();
    expect(formatAutoContext(buildAutoContext(doc, null))).not.toContain('fonts');
    applyCommand(doc, { type: 'SET_PROJECT_FONT', family: 'Playfair Display', entry: { source: 'google', css: '@font-face{}', assetIds: [] } });
    applyCommand(doc, { type: 'SET_PROJECT_FONT', family: 'Inter', entry: { source: 'google', css: '@font-face{}', assetIds: [] } });
    expect(formatAutoContext(buildAutoContext(doc, null))).toContain('Inter, Playfair Display');
  });
});
