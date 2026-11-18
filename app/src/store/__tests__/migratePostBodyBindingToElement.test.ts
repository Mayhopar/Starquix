import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { createEditorDoc } from '../createEditorDoc';
import { migratePostBodyBindingToElement } from '../migrations/migratePostBodyBindingToElement';

/** Old starter markup: body lives as a real div inside the host, bound via
 *  the legacy postPageBindings 'body' entry (pre content-slot model). */
const OLD_MARKUP = (elId: string) =>
  `<article class="max-w-3xl mx-auto px-4 py-12"><h1 data-key="${elId}:h1-0" class="text-4xl font-bold mb-4">Post Title</h1><time data-key="${elId}:time-0" class="text-sm text-gray-500 mb-8 block">Date</time><img data-key="${elId}:img-0" class="w-full rounded-lg mb-8" src="/images/placeholder.jpg" alt="" /><div data-key="${elId}:div-0" class="prose prose-lg">Post content goes here...</div></article>`;

/** Hand-built OLD-shape doc (does NOT call the new createPostPage). */
function buildLegacyDoc(opts: { hostMarkup?: string; skipHostElement?: boolean } = {}) {
  const doc = createEditorDoc();
  applyCommand(doc, { type: 'ADD_PAGE', page: {
    id: 'p1', name: 'Post Page', rootElementIds: [], children: [],
    pageType: 'post', collectionId: 'col-1',
  } });
  applyCommand(doc, { type: 'SET_POST_PAGE_COLLECTION', pageId: 'p1', collectionId: 'col-1' });
  applyCommand(doc, { type: 'SET_POST_PAGE_BINDING', pageId: 'p1', elementKey: 'el-X:h1-0', fieldName: 'title' });
  applyCommand(doc, { type: 'SET_POST_PAGE_BINDING', pageId: 'p1', elementKey: 'el-X:div-0', fieldName: 'body' });

  if (!opts.skipHostElement) {
    // Hand-built so the data-keys stay in el-X's namespace (ADD_ELEMENT would re-stamp).
    const elements = doc.getMap('elements');
    const host = new Y.Map<unknown>();
    host.set('id', 'el-X');
    host.set('pageId', 'p1');
    host.set('parentId', null);
    host.set('index', 0);
    host.set('type', 'component');
    host.set('componentType', 'PostPageLayout');
    host.set('staticMarkup', opts.hostMarkup ?? OLD_MARKUP('el-X'));
    elements.set('el-X', host);
    const page = doc.getMap('pages').get('p1') as Y.Map<unknown>;
    (page.get('rootElementIds') as Y.Array<string>).push(['el-X']);
  }
  return doc;
}

function getContentElements(doc: Y.Doc): Y.Map<unknown>[] {
  const out: Y.Map<unknown>[] = [];
  doc.getMap('elements').forEach((value) => {
    const el = value as Y.Map<unknown>;
    if (el.get('bindingType') === 'collection-content') out.push(el);
  });
  return out;
}

function getBindings(doc: Y.Doc): Record<string, string> {
  const yBinding = doc.getMap('postPageBindings').get('p1') as Y.Map<unknown>;
  const bindings = yBinding.get('bindings') as Y.Map<unknown>;
  const out: Record<string, string> = {};
  bindings.forEach((v, k) => { out[k] = v as string; });
  return out;
}

