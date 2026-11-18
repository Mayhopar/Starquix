function sortExpression(sortBy: string): string {
  switch (sortBy) {
    case 'date-asc':  return 'posts.sort((a, b) => new Date(a.data.date).getTime() - new Date(b.data.date).getTime());';
    case 'title-asc': return 'posts.sort((a, b) => a.data.title.localeCompare(b.data.title));';
    case 'title-desc':return 'posts.sort((a, b) => b.data.title.localeCompare(a.data.title));';
    default:          return 'posts.sort((a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime());';
  }
}

function layoutClasses(layout: string, columns: number, gap: string): string {
  return layout === 'grid'
    ? `grid grid-cols-${columns} ${gap}`
    : `flex flex-col ${gap}`;
}

export interface ListingPageOptions {
  collectionName: string;
  cardComponentPath: string;
  settings: {
    postsPerPage: number;
    sortBy: string;
    pagination: 'none' | 'numbered' | 'load-more';
    layout: string;
    columns: number;
    gap: string;
  };
  paginationMarkup?: string;
}

export function generateListingPage(opts: ListingPageOptions): string {
  const { collectionName, cardComponentPath, settings } = opts;
  const sort = sortExpression(settings.sortBy);
  const classes = layoutClasses(settings.layout, settings.columns, settings.gap);

  if (settings.pagination === 'none') {
    return `---
import Layout from '../../layouts/Layout.astro';
import { getCollection } from 'astro:content';
import BlogCard from '${cardComponentPath}';

const posts = await getCollection('${collectionName}', ({ data }) => !data.draft);
${sort}
const visible = posts.slice(0, ${settings.postsPerPage});
---
<Layout title="${collectionName}">
  <div class="${classes}">
    {visible.map(post => <BlogCard post={post} />)}
  </div>
</Layout>`;
  }

  if (settings.pagination === 'numbered') {
    const navMarkup = opts.paginationMarkup
      ? opts.paginationMarkup
      : `<nav aria-label="Pagination" class="flex items-center justify-center gap-2 mt-8">
    <a class="px-3 py-2 text-sm rounded border border-gray-300 hover:bg-gray-100">Previous</a>
    <a class="px-3 py-2 text-sm rounded border bg-gray-900 text-white border-gray-900">1</a>
    <a class="px-3 py-2 text-sm rounded border border-gray-300 hover:bg-gray-100">2</a>
    <a class="px-3 py-2 text-sm rounded border border-gray-300 hover:bg-gray-100">3</a>
    <a class="px-3 py-2 text-sm rounded border border-gray-300 hover:bg-gray-100">Next</a>
  </nav>`;

    return `---
import Layout from '../../layouts/Layout.astro';
import { getCollection } from 'astro:content';
import BlogCard from '${cardComponentPath}';

export async function getStaticPaths({ paginate }) {
  const posts = await getCollection('${collectionName}', ({ data }) => !data.draft);
  ${sort}
  return paginate(posts, { pageSize: ${settings.postsPerPage} });
}

const { page } = Astro.props;
---
<Layout title="${collectionName}">
  <div class="${classes}">
    {page.data.map(post => <BlogCard post={post} />)}
  </div>

  ${navMarkup}
</Layout>`;
  }

  if (settings.pagination === 'load-more') {
    return `---
import Layout from '../../layouts/Layout.astro';
import { getCollection } from 'astro:content';
import BlogCard from '${cardComponentPath}';

export async function getStaticPaths({ paginate }) {
  const posts = await getCollection('${collectionName}', ({ data }) => !data.draft);
  ${sort}
  return paginate(posts, { pageSize: ${settings.postsPerPage} });
}

const { page } = Astro.props;
---
<Layout title="${collectionName}">
  <div id="posts-container" class="${classes}">
    {page.data.map(post => <BlogCard post={post} />)}
  </div>

${opts.paginationMarkup
      ? opts.paginationMarkup
      : `<div class="flex justify-center mt-8">
  {page.url.next ? (
    <a href={page.url.next} id="load-more-link" class="px-6 py-3 text-sm rounded border border-gray-300 hover:bg-gray-100">
      Load more
    </a>
  ) : null}
</div>`}

<div role="status" aria-live="polite" class="sr-only" id="load-status"></div>

<script define:vars={{ apiBase: \`/api/${collectionName}\`, pageSize: ${settings.postsPerPage}, totalPages: page.lastPage, currentPage: page.currentPage }}>
  (function() {
    const link = document.getElementById('load-more-link');
    if (!link) return;

    let nextPage = currentPage;
    let prefetched = null;
    const container = document.getElementById('posts-container');
    const status = document.getElementById('load-status');

    // Replace <a> with <button> (progressive enhancement)
    const btn = document.createElement('button');
    btn.textContent = 'Load more';
    btn.className = link.className;
    btn.type = 'button';
    link.replaceWith(btn);

    // Prefetch next page JSON
    function prefetchNext() {
      if (nextPage < totalPages) {
        prefetched = fetch(apiBase + '/' + nextPage + '.json').then(r => r.json());
      }
    }
    prefetchNext();

    btn.addEventListener('click', async function() {
      if (nextPage >= totalPages) return;

      btn.disabled = true;
      btn.textContent = 'Loading...';
      status.textContent = 'Loading more posts...';

      try {
        const data = prefetched ? await prefetched : await fetch(apiBase + '/' + nextPage + '.json').then(r => r.json());
        prefetched = null;
        nextPage++;

        // Create cards from JSON data
        const fragment = document.createDocumentFragment();
        let firstNew = null;
        data.posts.forEach(function(post) {
          const card = document.createElement('article');
          card.className = 'blog-card';
          card.tabIndex = -1;
          card.innerHTML = '<h3>' + (post.title || '') + '</h3>'
            + (post.thumbnail ? '<img src="' + post.thumbnail + '" alt="' + (post.title || '') + '" loading="lazy" />' : '')
            + '<p>' + (post.description || '') + '</p>';
          if (!firstNew) firstNew = card;
          fragment.appendChild(card);
        });
        container.appendChild(fragment);

        // Focus management (BBC GEL pattern)
        if (firstNew) firstNew.focus();
        status.textContent = data.posts.length + ' more posts loaded';

        // Hide button if no more pages
        if (!data.hasMore) {
          btn.remove();
          status.textContent = 'All posts loaded';
        } else {
          btn.disabled = false;
          btn.textContent = 'Load more';
          prefetchNext();
        }
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Load more';
        status.textContent = 'Failed to load posts. Try again.';
      }
    });
  })();
</script>
</Layout>`;
  }

  return '';
}

