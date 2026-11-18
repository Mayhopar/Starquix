import type * as Y from 'yjs';
import { parse, HTMLElement } from 'node-html-parser';
import { applyAllOverrides } from '@/store/selectors';
import type { BlogSlotSettings } from '@/core/collections/types';
import { readDrawnElementClasses } from '@/core/collections/yjsAccessors';

export interface GenerateBlogSlotMarkupArgs {
  slotElement: Y.Map<unknown>;
  slotElementId: string;
  collectionName: string;
  cardComponentName: string;
  settings: BlogSlotSettings;
}

function sortCallback(sortBy: string): string {
  switch (sortBy) {
    case 'date-asc':
      return '(a, b) => new Date(a.data.date).getTime() - new Date(b.data.date).getTime()';
    case 'title-asc':
      return '(a, b) => a.data.title.localeCompare(b.data.title)';
    case 'title-desc':
      return '(a, b) => b.data.title.localeCompare(a.data.title)';
    default:
      return '(a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime()';
  }
}

function postsVar(collectionName: string): string {
  return `${collectionName.replace(/[^a-zA-Z0-9_$]/g, '_')}Posts`;
}

function layoutFallbackClasses(s: BlogSlotSettings): string {
  return s.layout === 'grid' ? `grid grid-cols-${s.columns} ${s.gap}` : `flex flex-col ${s.gap}`;
}

function renderCardExpression(args: {
  collectionName: string;
  cardComponentName: string;
  settings: BlogSlotSettings;
}): string {
  const cardElement =
    args.settings.postLinkMode === 'none'
      ? `<${args.cardComponentName} post={post} />`
      : `<a href={\`/${args.collectionName}/posts/\${post.id}\`} class="block"><${args.cardComponentName} post={post} /></a>`;

  return (
    `{[...${postsVar(args.collectionName)}]` +
    `.sort(${sortCallback(args.settings.sortBy)})` +
    `.slice(0, ${args.settings.postsPerPage})` +
    `.map((post) => (${cardElement}))}`
  );
}

/**
 * Find the innermost element whose direct children contain an <article>.
 * That's the "posts container" in the BlogSlot master markup.
 */
function findPostsContainer(root: HTMLElement): HTMLElement | null {
  // Walk depth-first; return the deepest element that has an <article> as a
  // direct child. If nested articles exist (article inside article), we still
  // want the outermost container — the deepest *non-article* with a direct
  // article child.
  let best: HTMLElement | null = null;

  function visit(node: HTMLElement): void {
    for (const child of node.childNodes) {
      if (child instanceof HTMLElement) visit(child);
    }
    if (node.rawTagName === 'article') return;
    const hasDirectArticleChild = node.childNodes.some(
      (c) => c instanceof HTMLElement && c.rawTagName === 'article',
    );
    if (hasDirectArticleChild) best = node;
  }

  visit(root);
  return best;
}

export function generateBlogSlotMarkup(args: GenerateBlogSlotMarkupArgs): string {
  const { slotElement, slotElementId, settings } = args;
  const raw = (slotElement.get('staticMarkup') as string) || '';
  const resolved = raw ? applyAllOverrides(raw, slotElement) : '';
  const expression = renderCardExpression(args);

  if (!resolved) {
    // Slot has no inline staticMarkup — reconstruct the BlogSlot.astro
    // structure from the drawn element tree. The outer <section> carries the
    // slot's own sourceClasses; the inner posts wrapper carries the `:posts`
    // drawn child's classes. Fall back to the master defaults when either is
    // empty so freshly dropped BlogSlots still style correctly.
    const doc = slotElement.doc;
    const slotClasses =
      (doc && readDrawnElementClasses(doc, slotElementId)) || 'bg-white';
    const postsClasses =
      (doc && readDrawnElementClasses(doc, `${slotElementId}:posts`)) ||
      `${layoutFallbackClasses(settings)} p-5`;
    return `<section class="${slotClasses}" data-component="BlogSlot" data-sq-source="${slotElementId}:1:1">
  <div class="${postsClasses}" data-key="${slotElementId}:posts">
    ${expression}
  </div>
</section>`;
  }

  const root = parse(resolved, { comment: false });
  const container = findPostsContainer(root);

  if (!container) {
    const outer = root.firstChild instanceof HTMLElement ? root.firstChild : null;
    if (outer) {
      outer.set_content('\n  __STARQUIX_POSTS_EXPRESSION__\n');
      return root.toString().replace('__STARQUIX_POSTS_EXPRESSION__', expression);
    }
    return `<section data-component="BlogSlot" data-sq-source="${slotElementId}:1:1">
  ${expression}
</section>`;
  }

  container.set_content('\n  __STARQUIX_POSTS_EXPRESSION__\n');

  const outer = root.firstChild instanceof HTMLElement ? root.firstChild : null;
  if (outer && !outer.getAttribute('data-sq-source')) {
    outer.setAttribute('data-sq-source', `${slotElementId}:1:1`);
  }
  if (outer && !outer.getAttribute('data-component')) {
    outer.setAttribute('data-component', 'BlogSlot');
  }

  return root.toString().replace('__STARQUIX_POSTS_EXPRESSION__', expression);
}
