/**
 * task-028 — dropping a BlogSlot into a page auto-creates the BlogCard
 * ("posts" slot) and BlogPaginationNumbered ("pagination" slot) children
 * as real Yjs elements. The hint that drives this comes from BlogSlot.astro's
 * `@default-children` frontmatter marker, parsed by extractDefaultChildren,
 * carried as ScannedComponent.defaultChildren, and materialised by
 * buildAddCommand → ADD_ELEMENT's defaultChildren handler.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { buildAddCommand } from '../addCommandFactory';
import { extractDefaultChildren } from '@/vite-plugin/component-discovery';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';

const PAGE_ID = 'page-blog-drop';

function setupDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const pages = doc.getMap('pages');
    const yPage = new Y.Map();
    yPage.set('id', PAGE_ID);
    yPage.set('name', 'Home');
    yPage.set('rootElementIds', new Y.Array());
    yPage.set('children', new Y.Array());
    pages.set(PAGE_ID, yPage);
  }, 'sync');
  return doc;
}

function childrenOf(doc: Y.Doc, parentId: string) {
  const out: Array<Y.Map<unknown>> = [];
  doc.getMap<Y.Map<unknown>>('elements').forEach((el) => {
    if (el.get('parentId') === parentId) out.push(el);
  });
  return out;
}

describe('task-028: BlogSlot drop materialises default children', () => {
  it('extractDefaultChildren parses the @default-children frontmatter marker', () => {
    const content = `---
/**
 * @category Blog
 * @name BlogSlot
 * @default-children BlogCard:posts, BlogPaginationNumbered:pagination
 */
---
<section />`;
    expect(extractDefaultChildren(content)).toEqual([
      { name: 'BlogCard', slotName: 'posts' },
      { name: 'BlogPaginationNumbered', slotName: 'pagination' },
    ]);
  });

  it('extractDefaultChildren returns [] when marker is absent', () => {
    expect(extractDefaultChildren('---\n---\n<section />')).toEqual([]);
  });

  it('extractDefaultChildren handles a child without a slot (default slot)', () => {
    const content = `---
/**
 * @default-children BlogCard
 */
---`;
    expect(extractDefaultChildren(content)).toEqual([
      { name: 'BlogCard', slotName: undefined },
    ]);
  });

  it('buildAddCommand carries defaultChildren resolved from the library', () => {
    const blogSlot: ScannedComponent = {
      name: 'BlogSlot',
      path: 'src/components/library/BlogSlot.astro',
      source: 'built-in',
      html: '<section><slot name="posts"></slot><slot name="pagination"></slot></section>',
      category: 'Blog',
      props: [],
      slots: ['posts', 'pagination'],
      dependencies: [],
      defaultChildren: [
        { name: 'BlogCard', slotName: 'posts' },
        { name: 'BlogPaginationNumbered', slotName: 'pagination' },
      ],
    } as ScannedComponent;

    const library: ScannedComponent[] = [
      {
        name: 'BlogCard',
        path: 'src/components/library/BlogCard.astro',
        source: 'built-in',
        html: '<article data-comp="BlogCard">card</article>',
        category: 'Blog',
        props: [], slots: [], dependencies: [],
      } as ScannedComponent,
      {
        name: 'BlogPaginationNumbered',
        path: 'src/components/library/BlogPaginationNumbered.astro',
        source: 'built-in',
        html: '<nav data-comp="BlogPaginationNumbered">pag</nav>',
        category: 'Blog',
        props: [], slots: [], dependencies: [],
      } as ScannedComponent,
      blogSlot,
    ];

    const doc = setupDoc();
    doc.transact(() => {
      applyCommand(doc, buildAddCommand({
        elementId: 'el-slot',
        pageId: PAGE_ID,
        component: blogSlot,
        parentId: null,
        index: 0,
        resolveComponent: (name) => library.find((c) => c.name === name),
      }));
    }, 'sync');

    const children = childrenOf(doc, 'el-slot');
    const tagged = children
      .map((c) => `${c.get('componentType')}@${c.get('slotName')}`)
      .sort();
    expect(tagged).toEqual(['BlogCard@posts', 'BlogPaginationNumbered@pagination']);

    // Each child carries its own astroSource so reset/push/codegen work.
    const card = children.find((c) => c.get('componentType') === 'BlogCard');
    expect(card?.get('astroSource')).toBe('src/components/library/BlogCard.astro');
    // staticMarkup is keyed with the child's own id.
    expect(card?.get('staticMarkup') as string).toContain(`data-key="${card?.get('id')}:`);
  });
});
