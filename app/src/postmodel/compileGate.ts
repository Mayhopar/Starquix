/**
 * Binding law #3: validate the body's own source format before writing.
 * Markdown permits raw HTML/comments that the MDX compiler must refuse.
 */
import { compile } from '@mdx-js/mdx';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import { parsePostBody, type PostFormat } from './postModel';

export async function mdxCompiles(body: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return postCompiles(body, 'mdx');
}

export async function postCompiles(body: string, format: PostFormat): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (format === 'md') parsePostBody(body, 'md');
    else await compile(body, { remarkPlugins: [remarkGfm, remarkFrontmatter] });
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // tsc lib < es2022 has no Error.cause; the runtime value is there (acorn detail)
    const cause = (e as { cause?: unknown }).cause;
    const detail = cause instanceof Error ? `: ${cause.message}` : '';
    return { ok: false, error: message + detail };
  }
}