describe('migratePostBodyBindingToElement', () => {
  it('converts the legacy body binding into a collection-content slot element', () => {
    const doc = buildLegacyDoc();

    migratePostBodyBindingToElement(doc);

    const contentEls = getContentElements(doc);
    expect(contentEls).toHaveLength(1);
    const contentEl = contentEls[0];
    expect(contentEl.get('parentId')).toBe('el-X');
    expect(contentEl.get('pageId')).toBe('p1');
    expect(contentEl.get('slotName')).toBe('content');
    expect(contentEl.get('type')).toBe('slot');
    const childMarkup = contentEl.get('staticMarkup') as string;
    expect(childMarkup).toContain('data-sq-slot');
    expect(childMarkup).toContain('class="prose prose-lg"'); // carried over from the old div
    expect(childMarkup).toContain('data-key="el-X-content:div-0"'); // createElementYMap stamps the root

    const host = doc.getMap('elements').get('el-X') as Y.Map<unknown>;
    const hostMarkup = host.get('staticMarkup') as string;
    expect(hostMarkup).toContain('<slot name="content"></slot>');
    expect(hostMarkup).not.toContain('data-key="el-X:div-0"');

    const bindings = getBindings(doc);
    expect(bindings['el-X:div-0']).toBeUndefined(); // 'body' entry gone
    expect(bindings['el-X:h1-0']).toBe('title'); // 'title' remains
  });

  it('is idempotent — running twice creates exactly one content element', () => {
    const doc = buildLegacyDoc();
    migratePostBodyBindingToElement(doc);
    migratePostBodyBindingToElement(doc);
    expect(getContentElements(doc)).toHaveLength(1);
  });

  it('skips creating a second element when a content element already exists, but still drops the binding', () => {
    const doc = buildLegacyDoc();
    migratePostBodyBindingToElement(doc);
    // Simulate a straggler legacy entry re-appearing after migration.
    applyCommand(doc, { type: 'SET_POST_PAGE_BINDING', pageId: 'p1', elementKey: 'el-X:div-0', fieldName: 'body' });
    migratePostBodyBindingToElement(doc);
    expect(getContentElements(doc)).toHaveLength(1);
    expect(getBindings(doc)['el-X:div-0']).toBeUndefined();
  });

  it('deletes a body binding whose host element is missing (no throw, no element)', () => {
    const doc = buildLegacyDoc({ skipHostElement: true });

    expect(() => migratePostBodyBindingToElement(doc)).not.toThrow();

    expect(getContentElements(doc)).toHaveLength(0);
    const bindings = getBindings(doc);
    expect(bindings['el-X:div-0']).toBeUndefined();
    expect(bindings['el-X:h1-0']).toBe('title');
  });

  it("deletes a body binding whose data-key isn't found in the host markup (no throw, no element)", () => {
    const doc = buildLegacyDoc({
      hostMarkup: `<article><h1 data-key="el-X:h1-0">Post Title</h1></article>`,
    });

    expect(() => migratePostBodyBindingToElement(doc)).not.toThrow();

    expect(getContentElements(doc)).toHaveLength(0);
    const bindings = getBindings(doc);
    expect(bindings['el-X:div-0']).toBeUndefined();
    const host = doc.getMap('elements').get('el-X') as Y.Map<unknown>;
    expect(host.get('staticMarkup')).toContain('data-key="el-X:h1-0"'); // host untouched
  });

  it('keeps the binding and leaves the host untouched when the body div has nested same-name tags', () => {
    // Lazy-close regex would end the match at the inner </div>, so a replace
    // would orphan "tail</div>" — a silent, irreversible corruption at doc load.
    const hostMarkup = `<article><h1 data-key="el-X:h1-0">T</h1><div data-key="el-X:div-0" class="prose prose-lg"><div>inner</div>tail</div></article>`;
    const doc = buildLegacyDoc({ hostMarkup });

    expect(() => migratePostBodyBindingToElement(doc)).not.toThrow();

    expect(getContentElements(doc)).toHaveLength(0);
    const host = doc.getMap('elements').get('el-X') as Y.Map<unknown>;
    expect(host.get('staticMarkup')).toBe(hostMarkup); // host UNCHANGED
    const bindings = getBindings(doc);
    expect(bindings['el-X:div-0']).toBe('body'); // binding KEPT for a smarter retry
  });

  it('falls back to the default prose classes when the old div has no class attribute', () => {
    const doc = buildLegacyDoc({
      hostMarkup: `<article><h1 data-key="el-X:h1-0">T</h1><div data-key="el-X:div-0">Post content goes here...</div></article>`,
    });

    migratePostBodyBindingToElement(doc);

    const [contentEl] = getContentElements(doc);
    expect(contentEl.get('staticMarkup') as string).toContain('class="prose prose-lg"');
  });
});
