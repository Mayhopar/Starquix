/**
 * Instance override props (app/src/utils/propOverrides.ts) — the ONE parser and
 * formatter of their source shapes, shared by the tagger, the source writers
 * and the editor:
 *   value form   {Astro.props.X ?? "lit"}   (an attribute value or element content)
 *   markup form  {Astro.props.X ? <Fragment set:html={Astro.props.X} /> : <>markup</>}
 * Plain JS: it runs inside the user's Astro instance too.
 */
const IDENT = '[A-Za-z_$][\\w$]*';
const VALUE_FORM = new RegExp(`^\\s*\\{\\s*Astro\\.props\\.(${IDENT})\\s*(?:\\?\\?\\s*([\\s\\S]*?))?\\s*\\}\\s*$`);
const MARKUP_FORM = new RegExp(`^\\s*\\{\\s*Astro\\.props\\.(${IDENT})\\s*\\?\\s*<Fragment set:html=\\{Astro\\.props\\.\\1\\}\\s*\\/>\\s*:\\s*<>([\\s\\S]*)<\\/>\\s*\\}\\s*$`);
const STRING_LIT = /^(["'`])((?:\\.|(?!\1)[^\\])*)\1$/;

/** A JS string literal's value (no template substitutions), else null. */
export function literalValue(expr) {
  const m = expr ? STRING_LIT.exec(expr.trim()) : null;
  if (!m || (m[1] === '`' && m[2].includes('${'))) return null;
  try { return m[1] === '"' ? JSON.parse(`"${m[2]}"`) : JSON.parse(`"${m[2].replace(/\\(['`])/g, '$1').replace(/"/g, '\\"')}"`); }
  catch { return null; }
}

/**
 * `{Astro.props.X ?? fallback}` (braces included) → `{ prop, fallback, literal }`:
 * `fallback` = the raw expression (undefined when absent), `literal` = its string
 * value ('' when absent, null when it is not a plain literal). Null = not this shape.
 */
export function parseValueForm(text) {
  const m = VALUE_FORM.exec(text || '');
  return m ? { prop: m[1], fallback: m[2], literal: m[2] === undefined ? '' : literalValue(m[2]) } : null;
}

/** The markup form → `{ prop, markup }`, else null. */
export function parseMarkupForm(text) {
  const m = MARKUP_FORM.exec(text || '');
  return m ? { prop: m[1], markup: m[2] } : null;
}

/** `Astro.props.X ?? fallback` — the expression inside the braces. */
export const valueExpr = (prop, fallback) => `Astro.props.${prop}${fallback === undefined ? '' : ` ?? ${fallback}`}`;
export const markupForm = (prop, markup) => `{Astro.props.${prop} ? <Fragment set:html={Astro.props.${prop}} /> : <>${markup}</>}`;
/** Element content that is inline markup, not plain text. */
export const hasMarkup = (s) => /<[A-Za-z/!]/.test(s);
/**
 * `{…}` in .astro markup is an Astro expression — server-side code. Text the
 * editor writes into markup (typed text, a page name, pasted markup) carries
 * braces as entities, which render as the same characters.
 */
export const escapeAstroBraces = (s) => s.replace(/[{}]/g, (c) => (c === '{' ? '&#123;' : '&#125;'));
/**
 * Text written into markup is HTML element content — what innerHTML gives.
 * Plain text (Element.textContent: a canvas text commit, an agent's text) is
 * encoded first, or a typed `<` / `&` becomes markup in the file.
 */
export const encodeInnerHtmlEntities = (s) => s
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/ /g, '&nbsp;');
/**
 * The inverse: the entities innerHTML serialization produces, to the
 * characters Element.textContent yields. `&nbsp;` MUST decode to U+00A0 (never
 * a plain U+0020): contentEditable routinely inserts non-breaking spaces and
 * textContent hands back the raw U+00A0 — a plain space would make the wrap
 * flow's own EDIT_MODE_EXITED falsely mismatch and delete the just-created link.
 */
export const decodeInnerHtmlEntities = (s) => s
  .replace(/&nbsp;/g, ' ')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&');

/** Local name → import specifier for the frontmatter's imports (`Card`, `{ X as Y }`, `* as N`). */
export function collectImportSpecifiers(originalCode) {
  const map = new Map();
  const fm = /^\s*---\r?\n([\s\S]*?)\r?\n---/.exec(originalCode);
  if (!fm) return map;
  const importPattern = /import\s+([^'";]+?)\s+from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = importPattern.exec(fm[1])) !== null) {
    const clause = m[1].trim();
    const specifier = m[2];
    // `Card, { X as Y }` / `* as N` / `{ Image }` / `Card`
    const braced = /\{([^}]*)\}/.exec(clause);
    const head = clause.replace(/\{[^}]*\}/, '').replace(/,\s*$/, '').trim();
    if (head) {
      const ns = /^\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(head);
      if (ns) map.set(ns[1], specifier);
      else {
        const plain = /^([A-Za-z_$][\w$]*)/.exec(head.replace(/,.*$/, '').trim());
        if (plain) map.set(plain[1], specifier);
      }
      const tail = /,\s*\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(head);
      if (tail) map.set(tail[1], specifier);
    }
    if (braced) {
      for (const part of braced[1].split(',')) {
        const named = /^\s*[A-Za-z_$][\w$]*\s+as\s+([A-Za-z_$][\w$]*)\s*$/.exec(part);
        if (named) map.set(named[1], specifier);
        else {
          const bare = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(part);
          if (bare) map.set(bare[1], specifier);
        }
      }
    }
  }
  return map;
}
