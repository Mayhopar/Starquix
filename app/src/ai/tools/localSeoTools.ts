/**
 * read_page_seo / update_page_seo on the files-truth runtime: the same engine
 * as the SEO tab (store/seo/headSeo), so the AI, MCP and the panel read and
 * write the page's SEO where it lives — the page's <head>, or its layout's
 * props — as one durable batch with one ⌘Z. Any page, not only the open one.
 */
import { fetchLocalPages } from '@/utils/localPageSync';
import { dynamicRoutePattern, localPageId } from '@/utils/localMode';
import { PAGE_SEO_FIELDS, isEntryRoute, type PageSeoField, type PostRef } from '@/store/seo/headSeo';
import { loadPageSeo, resolvePostRef, savePageSeo } from '@/store/seo/seoFiles';
import { scorePageSeo } from '@/store/seo/pageSeoScore';
import type { ToolExecutionContext } from './commandTools';
import { fail, localProjectPathOf } from './localToolUtils';

/** pageId (a doc page id, or a route) → the page file, and on a post route the post it shows. */
async function pageFileFor(ctx: ToolExecutionContext, pageId: string): Promise<{ route: string; file: string; post: PostRef | null } | null> {
  const path = localProjectPathOf(ctx);
  if (!path) return null;
  const pages = await fetchLocalPages(path);
  const docPage = ctx.doc.getMap('pages').get(pageId) as { get?: (k: string) => unknown } | undefined;
  const route = pageId.startsWith('/') ? pageId : (typeof docPage?.get?.('name') === 'string' ? docPage.get!('name') as string : null);
  const exact = pages.find((p) => localPageId(p.route) === pageId || (route !== null && p.route === route));
  if (exact && !isEntryRoute(exact.file)) return { ...exact, post: null };
  const concrete = route ?? exact?.route ?? null;
  const dynamic = concrete ? pages.find((p) => isEntryRoute(p.file) && dynamicRoutePattern(p.route).test(concrete)) : undefined;
  if (!dynamic || !concrete) return null;
  return { route: concrete, file: dynamic.file, post: await resolvePostRef(concrete) };
}

export const LOCAL_SEO_HANDLERS: Record<string, (ctx: ToolExecutionContext, params: Record<string, unknown>) => Promise<unknown>> = {
  read_page_seo: async (ctx, params) => {
    const page = await pageFileFor(ctx, String(params.pageId ?? ''));
    if (!page) return { error: `Page "${params.pageId}" not found — list_files src/pages or read the pages tree for ids.` };
    const state = await loadPageSeo(page.file, page.post);
    const score = scorePageSeo(state);
    return {
      route: page.route,
      file: page.file,
      ...(page.post ? { post: page.post.file } : {}),
      headFile: state.headFile,
      layoutFile: state.layoutFile,
      ...(state.problem ? { problem: state.problem } : {}),
      fields: Object.fromEntries(PAGE_SEO_FIELDS.map((k) => {
        const f = state.fields[k];
        return [k, {
          value: f.value,
          ...(f.placeholder ? { inherits: f.placeholder } : {}),
          ...(f.editable ? {} : { readOnly: f.setIn ? `${f.setIn.reason} (${f.setIn.file}:${f.setIn.line})` : true }),
          ...(f.duplicateIn ? { duplicateIn: f.duplicateIn } : {}),
        }];
      })),
      completeness: { percentage: score.percentage, todo: score.todo.map((t) => t.label) },
    };
  },
  update_page_seo: async (ctx, params) => {
    const field = params.field as PageSeoField;
    if (!PAGE_SEO_FIELDS.includes(field)) return fail(`update_page_seo failed: field must be one of ${PAGE_SEO_FIELDS.join(', ')}.`);
    const page = await pageFileFor(ctx, String(params.pageId ?? ''));
    if (!page) return fail(`update_page_seo failed: page "${params.pageId}" not found.`);
    const raw = params.value;
    const value = field === 'noindex' ? raw === true || raw === 'true' : raw == null ? '' : String(raw);
    try {
      ctx.takeSnapshot();
      const written = await savePageSeo(page.file, field, value, ctx.claimSnapshot?.(), page.post);
      return written.length
        ? { success: true, message: `${field} of ${page.route} written to ${written.join(' + ')}` }
        : { success: true, message: `${field} of ${page.route} unchanged` };
    } catch (error) {
      return fail(`update_page_seo failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
};
