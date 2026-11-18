import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '@/store/commands';
import { selectPageComponents } from '@/store/selectors';
import { addDataKeysToHtml } from '@/store/constants';

const HEADER_PATH = 'src/components/library/Header.astro';
const SLOT_PATH = 'src/components/library/BlogSlot.astro';

function addPageWithRoot(doc: Y.Doc, pageId: string, rootId: string) {
  const page = new Y.Map<unknown>();
  page.set('name', 'Home');
  const rootIds = new Y.Array<string>();
  rootIds.push([rootId]);
  page.set('rootElementIds', rootIds);
  doc.getMap('pages').set(pageId, page);
}

function addRoot(doc: Y.Doc, id: string, astroSource: string, staticMarkup: string) {
  const el = new Y.Map<unknown>();
  el.set('id', id);
  el.set('pageId', 'page-1');
  el.set('astroSource', astroSource);
  el.set('staticMarkup', staticMarkup);
  doc.getMap('elements').set(id, el);
  addPageWithRoot(doc, 'page-1', id);
  return el;
}

describe('sq-child placeholder composition', () => {
  it('composes a matching child element at its <sq-child> placeholder', () => {
    const doc = new Y.Doc();
    addRoot(doc, 'el-post', 'library/BlogPost.astro',
      `<article><sq-child data-sq-astro-source="${HEADER_PATH}" data-sq-placement="header-0"></sq-child><main>body</main></article>`);
    const header = new Y.Map<unknown>();
    header.set('id', 'el-header');
    header.set('pageId', 'page-1');
    header.set('parentId', 'el-post');
    header.set('slotName', '');
    header.set('placementKey', 'header-0');
    header.set('astroSource', HEADER_PATH);
    header.set('staticMarkup', '<header class="p-4">Site</header>');
    doc.getMap('elements').set('el-header', header);

    const markup = selectPageComponents(doc, 'page-1').map((c) => c.staticMarkup).join('');
    expect(markup).toContain('<header');
    expect(markup).toContain('data-key="el-header:header-0"'); // stamped in the child id namespace
    expect(markup).not.toContain('sq-child');
  });

  it('placeholder with NO matching child element expands inline from masters', () => {
    const doc = new Y.Doc();
    addRoot(doc, 'el-post', SLOT_PATH,
      `<article><sq-child data-sq-astro-source="${HEADER_PATH}" data-sq-placement="header-0"></sq-child></article>`);
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: HEADER_PATH, markup: '<header class="p-4">Site</header>' });

    const markup = selectPageComponents(doc, 'page-1').map((c) => c.staticMarkup).join('');
    expect(markup).toContain('<header class="p-4">Site</header>');
    expect(markup).not.toContain('sq-child');
  });

  it('inline expansion applies the parent childOverrides', () => {
    const doc = new Y.Doc();
    addRoot(doc, 'el-slot', SLOT_PATH,
      `<section><sq-child data-sq-astro-source="${HEADER_PATH}" data-sq-placement="header-0"></sq-child></section>`);
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: HEADER_PATH, markup: '<header class="p-4">Site</header>' });
    applyCommand(doc, {
      type: 'SET_MASTER_MARKUP', astroSource: SLOT_PATH,
      markup: `<section><sq-child data-sq-astro-source="${HEADER_PATH}" data-sq-placement="header-0"></sq-child></section>`,
    });
    applyCommand(doc, {
      type: 'SET_MASTER_CHILD_OVERRIDES', astroSource: SLOT_PATH,
      placementKey: 'header-0', overrides: { 'header-0': { base: ['bg-white'] } },
    });

    const markup = selectPageComponents(doc, 'page-1').map((c) => c.staticMarkup).join('');
    expect(markup).toContain('class="bg-white"');
    expect(markup).not.toContain('p-4');
  });

  it('addDataKeysToHtml leaves <sq-child> intact (regression: half-matched tag got a key spliced MID-TAG)', () => {
    const html = `<section><sq-child data-sq-astro-source="${HEADER_PATH}" data-sq-placement="header-0"></sq-child></section>`;
    const out = addDataKeysToHtml(html, (sel) => `el-1:${sel}`);
    expect(out).toContain('<sq-child data-sq-astro-source=');
    expect(out).not.toContain('<sq data-key');
  });

  it('empty <slot> without children is left literal (existing behavior guard)', () => {
    const doc = new Y.Doc();
    addRoot(doc, 'el-slot', SLOT_PATH, '<section><slot name="posts"></slot></section>');
    const markup = selectPageComponents(doc, 'page-1').map((c) => c.staticMarkup).join('');
    expect(markup).toContain('<slot name="posts">');
  });

  // Regression (BlogPost master editor): a NON-slot placement child carries
  // slotName '' — that must NOT fill/replace the parent's default <slot>.
  // Before the fix the footer swallowed the content slot (first pass) AND
  // rendered a second time at its <sq-child> placeholder (second pass).
  it('non-slot placement child (slotName "") splices at its placeholder only — default <slot> survives, no double render', () => {
    const doc = new Y.Doc();
    addRoot(doc, 'el-post', 'library/BlogPost.astro',
      `<layout><slot ></slot><sq-child data-sq-astro-source="${HEADER_PATH}" data-sq-placement="footer-0"></sq-child></layout>`);
    const footer = new Y.Map<unknown>();
    footer.set('id', 'el-footer');
    footer.set('pageId', 'page-1');
    footer.set('parentId', 'el-post');
    footer.set('slotName', '');
    footer.set('placementKey', 'footer-0');
    footer.set('astroSource', HEADER_PATH);
    footer.set('staticMarkup', '<footer class="f">foot</footer>');
    doc.getMap('elements').set('el-footer', footer);

    const markup = selectPageComponents(doc, 'page-1').map((c) => c.staticMarkup).join('');
    expect(markup).toContain('<slot ></slot>'); // content slot preserved
    expect(markup.match(/<footer/g)?.length).toBe(1); // spliced exactly once
    expect(markup).not.toContain('sq-child');
    // Order: slot first, footer after — mirrors the source structure.
    expect(markup.indexOf('<slot')).toBeLessThan(markup.indexOf('<footer'));
  });

  // Slot-fallback children (placementKey === slot name) keep the original
  // semantics: they FILL their named slot in the first pass.
  it('slot-fallback child still fills its named slot', () => {
    const doc = new Y.Doc();
    addRoot(doc, 'el-slot', SLOT_PATH,
      `<section><slot name="posts"><sq-child data-sq-astro-source="${HEADER_PATH}" data-sq-placement="posts" data-sq-slot-fallback="posts"></sq-child></slot></section>`);
    const card = new Y.Map<unknown>();
    card.set('id', 'el-card');
    card.set('pageId', 'page-1');
    card.set('parentId', 'el-slot');
    card.set('slotName', 'posts');
    card.set('placementKey', 'posts');
    card.set('astroSource', HEADER_PATH);
    card.set('staticMarkup', '<div class="card">c</div>');
    doc.getMap('elements').set('el-card', card);

    const markup = selectPageComponents(doc, 'page-1').map((c) => c.staticMarkup).join('');
    expect(markup).toContain('class="card"');
    expect(markup.match(/class="card"/g)?.length).toBe(1);
    expect(markup).not.toContain('sq-child');
  });
});
