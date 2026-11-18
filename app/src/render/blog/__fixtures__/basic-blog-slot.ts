import * as Y from 'yjs';

/**
 * Build a Yjs doc shaped like a minimal project with:
 * - one 'blog' collection, schema { title: string, date: date }
 * - one drawn BlogSlot bound to 'blog'
 * - one home page containing the slot
 *
 * Mirrors the shape produced by the real commands. When those commands change,
 * this helper must be updated — the test fails loudly in that case.
 */
export function buildBasicBlogSlotDoc(): Y.Doc {
  const doc = new Y.Doc();

  // Collection
  const collectionId = 'coll-blog';
  const collections = doc.getMap('contentCollections');
  const yColl = new Y.Map();
  yColl.set('id', collectionId);
  yColl.set('name', 'blog');
  const yFields = new Y.Array<Y.Map<unknown>>();
  const titleField = new Y.Map();
  titleField.set('name', 'title');
  titleField.set('type', 'text');
  titleField.set('required', true);
  const dateField = new Y.Map();
  dateField.set('name', 'date');
  dateField.set('type', 'date');
  dateField.set('required', true);
  yFields.push([titleField, dateField]);
  yColl.set('fields', yFields);
  collections.set(collectionId, yColl);

  // Page
  const pageId = 'page-home';
  const pages = doc.getMap('pages');
  const yPage = new Y.Map();
  yPage.set('name', 'Home');
  yPage.set('rootElementIds', Y.Array.from(['slot-1']));
  pages.set(pageId, yPage);

  // BlogSlot drawn element + :blogcard template child
  const elements = doc.getMap('elements');
  const yslot = new Y.Map();
  yslot.set('pageId', pageId);
  yslot.set('isDrawn', true);
  yslot.set('componentType', 'BlogSlot');
  yslot.set('slotType', 'blog');
  yslot.set(
    'staticMarkup',
    '<section class="bg-white"><div class="grid grid-cols-3 gap-4 p-5">' +
      '<article class="rounded-lg border border-gray-200">' +
      '<h3>{post.data.title}</h3>' +
      '</article>' +
      '</div></section>',
  );
  elements.set('slot-1', yslot);

  const ycard = new Y.Map();
  ycard.set('pageId', pageId);
  ycard.set('isDrawn', true);
  ycard.set('parentId', 'slot-1');
  ycard.set(
    'staticMarkup',
    '<article class="rounded-lg border border-gray-200"><h3>{title}</h3></article>',
  );
  elements.set('slot-1:blogcard', ycard);

  // Binding
  const bindings = doc.getMap('blogSlotBindings');
  const ybinding = new Y.Map();
  ybinding.set('collectionId', collectionId);
  const ysettings = new Y.Map();
  ysettings.set('postsPerPage', 9);
  ysettings.set('sortBy', 'date-desc');
  ysettings.set('layout', 'grid');
  ysettings.set('columns', 3);
  ysettings.set('gap', 'gap-4');
  ysettings.set('pagination', 'none');
  ysettings.set('postLinkMode', 'auto');
  ybinding.set('settings', ysettings);
  const ybindingsMap = new Y.Map();
  ybindingsMap.set('h3-0', 'title');
  ybinding.set('bindings', ybindingsMap);
  bindings.set('slot-1', ybinding);

  return doc;
}

/**
 * Build a doc with the task-028 REGULAR-INSTANCE blog model: a non-drawn
 * BlogSlot component instance plus a separate BlogCard child element
 * (parentId = slot id, slotName = 'posts') — the shape useBlogSlotMigration
 * and defaultChildren produce. The card child carries a classOverride
 * (bg-white on div-0) so tests can assert overrides reach generated output.
 */
