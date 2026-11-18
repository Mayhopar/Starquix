import { parse } from '@astrojs/compiler';

export interface SourcePosition {
  line: number;
  column: number;
}

/**
 * Map a data-key selector (e.g., "h1-0", "p-1") to a line:column position
 * in an .astro source file by parsing the AST and counting tag occurrences.
 *
 * The selector format is "tagName-index" where index is the 0-based occurrence
 * of that tag in document order (matching addKeysToMarkup behavior).
 */
export async function mapKeyToPosition(
  astroSource: string,
  selector: string
): Promise<SourcePosition | null> {
  const [pos] = await mapKeysToPositions(astroSource, [selector]);
  return pos ?? null;
}

/**
 * Resolve multiple selectors against the same source in a single AST parse.
 * Callers that batch (e.g. write-back's reorder branch) avoid N full parses
 * for N selectors. Returns positions aligned to `selectors`; nulls preserved.
 */
export async function mapKeysToPositions(
  astroSource: string,
  selectors: string[],
): Promise<Array<SourcePosition | null>> {
  if (selectors.length === 0) return [];

  const { ast } = await parse(astroSource, { position: true });

  // Astro AST splits `element` (lowercase HTML) from `component`
  // (PascalCase). Both stamp data-keys, so collect both.
  const positionsByTag = new Map<string, SourcePosition[]>();
  walkAst(ast, (node: any) => {
    if ((node.type === 'element' || node.type === 'component') && node.name) {
      const tag = node.name.toLowerCase();
      const pos = node.position?.start;
      if (pos) {
        let list = positionsByTag.get(tag);
        if (!list) { list = []; positionsByTag.set(tag, list); }
        list.push(pos);
      }
    }
    return undefined;
  });

  return selectors.map((selector) => {
    const match = selector.match(/^(\w+)-(\d+)$/);
    if (!match) return null;
    const list = positionsByTag.get(match[1].toLowerCase());
    if (!list) return null;
    return list[parseInt(match[2], 10)] || null;
  });
}

/** Tags a body-level reorder must leave alone: page plumbing the editor never
 *  keys as rows. The four Sq* names mirror EDITOR_INFRA_TAGS in
 *  app/src/utils/treeUtils.ts (kept in sync by the orderPermutation tests —
 *  vite-plugin code can't import app modules). */
const NON_SCANNABLE_TAGS = new Set([
  'script', 'style', 'link', 'meta', 'title', 'base', 'noscript',
  'sqhmrwritebridge', 'sqcomponentview', 'sqpostview', 'sqstubcontent',
]);

/**
 * The body's top-level scannable tags as data-key selectors (`tag-index`), in
 * document order — the server-side ground truth a positional reorder
 * (`orderPermutation`) resolves against. Occurrence indexes count EVERY
 * element/component of that name in document order, matching
 * mapKeysToPositions, so the returned selectors resolve right back.
 */
export async function topLevelBodySelectors(astroSource: string): Promise<string[] | null> {
  const { ast } = await parse(astroSource, { position: true });

  let body: any = null;
  walkAst(ast, (node: any) => {
    if (node.type === 'element' && node.name?.toLowerCase() === 'body' && !body) body = node;
    return undefined;
  });
  const container = body ?? ast;

  const counters = new Map<string, number>();
  const selectors: string[] = [];
  const visit = (node: any, parent: any) => {
    if ((node.type === 'element' || node.type === 'component') && node.name) {
      const tag = node.name.toLowerCase();
      const idx = counters.get(tag) ?? 0;
      counters.set(tag, idx + 1);
      if (parent === container && !NON_SCANNABLE_TAGS.has(tag)) selectors.push(`${tag}-${idx}`);
    }
    if (node.children) for (const child of node.children) visit(child, node);
    if (node.content) visit(node.content, node);
  };
  visit(ast, null);
  return selectors.length > 0 ? selectors : null;
}

function walkAst(node: any, visitor: (node: any) => SourcePosition | null | undefined): SourcePosition | null {
  const result = visitor(node);
  if (result) return result;

  if (node.children) {
    for (const child of node.children) {
      const childResult = walkAst(child, visitor);
      if (childResult) return childResult;
    }
  }
  if (node.content) {
    const contentResult = walkAst(node.content, visitor);
    if (contentResult) return contentResult;
  }
  return null;
}