export function generateJsonEndpoint(
  collectionName: string,
  postsPerPage: number,
  sortBy: string,
): string {
  const sort = sortExpression(sortBy);

  return `import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';

const PAGE_SIZE = ${postsPerPage};

export const getStaticPaths: GetStaticPaths = async () => {
  const posts = await getCollection('${collectionName}', ({ data }) => !data.draft);
  const totalPages = Math.ceil(posts.length / PAGE_SIZE);
  return Array.from({ length: totalPages }, (_, i) => ({
    params: { page: String(i) },
  }));
};

export const GET: APIRoute = async ({ params }) => {
  const posts = await getCollection('${collectionName}', ({ data }) => !data.draft);
  ${sort}
  const page = parseInt(params.page!);
  const start = page * PAGE_SIZE;
  const slice = posts.slice(start, start + PAGE_SIZE);

  return new Response(JSON.stringify({
    posts: slice.map(p => ({ slug: p.id, ...p.data })),
    hasMore: start + PAGE_SIZE < posts.length,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};`;
}

export function generateCardTemplate(
  collectionName: string,
  bindings: Record<string, string>,
  templateMarkup: string,
): string {
  let markup = templateMarkup;
  for (const [_elementKey, fieldName] of Object.entries(bindings)) {
    markup = markup.replace(
      new RegExp(`\\{${fieldName}\\}`, 'g'),
      `{post.data.${fieldName}}`
    );
  }

  return `---
const { post } = Astro.props;
---
${markup}`;
}