export function buildInstanceBlogSlotDoc(): Y.Doc {
  const doc = buildBasicBlogSlotDoc();
  const elements = doc.getMap('elements');
  const bindings = doc.getMap('blogSlotBindings');

  // Remove the drawn-model slot + :blogcard and its binding.
  elements.delete('slot-1');
  elements.delete('slot-1:blogcard');
  bindings.delete('slot-1');

  // Regular-instance slot.
  const yslot = new Y.Map();
  yslot.set('id', 'el-slot-instance');
  yslot.set('pageId', 'page-home');
  yslot.set('parentId', null);
  yslot.set('type', 'component');
  yslot.set('instanceType', 'local');
  yslot.set('componentType', 'BlogSlot');
  yslot.set('astroSource', 'library/BlogSlot.astro');
  yslot.set('staticMarkup', '<section class="bg-stone-100"><div data-blog-source="posts"></div></section>');
  elements.set('el-slot-instance', yslot);

  // BlogCard child instance (the migration/defaultChildren shape).
  const ycard = new Y.Map();
  ycard.set('id', 'el-card-child');
  ycard.set('pageId', 'page-home');
  ycard.set('parentId', 'el-slot-instance');
  ycard.set('type', 'component');
  ycard.set('instanceType', 'local');
  ycard.set('componentType', 'BlogCard');
  ycard.set('slotName', 'posts');
  ycard.set('astroSource', 'library/BlogCard.astro');
  // Real card staticMarkup carries data-keys (createElementYMap → addKeysToMarkup);
  // applyOverridesToMarkup matches selectors against them.
  ycard.set(
    'staticMarkup',
    '<article data-key="el-card-child:article-0" class="rounded-lg bg-stone-400">' +
      '<div data-key="el-card-child:div-0" class="p-4 bg-neutral-400">' +
      '<h3 data-key="el-card-child:h3-0">{title}</h3></div></article>',
  );
  const yCO = new Y.Map();
  const ySel = new Y.Map();
  const yBase = new Y.Array<string>();
  yBase.push(['p-4', 'bg-white']);
  ySel.set('base', yBase);
  for (const bp of ['sm', 'md', 'lg', 'xl', '2xl']) ySel.set(bp, new Y.Array<string>());
  yCO.set('div-0', ySel);
  ycard.set('classOverrides', yCO);
  elements.set('el-card-child', ycard);

  // Binding keyed to the instance slot (same shape as the drawn fixture's).
  const ybinding = new Y.Map();
  ybinding.set('collectionId', 'coll-blog');
  const ysettings = new Y.Map();
  ysettings.set('postsPerPage', 9);
  ysettings.set('sortBy', 'date-desc');
  ysettings.set('layout', 'grid');
  ysettings.set('columns', 3);
  ysettings.set('gap', 'gap-4');
  ysettings.set('pagination', 'none');
  ysettings.set('postLinkMode', 'auto');
  ybinding.set('settings', ysettings);
  const ybindingsMap = new Y.Map();
  ybindingsMap.set('h3-0', 'title');
  ybinding.set('bindings', ybindingsMap);
  bindings.set('el-slot-instance', ybinding);

  const yPage = doc.getMap('pages').get('page-home') as Y.Map<unknown>;
  yPage.set('rootElementIds', Y.Array.from(['el-slot-instance']));

  return doc;
}

/**
 * Adds a designed post page to the doc: pageType='post' bound to 'coll-blog',
 * wrapped in a BlogPost instance (mirrors wrapPostPageInBlogPost output) with
 * an article child (frontmatter title binding) and a collection-content
 * element (the markdown body slot — selectPostPageRenderData synthesizes the
 * 'body' binding from it).
 */
export function addDesignedPostPage(doc: Y.Doc): void {
  const pages = doc.getMap('pages');
  const yPage = new Y.Map();
  yPage.set('id', 'page-post');
  yPage.set('name', 'Post Page');
  yPage.set('pageType', 'post');
  yPage.set('collectionId', 'coll-blog');
  yPage.set('rootElementIds', Y.Array.from(['pp-wrapper']));
  pages.set('page-post', yPage);

  const elements = doc.getMap('elements');
  const wrapper = new Y.Map();
  wrapper.set('id', 'pp-wrapper');
  wrapper.set('pageId', 'page-post');
  wrapper.set('type', 'component');
  wrapper.set('componentType', 'BlogPost');
  wrapper.set('astroSource', 'library/BlogPost.astro');
  wrapper.set('staticMarkup', '<layout><header>chrome</header><slot /><footer>chrome</footer></layout>');
  elements.set('pp-wrapper', wrapper);

  const article = new Y.Map();
  article.set('id', 'pp-article');
  article.set('pageId', 'page-post');
  article.set('parentId', 'pp-wrapper');
  article.set('staticMarkup',
    '<article data-key="pp-article:article-0" class="post-shell mx-auto max-w-3xl px-4 py-12">' +
    '<h1 data-key="pp-article:h1-0" class="text-4xl font-bold">Designed title</h1>' +
    '</article>');
  elements.set('pp-article', article);

  const content = new Y.Map();
  content.set('id', 'pp-content');
  content.set('pageId', 'page-post');
  content.set('parentId', 'pp-wrapper');
  content.set('bindingType', 'collection-content');
  content.set('staticMarkup',
    '<div data-key="pp-content:div-0" data-sq-slot name="content" class="prose prose-stone">placeholder</div>');
  elements.set('pp-content', content);

  const ppb = doc.getMap('postPageBindings');
  const binding = new Y.Map();
  binding.set('collectionId', 'coll-blog');
  const b = new Y.Map();
  b.set('pp-article:h1-0', 'title');
  binding.set('bindings', b);
  ppb.set('page-post', binding);
}

/** The markdown bodies that would be written to disk by the user. */
export function basicBlogSlotMarkdownFiles(): Record<string, string> {
  return {
    'src/content/blog/hello.md': '---\ntitle: "Hello"\ndate: 2026-04-01\n---\nBody of hello.',
    'src/content/blog/world.md': '---\ntitle: "World"\ndate: 2026-04-02\n---\nBody of world.',
  };
}
