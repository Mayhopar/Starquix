import { escapeHtml } from '@/utils/escapeHtml';

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img',
  'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

interface DrawnNode {
  key: string;
  tag: string;
  classes: string;
  textContent: string;
  parentKey: string | null;
  /** Vector shapes: inline SVG markup emitted raw for non-slot leaves (task-106). */
  staticMarkup?: string;
  /** Slots carry staticMarkup for live render only — never serialized here. */
  slotType?: string;
}

// `extraAttr` is the leading-space-prefixed attribute string applied ONLY to the
// element rendered at this call (never propagated to children). serializeDrawnTree
// passes it for the root so the bake path can stamp `data-sq-drawn` there.
//
// CONSTRAINT (task-133 Task 7 review): textContent is escaped for HTML but NOT
// for Astro `{}` expressions — a literal `{` in emitted text is parsed as an
// expression when the output lands in a .astro file (export/bake paths
// included). serializeDrawnPayload brace-escapes on top of this for the local
// draw path; any caller feeding USER-AUTHORED text into a .astro destination
// (Task 9 AI drawn tool) must do the same or reuse serializeDrawnPayload.
function renderNode(node: DrawnNode, childrenByParent: Map<string, DrawnNode[]>, depth: number, extraAttr = ''): string {
  const indent = '  '.repeat(depth);
  const classAttr = node.classes ? ` class="${node.classes}"` : '';
  const attrs = `${classAttr}${extraAttr}`;

  if (VOID_ELEMENTS.has(node.tag)) {
    return `${indent}<${node.tag}${attrs} />`;
  }

  const children = childrenByParent.get(node.key) || [];

  if (children.length === 0) {
    if (node.staticMarkup && !node.slotType) {
      return `${indent}<${node.tag}${attrs}>${node.staticMarkup}</${node.tag}>`;
    }
    const text = node.textContent ? escapeHtml(node.textContent) : '';
    return `${indent}<${node.tag}${attrs}>${text}</${node.tag}>`;
  }

  const childLines = children.map(child => renderNode(child, childrenByParent, depth + 1));

  const childIndent = '  '.repeat(depth + 1);
  const textLine = node.textContent ? `${childIndent}${escapeHtml(node.textContent)}` : '';

  const inner = textLine
    ? [textLine, ...childLines].join('\n')
    : childLines.join('\n');

  return `${indent}<${node.tag}${attrs}>\n${inner}\n${indent}</${node.tag}>`;
}

/**
 * Serialize a drawn element subtree to HTML. `opts.markRoot` stamps the root with
 * `data-sq-drawn="<rootKey>"` — used ONLY by the component-editor bake path so the
 * source mirror can later reconcile (strip + re-insert) drawn regions. Export and
 * Make Component omit it (default false) → their output stays byte-identical.
 */
export function serializeDrawnTree(
  elements: DrawnNode[],
  rootKey: string,
  opts?: { markRoot?: boolean },
): string {
  const root = elements.find(e => e.key === rootKey);
  if (!root) return '';

  const childrenByParent = new Map<string, DrawnNode[]>();
  for (const el of elements) {
    if (el.parentKey) {
      const siblings = childrenByParent.get(el.parentKey) || [];
      siblings.push(el);
      childrenByParent.set(el.parentKey, siblings);
    }
  }

  const rootAttr = opts?.markRoot ? ` data-sq-drawn="${escapeHtml(rootKey)}"` : '';
  return renderNode(root, childrenByParent, 0, rootAttr);
}

/**
 * task-133 Task 7: serialize the ONE just-drawn element (local files-truth
 * runtime — the payload never enters the doc, so there is no elements map to
 * read from). Wraps the draw payload as a transient single-node tree; no
 * markRoot — the output is plain page markup, not a reconcilable drawn region.
 * penPath is intentionally NOT serialized: the file carries only the derived
 * staticMarkup (re-edit anchors don't survive materialization).
 *
 * Astro brace escaping: the output lands DIRECTLY in .astro text position,
 * where `{` opens an expression — braces in textContent are entity-escaped
 * (`&#123;`/`&#125;`) AFTER the HTML escaping (order matters: escapeHtml
 * would double-escape a pre-inserted entity's `&`). The replace runs on the
 * serialized string, which is safe here because the single node's tag/classes
 * never contain braces and a brace-entity inside a quoted attribute decodes
 * identically anyway. staticMarkup passthrough is NOT brace-escaped — it is
 * generated shape/pen markup (buildShape/buildPenMarkup), never user text.
 */
export function serializeDrawnPayload(payload: {
  tag: string;
  classes: string;
  textContent: string;
  staticMarkup?: string;
}): string {
  const node: DrawnNode = {
    key: '__local_draw__',
    tag: payload.tag,
    classes: payload.classes,
    textContent: payload.textContent,
    parentKey: null,
    staticMarkup: payload.staticMarkup,
  };
  const html = serializeDrawnTree([node], node.key);
  if (payload.staticMarkup) return html;
  return html.replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
}

export function generateComponentName(tag: string, existingNames: string[]): string {
  const base = tag.charAt(0).toUpperCase() + tag.slice(1);
  if (!existingNames.includes(base)) return base;

  let i = 2;
  while (existingNames.includes(`${base}${i}`)) i++;
  return `${base}${i}`;
}