export interface PostPageOptions {
  collectionName: string;
  /** User-designed HTML layout with field binding placeholders */
  layoutMarkup: string;
  /** Map of data-key → field name */
  bindings: Record<string, string>;
}

export function generatePostPage(opts: PostPageOptions): string {
  const { collectionName, layoutMarkup, bindings } = opts;

  // Replace the inner HTML of body-bound elements with <Content />. Earlier
  // versions injected `set:html={renderedContent}` as an attribute, but
  // `renderedContent` was never declared in frontmatter — the resulting
  // Astro file failed to build. Matching the same pattern `generateDetailPage`
  // uses (Content as a child, not an attribute) is what actually compiles.
  let markup = layoutMarkup;
  for (const [key, fieldName] of Object.entries(bindings)) {
    const re = new RegExp(
      `(<[a-z][a-z0-9]*\\b[^>]*\\bdata-key="${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>)[\\s\\S]*?(</[a-z][a-z0-9]*>)`,
      'i',
    );
    if (fieldName === 'body') {
      // Strip editor-only attrs (data-sq-slot, name="…") from the matched
      // opening tag — they are junk in the generated production .astro.
      markup = markup.replace(re, (_full, open: string, close: string) =>
        `${open.replace(/\s+data-sq-slot\b/g, '').replace(/\s+name="[^"]*"/g, '')}<Content />${close}`);
    } else {
      // Frontmatter field binding: design-time placeholder text would
      // otherwise ship verbatim (the canvas shows real values via Phase 6).
      markup = markup.replace(re, (_full, open: string, close: string) =>
        `${open}{entry.data.${fieldName}}${close}`);
    }
  }

  // Phase 2 will replace the wrap body with a typed content-slot binding;
  // the wrapping point stays the same.
  // See docs/archive/plans/2026-05-11-pages-in-assets-design.md.
  return `---
import BlogPost from '../../../components/library/BlogPost.astro';
import { getCollection, render } from 'astro:content';

export async function getStaticPaths() {
  const posts = await getCollection('${collectionName}', ({ data }) => !data.draft);
  return posts.map(entry => ({
    params: { slug: entry.id },
    props: { entry },
  }));
}

// SSR fallback (WC preview runs output:'server', where getStaticPaths is
// ignored and Astro.props is empty — every detail page 500'd without this).
let entry = Astro.props.entry;
if (!entry) {
  const posts = await getCollection('${collectionName}', ({ data }) => !data.draft);
  entry = posts.find(p => p.id === Astro.params.slug || p.slug === Astro.params.slug);
  if (!entry) return new Response(null, { status: 404 });
}
const { Content } = await render(entry);
---
<BlogPost title={entry.data.title}>
${markup}
</BlogPost>
`;
}

export function generateDetailPage(collectionName: string): string {
  // Detail page lives at src/pages/{coll}/posts/[...slug].astro → 3 levels
  // deep under src/pages, so Layout import goes up three segments.
  return `---
import Layout from '../../../layouts/Layout.astro';
import { getCollection, render } from 'astro:content';

export async function getStaticPaths() {
  const posts = await getCollection('${collectionName}', ({ data }) => !data.draft);
  return posts.map(post => ({
    params: { slug: post.id },
    props: { post },
  }));
}

// SSR fallback (WC preview runs output:'server', where getStaticPaths is
// ignored and Astro.props is empty — every detail page 500'd without this).
let post = Astro.props.post;
if (!post) {
  const posts = await getCollection('${collectionName}', ({ data }) => !data.draft);
  post = posts.find(p => p.id === Astro.params.slug || p.slug === Astro.params.slug);
  if (!post) return new Response(null, { status: 404 });
}
const { Content } = await render(post);
---
<Layout title={post.data.title}>
  <article class="prose prose-stone mx-auto max-w-3xl px-4 py-12">
    <h1 class="text-4xl font-bold mb-4">{post.data.title}</h1>
    {post.data.thumbnail && <img src={post.data.thumbnail} alt={post.data.title} class="w-full h-auto rounded-lg mb-6" />}
    <time class="text-gray-500 text-sm block mb-6">{post.data.date}</time>
    <Content />
  </article>
</Layout>`;
}

