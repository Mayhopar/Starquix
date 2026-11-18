import { markdownToHtml } from './markdownToHtml';
import { parsePostBody, isEsmBlock, type PostBlock } from '@/postmodel/postModel';

/**
 * Fallback body HTML for a post whose REAL Astro render is not available yet
 * (or at all): the preview server is still booting or the post-view route
 * errored.
 *
 * `marked` is a MARKDOWN parser. Handing it an .mdx body prints the parts it
 * does not understand VERBATIM — the owner saw their post page rendering
 *
 *     import Media from '../../components/Media.astro';
 *     <Media items={["/uploads/7bb955a8-....jpg"]} class="col-span-8" />
 *
 * as page copy (2026-08-12). Source code is never a correct thing to show on a
 * rendered page, fallback or not.
 *
 * The block split comes from parsePostBody — the SAME mdast/MDX parse the
 * editor and the write queue use, so this can never disagree with them about
 * where a component starts. A first cut hand-rolled two line-anchored regexes
 * instead and was wrong three ways, all reproduced: it deleted `import` lines
 * from inside ```js fences and replaced the sample with a placeholder, it
 * emitted one placeholder per tag so `<Wrapper>`+2 children became 3, and it
 * never matched a multi-line invocation at all — leaving the exact source leak
 * it was written to stop. A real grammar tokenizes fences and elements first
 * and cannot make any of those mistakes.
 */

/** A component needs the MDX pipeline, which is precisely what is missing. */
const PLACEHOLDER =
  '<div data-sq-mdx-placeholder class="sq-mdx-placeholder" ' +
  'style="min-height:6rem;border:1px dashed currentColor;opacity:.35;' +
  'border-radius:.5rem;margin:1rem 0"></div>';

/**
 * Markdown → HTML for the canvas post-body preview, MDX-safe.
 * A plain-Markdown body has no component and no ESM block, so every block
 * falls through to markdownToHtml and the output matches it.
 */
export function postBodyFallbackHtml(body: string): string {
  let parsed;
  try {
    parsed = parsePostBody(body ?? '', 'mdx');
  } catch {
    // An unparseable body still must not print as source: markdown-only is the
    // safe floor (it escapes JSX rather than executing it, and shows no import
    // line that a real render would have consumed).
    return markdownToHtml(body ?? '');
  }

  const render = (blocks: PostBlock[]): string => blocks
    .map(block => {
      if (block.kind === 'component') return PLACEHOLDER;
      // a layout renders its children — never its JSX tags
      if (block.kind === 'stack') return block.slots.map(render).join('');
      // ESM imports/exports are consumed by the MDX pipeline and never render.
      if (isEsmBlock(block)) return '';
      return markdownToHtml(block.source);
    })
    .join('');
  return render(parsed.blocks);
}
