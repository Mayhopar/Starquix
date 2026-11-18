/**
 * data-sq-source tagging — THE single implementation (task-132).
 * Moved verbatim (types stripped) from app/src/vite-plugin/index.ts so the
 * host plugin and the local-mode spawned instance share one code path
 * (parity law: reuse the real path, never fork a lookalike).
 *
 * Dependency-free on purpose: callers inject `parse` (@astrojs/compiler) —
 * the host resolves it from app/node_modules, the local-mode plugin from the
 * user project's own astro install. Consumers:
 *   - app/src/vite-plugin/index.ts (host Vite plugin)
 *   - preview-template/src/plugins/sq-source-plugin.js (local mode only)
 */

import * as path from 'path';
import { collectImportSpecifiers, parseValueForm } from './sq-prop-fallback.js';

export { collectImportSpecifiers };

/**
 * Instance override props (app/src/utils/propOverrides.ts): an element whose
 * class / text / img src reads `{Astro.props.X ?? "lit"}` renders a PAGE's
 * override when the page passes X. The scan must still know what the MASTER
 * says — the ↻/`*` bookkeeping compares overrides against it — so the literal
 * rides along as `data-sq-cf` / `data-sq-tf` / `data-sq-sf`. Entity-escaped:
 * the value is spliced into compiled string literals; the browser decodes it.
 */
const attrEscape = (v) => v.replace(/[&<>"'`$\\]/g, (c) => `&#${c.charCodeAt(0)};`);
/** A literal `??` fallback of an expression (without braces), escaped; else null. */
function fallbackOf(expression) {
  const p = parseValueForm(`{${expression || ''}}`);
  return p && p.fallback !== undefined && p.literal !== null ? attrEscape(p.literal) : null;
}
const attrFallbackOf = (attributes, names) => {
  const a = (attributes || []).find((x) => x.kind === 'expression' && names.includes(x.name));
  return a ? fallbackOf(a.value) : null;
};
function textFallbackOf(children) {
  const kids = (children || []).filter((c) => !(c.type === 'text' && !String(c.value || '').trim()));
  return kids.length === 1 && kids[0].type === 'expression' ? fallbackOf((kids[0].children || []).map((c) => c.value || '').join('')) : null;
}
/** The master literals an element carries, for the scan (null = none). */
export function elementFallbacks(node) {
  const tag = String(node.name || '').toLowerCase();
  const f = {
    cf: attrFallbackOf(node.attributes, ['class', 'className']),
    tf: textFallbackOf(node.children),
    sf: tag === 'img' ? attrFallbackOf(node.attributes, ['src']) : null,
  };
  return f.cf === null && f.tf === null && f.sf === null ? null : f;
}
/** ` data-sq-cf=…` etc.; `q` is the quote as the compiled string spells it. */
const fallbackAttrs = (f, q) => (f ? Object.entries(f).filter(([, v]) => v !== null).map(([k, v]) => ` data-sq-${k}=${q}${v}${q}`).join('') : '');

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const SKIP_ELEMENTS = new Set(['style', 'script', 'fragment', 'slot']);

/**
 * task-141: void elements that ARE source-tracked. Resolved media (img, and
 * video which is not void but listed here for symmetry of intent) needs a
 * data-sq-source key of its own.
 *
 * CORRECTED 2026-08-05 — this used to claim "the data-astro-source-* fallback
 * is dead in live DOM (Astro strips those attrs client-side)". That is FALSE
 * for astro 4.16.19 in general: `annotateSourceFile` is on by default in dev
 * and nothing in astro's client runtime removes the attributes — they were read
 * verbatim off a live dev server. What IS true is the narrow case task-141 was
 * about: `astro:assets`' own `<img>` is re-emitted without them. Note the
 * fallback is a DIFFERENT address anyway — `data-astro-source-loc` is the
 * CONTENT start (`<nav class="s">two</nav>` on line 5 → `5:16`), where the
 * tagger emits the TAG start (`5:1`).
 */
const TRACKED_VOID_ELEMENTS = new Set(['img']);

/**
 * Combined set of tags to skip during source attribute injection.
 * Includes void elements (can't have children) and non-trackable elements.
 */
const SKIP_INJECTION_TAGS = new Set([
  ...[...VOID_ELEMENTS].filter((t) => !TRACKED_VOID_ELEMENTS.has(t)),
  ...SKIP_ELEMENTS,
  'template',
]);

export function collectElements(node, insertions) {
  if (!node) return;

  const n = node;

  if (
    (n.type === 'element' || n.type === 'component') &&
    n.position?.start &&
    n.name
  ) {
    const tagNameLower = n.name.toLowerCase();

    // task-149: the HTML void/skip sets describe HTML TAGS, never component
    // names. Applying them to `type === 'component'` nodes silently dropped
    // every `Base.astro` / `Link.astro` / `Meta.astro` / `Input.astro` /
    // `Source.astro` / `Style.astro` / `Script.astro` / `Slot.astro`
    // placement — and Base/Link are ubiquitous Astro names.
    const shouldSkip =
      n.type === 'component'
        ? n.name.startsWith('Fragment')
        : (VOID_ELEMENTS.has(tagNameLower) && !TRACKED_VOID_ELEMENTS.has(tagNameLower)) ||
          SKIP_ELEMENTS.has(tagNameLower) ||
          n.name.startsWith('Fragment');

    if (!shouldSkip) {
      insertions.push({
        line: n.position.start.line,
        column: n.position.start.column,
        tagName: n.name,
        // task-149: placement identity needs to tell an Astro component
        // INVOCATION (compiles to `${$$renderComponent(...)}`, never a literal
        // `<Tag`) apart from an HTML element. Additive field — the element
        // injector below ignores it.
        isComponent: n.type === 'component',
        // task-168: `null` unless this is an `is:raw` ELEMENT, in which case
        // it is how many of its OWN closing tags the raw body contains — the
        // number the compiled scan must skip past to leave the body behind.
        // See THE OPAQUE REGIONS block.
        rawCloseCount: n.type === 'element' ? readRawCloseCount(n) : null,
        attributes: Array.isArray(n.attributes) ? n.attributes : [],
        fallbacks: n.type === 'element' ? elementFallbacks(n) : null,
      });
    }
  }

  if (n.children && Array.isArray(n.children)) {
    for (const child of n.children) {
      collectElements(child, insertions);
    }
  }

  if (n.content) {
    collectElements(n.content, insertions);
  }
}

/** A tag name is `[A-Za-z][A-Za-z0-9-]*`, so it is already regex-safe. */
function closeTagPattern(tagName, flags) {
  return new RegExp(`<\\\\?\\/${tagName}\\s*>`, flags);
}

/**
 * task-168 — how many of ITS OWN closing tags an `is:raw` element's body
 * contains, or `null` when the node is not `is:raw`.
 *
 * The AST reports an `is:raw` body as a single TEXT node: the markup inside it
 * is not element data, but the compiler emits it into the output LITERALLY, so
 * the compiled scan sees `<T` for tags no AST element stands behind. The scan
 * therefore has to jump over the body — and the only escaping-immune landmark
 * available is the run of closing tags, because the compiler's string escaping
 * (`` ` `` → ``\` ``, `${` → `\${`, `</script` → `<\/script`) never touches
 * `<`, `>`, `/` or letters. Counting here means the jump target is
 * `(count + 1)`-th `</T>`, whatever the escaping did in between.
 *
 * In astro 4.16.19 a raw body always terminates at the FIRST `</T>`, so this is
 * always 0 in practice; it is computed rather than assumed so a compiler change
 * cannot silently reintroduce the shift.
 */
function readRawCloseCount(n) {
  const isRaw = (n.attributes || []).some((a) => a && a.name === 'is:raw');
  if (!isRaw) return null;
  let text = '';
  for (const child of n.children || []) {
    if (child && child.type === 'text' && typeof child.value === 'string') text += child.value;
  }
  const matches = text.match(closeTagPattern(n.name, 'gi'));
  return matches ? matches.length : 0;
}

/* ------------------------------------------------------------------ *
 * task-149 — PLACEMENT IDENTITY (local mode only, `{ placements: true }`)
 *
 * `data-sq-source` is the DEFINING file:line:col, so every page that renders
 * `<Header />` stamps the SAME key on the same heading. A style edit therefore
 * leaked across pages and into the master.
 *
 * The fix gives local mode a real per-placement marker at RENDER time:
 *
 *   1. Every `$$renderComponent($$result,'Card',Card,{…})` gets one extra prop,
 *      `"data-sq-p": $$sqSite($$props, "<file>:<line>:<col>")` — a hash of the
 *      PARENT's placement chained with the authored invocation site. Identity
 *      is therefore a property of the source, not of the rendered DOM order
 *      (conditionals and hydration cannot re-index it).
 *   2. Every tagged element also gets `data-sq-placement="${$$sqPl($$props)}"`,
 *      which reads that prop back out inside the callee. Page files receive no
 *      such prop, so their own elements render `data-sq-placement=""` — an
 *      empty value that deliberately TERMINATES the bridge's `closest()` walk.
 *
 * Two invariants make this safe:
 *   - The helpers are injected as a dependency-free prelude. They must never
 *     reference `$$addAttribute` or anything else from astro's runtime import
 *     list: dev-mode bundling can tree-shake unused names out of that list.
 *   - `$$props` is the second parameter of the module's single
 *     `$$createComponent(($$result, $$props, $$slots) => …)` closure, so it is
 *     in lexical scope inside nested slot closures and `.map()` bodies too.
 * ------------------------------------------------------------------ */

/**
 * Sentinels standing in for the runtime placements inside a `__template` static
 * string (see TEMPLATE_PLACEMENTS below). NUL cannot occur in astro's HTML
 * output, so the split is unambiguous; written as \u escapes so the emitted
 * module source stays ASCII. Two of them since task-159 — the structural id and
 * the transitional legacy one are substituted independently.
 */
const PLACEMENT_SENTINEL_SRC = '\\u0000sqp\\u0000';
const LEGACY_SENTINEL_SRC = '\\u0000sql\\u0000';
/** task-160 — the third chain (the ordinal `q` one, now transitional too). */
const ORDINAL_SENTINEL_SRC = '\\u0000sqq\\u0000';
/** task-148 item 7 — the fourth field, the RAW invocation site (not a chain). */
const USAGE_SENTINEL_SRC = '\\u0000squ\\u0000';
const USAGE_VERSION_SENTINEL_SRC = '\\u0000squv\\u0000';

// Same content fingerprint as durableEdits/sourceIdentity.ts. Versions name
// source bytes; survivor identity comes from accepted transform maps.
function sourceVersion(source) {
  let a = 2166136261;
  for (let i = 0; i < source.length; i++) a = Math.imul(a ^ source.charCodeAt(i), 16777619);
  return `s${(a >>> 0).toString(16)}:${source.length}`;
}

/**
 * 16 hex chars from two djb2 variants, prefixed by the caller. Self-contained
 * on purpose.
 *
 * task-160 — `data-sq-p` now carries a TRIPLE, `"<s-id> <q-id> <p-id>"`, still
 * in ONE prop:
 *   - `s…` the STAMPED id, chained over `<placing file>|#<data-sq-id>` when the
 *     invocation carries one in the user's own source, and over the ordinal
 *     string when it does not (an opt-out, a hand-added tag, or a file the
 *     stamping pass could not write). CURRENT — this is what
 *     `data-sq-placement` carries. The placing file is part of the string, and
 *     that is load-bearing: without it the same stamp in two files hashed to
 *     one id (see {@link stampedIdentity}).
 *   - `q…` the ORDINAL id, chained over `<file>|<specifier>#<ordinal>` —
 *     task-159's scheme, now transitional.
 *   - `p…` the LEGACY coordinate id, chained over `<file>:<line>:<col>` —
 *     byte-for-byte what the tagger emitted before task-159.
 *
 * ONE prop, not three: the `{...Astro.props}`-forwarding hazard (a child that
 * spreads its parent's props inherits the parent's placement, and the value
 * reaches the user's production HTML) scales with the number of props we
 * inject, so it stays at one however many chains ride inside it.
 *
 * BOTH legacy chains are emitted, not just the most recent, because a user's
 * stored overrides can predate EITHER change: field 1 cannot be redefined as
 * "the previous address" without stranding every pre-task-159 `p…` key.
 *
 * ── task-148 item 7 — FIELD 3, THE USAGE SITE, RAW ────────────────────────
 * The first three fields are one-way hashes; the string field 3 hashes INTO
 * (`<placing file>:<line>:<col>`, the coordinates of the `<Card />` invocation
 * tag itself) is exactly what "remove this component from THIS page" needs as a
 * write target, and it was being computed and thrown away right here.
 *
 * So field 3 carries it VERBATIM, and every tagged element renders it as
 * `data-sq-usage` — deliberately the same grammar as `data-sq-source`, so the
 * usage is an ordinary source key that every existing parser, writer, scope
 * guard and undo op handles with no special case.
 *
 * Three properties this relies on, in order of how badly they bite:
 *   1. **It is APPENDED, so fields 0-2 stay byte-identical.** `$$sqSite` reads
 *      the parent's `a[0..2]`, which a 4th field cannot move. No placement id
 *      changes, so `KEY_SCHEME` does not bump and no stored override is
 *      re-keyed or set aside. Pinned by the byte-identity test.
 *   2. **It is LAST, and read with `slice(3).join(" ")`, not `[3]`** — a
 *      project-relative path may contain spaces and the delimiter is a space.
 *      Last position is what makes that recoverable.
 *   3. A page file's own elements have no `data-sq-p` at all, so they render
 *      `data-sq-usage=""` — the same deliberate terminator `data-sq-placement`
 *      already uses.
 *
 * The source-version envelope appends a tab plus the placing file's content
 * fingerprint AFTER this legacy value. $$sqAt strips that envelope before
 * reading field 3, so paths containing spaces and all three hash chains keep
 * their existing meaning. $$sqUv exposes the separate usage-source version.
 *
 * This adds no PROP (the `{...Astro.props}`-forwarding hazard is counted in
 * props, not in bytes), only a longer value on the one that already exists.
 */
const PLACEMENT_PRELUDE =
  'function $$sqH(s,x){var a=5381,b=52711,i=s.length;while(i--){var c=s.charCodeAt(i);' +
  'a=(a*33^c)>>>0;b=(b*31^c)>>>0;}' +
  'return x+("00000000"+a.toString(16)).slice(-8)+("00000000"+b.toString(16)).slice(-8);}\n' +
  'function $$sqSite(p,s,q,l){var v=(p&&p["data-sq-p"])||"",a=v.split(" ");' +
  'return $$sqH((a[0]||"")+"|"+s,"s")+" "+$$sqH((a[1]||"")+"|"+q,"q")+" "+' +
  '$$sqH((a[2]||"")+"|"+l,"p")+" "+l;}\n' +
  'function $$sqPl(p){var v=(p&&p["data-sq-p"])||"";return v.split(" ")[0]||"";}\n' +
  'function $$sqLq(p){var v=(p&&p["data-sq-p"])||"";return v.split(" ")[1]||"";}\n' +
  'function $$sqLp(p){var v=(p&&p["data-sq-p"])||"";return v.split(" ")[2]||"";}\n' +
  'function $$sqVersionSite(s,v){return s+"\\t"+v;}\n' +
  'function $$sqAt(p){var v=(p&&p["data-sq-p"])||"";return v.split("\\t")[0].split(" ").slice(3).join(" ");}\n' +
  'function $$sqUv(p){var v=(p&&p["data-sq-p"])||"";return v.split("\\t")[1]||"";}\n' +
  'function $$sqTpl(t,p,q,l,u,v){var c=[];for(var i=0;i<t.length;i++)' +
  `c.push(String(t[i]).split("${PLACEMENT_SENTINEL_SRC}").join(p||"")` +
  `.split("${ORDINAL_SENTINEL_SRC}").join(q||"")` +
  `.split("${LEGACY_SENTINEL_SRC}").join(l||"")` +
  `.split("${USAGE_SENTINEL_SRC}").join(u||"")` +
  `.split("${USAGE_VERSION_SENTINEL_SRC}").join(v||""));return c;}\n`;

/** The literal text appended next to `data-sq-source` on every tagged element. */
const PLACEMENT_ATTR =
  ' data-sq-placement="${$$sqPl($$props)}"' +
  ' data-sq-lq="${$$sqLq($$props)}" data-sq-lp="${$$sqLp($$props)}"' +
  ' data-sq-usage="${$$sqAt($$props)}" data-sq-usage-version="${$$sqUv($$props)}"';

/**
 * Matches every compiled Astro component invocation, capturing the component
 * name and ending immediately after the props object's `{`.
 *
 * Verified against real @astrojs/compiler 4.16.19 output for all 12 fixtures in
 * `app/src/vite-plugin/__tests__/fixtures/sq-tagging-goldens.json` (12/12,
 * including `{...(props)}` spreads, empty `{}`, dotted `N.Item`, `client:load`
 * islands and `.map()` loop bodies). Tolerant of `$$result2` rebinding and of
 * single/double quotes because dev-mode bundlers may reformat the module.
 */
const RENDER_COMPONENT_PATTERN =
  /\$\$renderComponent\(\s*\$\$result\d*\s*,\s*["']([^"']+)["']\s*,\s*[^,]*?\s*,\s*\{/g;

/**
 * A component invocation only gets a placement prop when it resolves to a
 * `.astro` file in the user's own project.
 *
 * Deliberately NARROWER than "skip bare specifiers": polluting `Astro.props` of
 * something we do not control is the one way this feature can break a real user
 * project, and a non-.astro component's internals are never tagged anyway so a
 * placement would be dead weight. This single rule covers all three hazards the
 * design named — `astro:assets` / node_modules packages (bare), framework
 * components whose props go to React/Vue/Svelte (`.jsx`, `.vue`, …), and
 * locally-computed component expressions (`const Cmp = cond ? A : B`, which has
 * no import at all).
 */
export function isTaggablePlacementComponent(name, specifiers, attributes) {
  if (!name || name.startsWith('Fragment')) return false;
  for (const attr of attributes || []) {
    // Hydrated islands: the prop object is serialised for the client, and a
    // client directive never appears on a .astro component anyway.
    if (attr && typeof attr.name === 'string' && attr.name.indexOf('client:') === 0) return false;
  }
  const specifier = specifiers.get(String(name).split('.')[0]);
  return !!specifier && specifier.endsWith('.astro');
}

/** Escape a source path for a double-quoted JS string nested in a template literal. */
function escapeForTemplateString(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');
}

/**
 * task-159 — THE identity string for one invocation, assigned per AST node.
 *
 *   `<project-relative placing file>|<import specifier><member path>#<ordinal>`
 *
 * `ordinal` counts TAGGABLE invocations of that same specifier within that
 * file, in SOURCE order. Nothing in the string is a coordinate, so inserting
 * a line, a comment, an import, unrelated markup, or re-indenting the file
 * leaves every id where the user put it. Only the invocation LIST of that one
 * specifier can move it.
 *
 * Why the import SPECIFIER and not the local binding name: renaming
 * `import Card` → `import Kard` is a rename of a variable, not of a placement,
 * and hashing the binding orphaned both overrides (measured). Changing the
 * specifier text does orphan — but moving/renaming the component file also
 * changes the OTHER half of every key (`<component file>:<line>:<col>`), so
 * those overrides are lost today regardless.
 *
 * Why the member path is kept for `<N.Item/>`: the BINDING is `N` and `.Item`
 * is not a binding at all, so `N.Item` and `N.Other` would share a specifier
 * and interleave ordinals.
 *
 * NOT the banned live-DOM ordinal (ledger §Dead ends / §Rejected): this number
 * is computed from the AST at build time and frozen into a string literal in
 * the emitted module. A conditional, hydration, View Transitions or a `.map()`
 * cannot reach it — `{show && <Card/>}<Card/>` gives the second card the same
 * id whether the first renders or not.
 */
function buildIdentityByNode(componentNodes, sourcePath, specifiers, filePath) {
  // DELIBERATELY a second counter, separate from the (name, occurrence)
  // MATCHING counter below. The matching counter must keep counting EVERY
  // compiled invocation or the AST↔compiled alignment breaks (that alignment
  // is byte-unchanged by this change). This one counts only invocations that
  // actually receive an identity, so a `client:load` island or a `.jsx`
  // sibling never renumbers its `.astro` neighbours.
  const counters = new Map();
  const byNode = new Map();
  const eligible = [];

  for (const node of componentNodes) {
    if (!isTaggablePlacementComponent(node.tagName, specifiers, node.attributes)) continue;
    const name = String(node.tagName);
    const dot = name.indexOf('.');
    const binding = dot === -1 ? name : name.slice(0, dot);
    const memberPath = dot === -1 ? '' : name.slice(dot);
    const specifier = specifiers.get(binding) || binding;
    const slot = `${specifier}${memberPath}`;
    const ordinal = counters.get(slot) || 0;
    counters.set(slot, ordinal + 1);
    eligible.push({ node, ordinal: `${sourcePath}|${slot}#${ordinal}`, stamp: readStampId(node) });
  }

  // task-160 — a duplicated stamp POISONS EVERY holder, never "first wins".
  // Copy/paste a stamped `<SiteNav/>` and letting either copy keep the id hands
  // one of them the other's stored overrides: the identical silent transplant
  // this whole feature exists to remove, and "first" is not even well defined.
  // Both fall back to the ordinal, so the stored edit ORPHANS — inert, never
  // purged, never applied to the wrong element. Inert beats transplanted.
  //
  // This counter can only ever see ONE module, so it catches a duplicate
  // WITHIN a file. The cross-file duplicate is handled by construction instead
  // — see `stampedIdentity` below — because nothing at build time can see two
  // files at once.
  const stampCounts = new Map();
  for (const e of eligible) if (e.stamp) stampCounts.set(e.stamp, (stampCounts.get(e.stamp) || 0) + 1);

  for (const e of eligible) {
    const poisoned = e.stamp && stampCounts.get(e.stamp) > 1;
    if (poisoned) {
      console.warn(
        `[sq-source] placement: data-sq-id="${e.stamp}" appears ${stampCounts.get(e.stamp)} times in ` +
          `${filePath} — every copy falls back to its ordinal and its stored edits are left where they are. ` +
          `Reopen the project to re-stamp them.`,
      );
    }
    byNode.set(e.node, {
      // The STAMPED site when the user's source carries one, else the ordinal.
      // An unstamped invocation therefore behaves exactly as it did in
      // task-159 — the residual, stated rather than hidden.
      stamped: !poisoned && e.stamp ? stampedIdentity(sourcePath, e.stamp) : e.ordinal,
      ordinal: e.ordinal,
    });
  }
  return byNode;
}

/**
 * round 14 — THE identity string of a STAMPED invocation:
 *
 *   `<project-relative placing file>|#<stamp>`
 *
 * ── Why the file is in it (the defect this replaced) ──────────────────────
 * It used to be `#<stamp>` alone. The prelude hashes the parent chain with
 * this string, and a PAGE ROOT's parent chain is `''` — so the same stamp in
 * `a.astro` and in `b.astro` produced ONE id (measured: `#s0123456789abcdef`
 * → `s94d7730f04273a2f` from both). Copy/paste a stamped `<SiteNav/>` from one
 * page into another and the second silently inherited the first's stored
 * overrides: the exact transplant this feature exists to remove.
 *
 * It could not be caught by a check, either. {@link buildIdentityByNode} runs
 * per MODULE, so its duplicate poison only ever sees one file; a cross-file
 * duplicate was structurally invisible at build time. Uniqueness therefore has
 * to come from the identity's own shape, not from a warning.
 *
 * ── Why this keeps the property the stamp exists for ──────────────────────
 * The placing file is a property of the invocation's HOME, never of its
 * position inside it. Moving the tag to the bottom of the file, nesting it
 * deeper in plain markup, deleting or reordering a same-name sibling, adding
 * lines, re-indenting, renaming the local binding — none of them change it.
 * Only moving the invocation to a DIFFERENT file does, and that already
 * re-chained under the new parent (ledger boundary 4, row D2). Pinned by the
 * `MOVING the invocation within its own file` and M6/M6b tests.
 *
 * ── Why it cannot collide with the ordinal chain ──────────────────────────
 * They share field 1 of the triple only in shape. An ordinal is
 * `<file>|<specifier><member>#<n>` and always ends `#<digits>`; a stamped id is
 * `<file>|#s<16 hex>` and has exactly one `#`, immediately after the `|`. Even
 * a node subpath specifier (`import X from '#lib/X.astro'`, legal) cannot forge
 * one, because it would still carry the `#<n>` suffix.
 */
function stampedIdentity(sourcePath, stamp) {
  return `${sourcePath}|#${stamp}`;
}

/**
 * task-160 — a grammar-valid stamp on an invocation, or ''.
 *
 * ONLY `kind: 'quoted'` with an `s<16 hex>` value counts. Anything else —
 * `data-sq-id={expr}`, a bare `data-sq-id`, a hand-typed value — is a
 * deliberate per-invocation OPT-OUT: that placement stays on the ordinal chain,
 * which still works. (`kind` values confirmed against @astrojs/compiler 2.13.0:
 * `"abc"` → 'quoted', `{undefined}` → 'expression'.)
 */
function readStampId(node) {
  for (const attr of node.attributes || []) {
    if (!attr || attr.name !== 'data-sq-id') continue;
    if (attr.kind !== 'quoted') return '';
    const value = String(attr.value || '');
    return /^s[0-9a-f]{16}$/.test(value) ? value : '';
  }
  return '';
}

/**
 * Insert the `data-sq-p` prop into every eligible compiled component
 * invocation found in `templateContent`.
 *
 * AST component nodes are matched to call sites by (name, occurrence) — the
 * same discipline the element injector uses — because both lists are produced
 * in source order and both skip `Fragment` identically.
 */
function buildPlacementPropReplacements(
  templateContent,
  elements,
  sourcePath,
  specifiers,
  filePath,
  skipRange,
  version,
) {
  const componentNodes = elements.filter((e) => e.isComponent);
  const identityByNode = buildIdentityByNode(componentNodes, sourcePath, specifiers, filePath);
  const occurrenceCounters = new Map();
  const matchedNodes = new Set();
  const replacements = [];

  RENDER_COMPONENT_PATTERN.lastIndex = 0;
  let match;
  while ((match = RENDER_COMPONENT_PATTERN.exec(templateContent)) !== null) {
    const name = match[1];
    if (name.startsWith('Fragment')) continue;
    // `__template` callers hand us the WHOLE module, so the static-string array
    // is in range. Its contents are authored HTML text, never a call site —
    // matching there could only ever be a false positive, and rewriting it
    // would corrupt the served markup. Skipped WITHOUT counting, so the
    // (name, occurrence) alignment with the AST is unaffected.
    if (skipRange && match.index >= skipRange.start && match.index < skipRange.end) continue;

    const count = (occurrenceCounters.get(name) || 0) + 1;
    occurrenceCounters.set(name, count);

    let seen = 0;
    let node = null;
    for (const candidate of componentNodes) {
      if (candidate.tagName !== name) continue;
      seen += 1;
      if (seen === count) {
        node = candidate;
        break;
      }
    }
    if (!node) continue;
    matchedNodes.add(node);

    if (!isTaggablePlacementComponent(name, specifiers, node.attributes)) continue;

    // EVERY invocation chains off the parent placement with its authored
    // invocation site — a LAYOUT included. Owner model, 2026-08-04: "layout is
    // a component", so its placement on each page is an INSTANCE. There is
    // deliberately no layout special case here; see the ledger reversal.
    //
    // task-160: THREE chains are emitted from one prop. `site` is the STAMPED
    // identity when the user's source carries a `data-sq-id` (nothing derived,
    // nothing that can slide); `ordinalSite` is task-159's scheme and
    // `legacySite` the pre-task-159 coordinate — both kept so a stored override
    // from either era can be recognised and rekeyed exactly once.
    const identity = identityByNode.get(node);
    const site = escapeForTemplateString(identity.stamped);
    const ordinalSite = escapeForTemplateString(identity.ordinal);
    const legacySite = escapeForTemplateString(`${sourcePath}:${node.line}:${node.column}`);
    const insertAt = match.index + match[0].length;
    replacements.push({
      start: insertAt,
      end: insertAt,
      replacement: `"data-sq-p":$$sqVersionSite($$sqSite($$props,"${site}","${ordinalSite}","${legacySite}"),"${version}"),`,
    });
  }

  // Silent no-ops are the failure mode that cost a whole prototype: if the
  // module was reformatted past the pattern above, say so instead of shipping
  // a feature that quietly does nothing.
  for (const node of componentNodes) {
    if (!matchedNodes.has(node) && isTaggablePlacementComponent(node.tagName, specifiers, node.attributes)) {
      console.warn(
        `[sq-source] placement: no compiled call site for <${node.tagName}> at ` +
          `${filePath}:${node.line}:${node.column} — that placement falls back to its ancestor's.`,
      );
    }
  }

  return replacements;
}

/* ------------------------------------------------------------------ *
 * THE OCCURRENCE SHIFT (fixed 2026-08-05) — read before touching either
 * tag scan below.
 *
 * AST elements are matched to compiled tags by (tagName, occurrence): the k-th
 * compiled `<T` is assigned the k-th AST `T`. That alignment holds only while
 * the compiled scan SEES every `<T` the AST collected.
 *
 * It did not. @astrojs/compiler emits an element whose FIRST attribute is
 * dynamic with NO separator after the tag name:
 *
 *   <a href={url} class="x">   →  <a${$$addAttribute(url, "href")} class="x">
 *   <div {...props}>           →  <div${$$spreadAttributes(props)}>
 *   <div class:list={[…]}>     →  <div${$$addAttribute([…], "class:list")}>
 *
 * (Precisely: the first attribute's `kind` is neither `quoted` nor `empty`.
 * Directives are NOT in this set — `set:html={x}` and `is:raw` are consumed by
 * the compiler and emit a bare `<div>`, which matches normally. That is exactly
 * why this is decided from the COMPILED bytes and never predicted from the AST.)
 *
 * The old terminator class `(\s|>|\/)` missed those tags, and a miss was never
 * COUNTED — so every later `T` in the file inherited the PREVIOUS `T`'s
 * coordinates. Measured live on astro 4.16.19: three `<a>` where only the first
 * had a dynamic first attribute rendered `data-sq-source` 5:3 on the anchor
 * authored at 6:3 and 6:3 on the one authored at 7:3. Driven through the real
 * writers, a class write, a text edit and a DELETE keyed on the second anchor
 * all landed on the FIRST one — silently, with a valid-looking key.
 *
 * The fix: recognise the dynamic-first form so it CONSUMES its occurrence slot.
 *
 * The two branches see the same compiler shape through different quoting, so
 * each recognises its own terminator:
 *   - `$$render\`` (template literal): the interpolation is right there — `${`.
 *   - `__template([…])` (memoised string array): the static chunk simply ENDS
 *     at the tag name, so the terminator is the JS string literal's own closing
 *     quote — `__template(["", "<section", ' id="s1"…'])`.
 * A quote can never follow a tag name in valid HTML, and `${` can never appear
 * literally inside a `__template` chunk, so neither addition can false-positive
 * on a tag that used to match.
 *
 * ROUND 17 stopped there: such an element consumed its slot and was left
 * UNTAGGED. THE DYNAMIC-FIRST FORM below is the other half — it now gets a key.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * THE DYNAMIC-FIRST FORM (task-167, 2026-08-05) — the second half of THE
 * OCCURRENCE SHIFT. Read that block first.
 *
 * ROUND 17 made a dynamic-first element consume its occurrence slot, which
 * stopped it shifting its same-tag siblings. It still emitted NO
 * `data-sq-source` and NO `data-sq-placement`, and that is not a cosmetic gap:
 *
 *   - the element falls back to astro's `data-astro-source-*`, which is a
 *     DIFFERENT address (the CONTENT start, `4:30`, where the tagger emits the
 *     TAG start, `4:1`) and evaporates if the user disables the dev toolbar;
 *   - `resolvePlacement` (bridge/parts/utils.ts) finds no own
 *     `data-sq-placement` and `closest()`-walks past it to the LAYOUT's div, so
 *     TWO placements of the same component share ONE placement id, separated
 *     only by the scanner's positional `#1`. `localOverridesForPlacement` then
 *     treats them as one — and Push on placement B writes A's unpushed edit
 *     into the master (task-182, reproduced live).
 *
 * A component ROOT is exactly where this bites: `<div class={…}>` is idiomatic
 * Astro, and it was measured at 7 of 26 files in the owner's own project.
 *
 * ── The insertion point, per branch ────────────────────────────────────────
 * There IS one in both, and in both it is the same offset the scan already
 * matched — immediately after the tag name, BEFORE the `${…}`:
 *
 *   $$render`   <div${$$addAttribute(cls,"class")}>
 *             → <div data-sq-source="…" data-sq-placement="${$$sqPl($$props)}"
 *                    …${$$addAttribute(cls,"class")}>
 *
 *   __template  ["", "<section", ' id="s1"…']
 *             → ["", "<section data-sq-source=\"…\" …", ' id="s1"…']
 *
 * `$$addAttribute` / `$$spreadAttributes` render a LEADING space of their own
 * (and the empty string for an empty spread), so the concatenation is
 * well-formed HTML either way. In the `__template` branch the attribute run is
 * spliced INSIDE the chunk's own string literal, before its closing quote —
 * `\"` is a legal escape in all three JS quotings, so the chunk's quote
 * character does not matter. Nothing is ever written between `${` and its
 * matching `}`; the expression's bytes are untouched, which the
 * `splices OUTSIDE the ${…} expression` test and THE PARSE GATE both pin.
 *
 * ── Consequence: this RE-KEYS ──────────────────────────────────────────────
 * Every such element's `file:line:col` moves from the astro-loc fallback to the
 * tagger address, and its placement moves from the ancestor's to its own. Both
 * halves of a stored override change, so `KEY_SCHEME`
 * (app/src/hooks/useSourceOverridesPersistence.ts) was bumped 3 → 4 under its
 * own written rule. Pre-existing overrides are SET ASIDE with a toast, never
 * transplanted.
 *
 * ── Still decided from the COMPILED BYTES, never from the AST ──────────────
 * The condition is "the scan's terminator was `${` / a JS quote", i.e. what the
 * compiler actually emitted. An AST-side "is the first attribute dynamic"
 * predicate is WRONG and was rejected in ROUND 17 for the same reason it would
 * be wrong here: `set:html={x}` and `is:raw` have an expression-or-empty first
 * attribute but are CONSUMED by the compiler and emit a bare `<div>`, which
 * matches normally. Predicting the compiled form from the AST would mis-tag
 * exactly those.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * THE OPAQUE REGIONS (task-168, fixed 2026-08-05) — the MIRROR of the shift
 * above. Read both before touching either tag scan.
 *
 * THE OCCURRENCE SHIFT is about a compiled `<T` the injector could not match:
 * it must still CONSUME its slot. This is the other direction — a compiled `<T`
 * with NO AST ELEMENT BEHIND IT AT ALL, which must NOT consume a slot, because
 * consuming one shifts every later same-tag element the OTHER way.
 *
 * Three triggers, all reproduced in served bytes on a live astro dev 4.16.19:
 *
 *   1. an HTML COMMENT holding markup — `<!-- <p class="ghost">x</p> -->` is
 *      preserved verbatim in the output;
 *   2. an `is:raw` BODY — the AST reports it as a TEXT node, the compiler emits
 *      the markup literally;
 *   3. a `<script>` / `<style>` BODY holding an HTML string — e.g.
 *      `<script is:inline>window.t = "<q class='g'>x</q>";</script>`.
 *
 * Measured before the fix, three `<p>` siblings under one commented-out `<p>`:
 * the GHOST was tagged with the first real `<p>`'s coordinates, that `<p>` took
 * the second's, the second took the third's and the third got no key at all.
 * A class write, a text edit or a DELETE keyed on any of them then lands on a
 * neighbour — silently, with a valid-looking key. The injector also wrote
 * `data-sq-source` / `data-sq-placement` INSIDE the comment, inside the raw
 * block and inside the inline script, and all three ship to the user's output.
 *
 * ── How each region is identified, and why ─────────────────────────────────
 * Comments and script/style bodies are found in the COMPILED BYTES ALONE
 * ({@link findOpaqueRegions}) — the same discipline THE OCCURRENCE SHIFT was
 * decided by, and for the same reason: an AST-side predicate mis-classifies the
 * shapes the compiler consumes.
 *
 * `is:raw` is the one region with NO signal in the compiled bytes: the compiler
 * strips the directive and emits a bare `<div>`. Its extent is therefore
 * anchored on the raw element's own compiled OPENING TAG — which the scan
 * matches normally, because that element IS an AST element — and closed by
 * {@link readRawCloseCount}'s escaping-immune closing-tag count. Nothing is
 * predicted about the compiled FORM of a tag from the AST; only "this element's
 * children are text, not elements", which is what the AST actually reports.
 *
 * ── Fail CLOSED ────────────────────────────────────────────────────────────
 * Both scans only ever move the cursor FORWARD and never splice. When a region
 * cannot be closed — a `<!--` with no `-->`, a raw body whose `</T>` is missing
 * — the region runs to the end of the scanned text, so the remaining elements
 * are simply UNTAGGED. A skipped placement, never a corrupted one; a wrong
 * address is the outcome this whole block exists to prevent.
 *
 * ── What is NOT covered (measured, registered, deliberately not fixed here) ─
 * A JS string literal inside a `${…}` expression — `<div set:html="<u>x</u>">`
 * compiles to `${"<u>x</u>"}` — is the same class of ghost and is WORSE: the
 * injector splices an attribute into the string and the module stops parsing
 * (rollup `Unexpected token`, HTTP 500 on the page). It cannot be skipped by
 * the same rule, because `${…}` also carries `$$renderComponent(…)` slot bodies
 * full of REAL elements. `is:raw` on a COMPONENT (`<Card is:raw>`) is likewise
 * out — its body lands in a nested `$$render\`` slot with no anchor tag of its
 * own. See tasks.json.
 * ------------------------------------------------------------------ */

/**
 * Byte ranges of the compiled text that hold no AST element — HTML comments and
 * `<script>`/`<style>` bodies. Ascending, non-overlapping, derived from the
 * compiled bytes only.
 *
 * HTML comments do NOT nest: `<!-- a <!-- b --> c -->` ends at the FIRST `-->`
 * and astro's own parser agrees (the tail becomes text), so a single forward
 * `indexOf` is the correct rule rather than a depth counter — and a depth
 * counter that lies is exactly what corrupted this file once already.
 */
function findOpaqueRegions(text) {
  const regions = [];
  const opener = /<!--|<(script|style)(?![A-Za-z0-9-])/gi;
  let m;
  while ((m = opener.exec(text)) !== null) {
    const start = m.index;
    let end;
    if (m[0] === '<!--') {
      const close = text.indexOf('-->', start + 4);
      end = close === -1 ? text.length : close + 3;
    } else {
      // `<\/script>` in the `__template` branch — the compiler escapes the
      // slash inside the JS string literal, so the pattern tolerates it.
      const closeMatch = closeTagPattern(m[1], 'i').exec(text.slice(start));
      end = closeMatch ? start + closeMatch.index + closeMatch[0].length : text.length;
    }
    regions.push({ start, end });
    opener.lastIndex = end;
  }
  return regions;
}

function isInOpaqueRegion(regions, index) {
  for (const r of regions) {
    if (index < r.start) return false;
    if (index < r.end) return true;
  }
  return false;
}

/**
 * Where an `is:raw` element's body ends in the compiled text: the start of the
 * `(closeCount + 1)`-th `</tagName>` at or after `from`. `-1` when there is
 * none — the caller then skips the rest of the text (fail closed).
 */
function findRawBodyEnd(text, tagName, from, closeCount) {
  const pattern = closeTagPattern(tagName, 'gi');
  pattern.lastIndex = from;
  let seen = 0;
  let m;
  while ((m = pattern.exec(text)) !== null) {
    seen += 1;
    if (seen > closeCount) return m.index;
  }
  return -1;
}

/**
 * Assign a per-tag occurrence number to each element, so we can match
 * AST elements to their compiled-output counterparts by (tagName, occurrence).
 */
function buildElementOccurrences(elements) {
  const counters = new Map();
  return elements.map((el) => {
    const count = (counters.get(el.tagName) || 0) + 1;
    counters.set(el.tagName, count);
    return {
      tagName: el.tagName,
      occurrence: count,
      line: el.line,
      column: el.column,
      rawCloseCount: el.rawCloseCount ?? null,
      fallbacks: el.fallbacks ?? null,
    };
  });
}

/* ------------------------------------------------------------------ *
 * TEMPLATE_PLACEMENTS (regression fix 2026-08-04)
 *
 * @astrojs/compiler emits the memoised `$$render(_a || (_a = __template([…])),
 * …)` form for a module whose template has no dynamic expressions of its own.
 * A `<script is:inline>` is enough to trigger it — flipping ONE such tag in a
 * layout flipped the branch in a live 4.16.19 dev server — so the old comment
 * claiming the branch was unreachable was simply wrong.
 *
 * The branch emitted `data-sq-source` but NO `data-sq-placement`, so every
 * element of such a file fell back to a bare key: two `<Plain/>` on ONE page,
 * and the same component on two pages, all collapsed onto one identity. That
 * is the cross-page-leak defect, reproduced from a second, independent cause.
 *
 * The strings live in a module-level frozen array, so a `${…}` interpolation is
 * impossible and the memo means anything wrapped INSIDE it would be computed
 * once and frozen to the first render's placement. The fix therefore bakes a
 * sentinel into the static strings and substitutes it per render, OUTSIDE the
 * memo, by wrapping the first argument of the `$$render(…)` tag call:
 *
 *   $$render(_a || (_a = __template([…])), x)
 *   → $$render($$sqTpl(_a || (_a = __template([…])),$$sqPl($$props)), x)
 *
 * `renderTemplate(htmlParts, …expressions)` only ever indexes `htmlParts`
 * (astro/dist/runtime/server/render/astro/render-template.js — `.raw` is never
 * read), so returning a plain array is safe.
 * ------------------------------------------------------------------ */

/**
 * Index of the end of the argument starting at `from` — the top-level `,` or
 * `)` that terminates it. String- and nesting-aware. Returns -1 if unbalanced.
 */
function findArgumentEnd(src, from) {
  let depth = 0;
  for (let i = from; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '\\') { i += 1; continue; }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') i += 1;
        i += 1;
      }
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') { depth += 1; continue; }
    if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) return ch === ')' ? i : -1;
      depth -= 1;
      continue;
    }
    if (ch === ',' && depth === 0) return i;
  }
  return -1;
}

/**
 * Positions of the two insertions that make a `__template` call
 * placement-aware, or null when the surrounding `$$render(` call cannot be
 * matched — in which case NO sentinel may be emitted, or it would leak into
 * the served HTML as literal text.
 */
function planTemplatePlacementWrap(compiledCode, templateStart, templateSectionEnd) {
  const RENDER_CALL = '$$render(';
  const callIdx = compiledCode.lastIndexOf(RENDER_CALL, templateStart);
  if (callIdx === -1) return null;
  const argStart = callIdx + RENDER_CALL.length;
  // Everything between the call and the array must be the memo wrapper, never
  // another argument — otherwise we would wrap the wrong expression.
  if (/[,)]/.test(compiledCode.slice(argStart, templateStart))) return null;
  // Scan from argStart, NOT from the end of the array: starting mid-expression
  // makes the depth counter lie and the first `)` encountered is the memo's,
  // which would splice the placement in as __template's `raw` parameter (the
  // 2026-08-04 self-inflicted bug — every element then rendered
  // `data-sq-placement=""`).
  const argEnd = findArgumentEnd(compiledCode, argStart);
  if (argEnd < templateSectionEnd) return null;
  return { argStart, argEnd };
}

/**
 * Every edit this branch makes is expressed as an ABSOLUTE offset into
 * `compiledCode` and applied in ONE right-to-left pass.
 *
 * The three-slice assembly this replaced (`beforeTemplate + modifiedTemplate +
 * afterTemplate`, with a `relEnd` rebased into the third slice) is exactly the
 * arithmetic that produced the 2026-08-04 self-inflicted bug where the
 * placement was spliced in as `__template`'s `raw` parameter. One coordinate
 * system, one splice loop, no rebasing.
 */
function injectTagsDirectly(
  compiledCode,
  elements,
  sourcePath,
  emitPlacements,
  specifiers,
  filePath,
  version,
) {
  const elementOccurrences = buildElementOccurrences(elements);

  const templateStart = compiledCode.indexOf('__template([');
  const templateEnd = compiledCode.indexOf('])', templateStart);

  if (templateStart === -1 || templateEnd === -1) {
    return null;
  }

  const templateSectionEnd = templateEnd + 2;

  const wrap = emitPlacements
    ? planTemplatePlacementWrap(compiledCode, templateStart, templateSectionEnd)
    : null;

  const templateSection = compiledCode.slice(templateStart, templateSectionEnd);

  const matchCounters = new Map();
  const replacements = [];

  // `["'`]` = the dynamic-first form: this chunk of the string array ends at
  // the tag name. See THE OCCURRENCE SHIFT above.
  const tagPattern = /<([A-Za-z][A-Za-z0-9-]*)(\s|>|\/|["'`])/g;
  let match;

  // Comments and script/style bodies: NOT counted, NOT injected into.
  // See THE OPAQUE REGIONS above.
  const opaqueRegions = findOpaqueRegions(templateSection);

  while ((match = tagPattern.exec(templateSection)) !== null) {
    const fullMatch = match[0];
    const tagName = match[1];
    const after = match[2];

    if (tagName.startsWith('${')) continue;

    if (isInOpaqueRegion(opaqueRegions, match.index)) continue;

    const tagNameLower = tagName.toLowerCase();
    if (SKIP_INJECTION_TAGS.has(tagNameLower)) continue;

    const count = (matchCounters.get(tagName) || 0) + 1;
    matchCounters.set(tagName, count);

    const elementInfo = elementOccurrences.find(
      (e) => e.tagName === tagName && e.occurrence === count
    );

    // An `is:raw` element's BODY is opaque and has no marker of its own in the
    // compiled bytes — jump the cursor past it from HERE, the one place its
    // extent is anchored. Done BEFORE the injection below and driven off the
    // MATCH, not off the injection, so a `<div class={x} is:raw>` — whose own
    // opening tag is the dynamic-first form — is jumped over just the same.
    if (elementInfo && elementInfo.rawCloseCount !== null) {
      const bodyEnd = findRawBodyEnd(
        templateSection,
        tagName,
        match.index + fullMatch.length,
        elementInfo.rawCloseCount,
      );
      tagPattern.lastIndex = bodyEnd === -1 ? templateSection.length : bodyEnd;
    }

    if (elementInfo) {
      const attr =
        ` data-sq-source=\\"${sourcePath}:${elementInfo.line}:${elementInfo.column}\\"` +
        (emitPlacements ? ` data-sq-source-version=\\"${version}\\"` : '') +
        fallbackAttrs(elementInfo.fallbacks, '\\"') +
        (wrap
          ? ` data-sq-placement=\\"${PLACEMENT_SENTINEL_SRC}\\"` +
            ` data-sq-lq=\\"${ORDINAL_SENTINEL_SRC}\\"` +
            ` data-sq-lp=\\"${LEGACY_SENTINEL_SRC}\\"` +
            ` data-sq-usage=\\"${USAGE_SENTINEL_SRC}\\"` +
            ` data-sq-usage-version=\\"${USAGE_VERSION_SENTINEL_SRC}\\"`
          : '');
      const replacement = `<${tagName}${attr}${after}`;
      replacements.push({
        start: templateStart + match.index,
        end: templateStart + match.index + fullMatch.length,
        replacement,
      });
    }
  }

  const taggedElementCount = replacements.length;

  /*
   * THE HALF ROUND 3 MISSED (2026-08-04): this branch used to `return` here,
   * before `buildPlacementPropReplacements` — its only call site was in the
   * `$$render` branch below. So a module compiled through `__template` never
   * inserted `data-sq-p` into the invocations IT places, and every component a
   * `<script is:inline>`-carrying LAYOUT places (Header/Nav/Footer — exactly
   * the site-wide ones) got a BARE key on every route.
   *
   * The scan runs over the WHOLE module, not just the `$$render(` argument
   * list, because the compiler can emit an invocation on EITHER side of the
   * array: a page inside a layout slot compiles to
   * `$$renderComponent(…,'Layout',…,{ default: () => $$render(__template([…]),
   * …, $$renderComponent(…,'Card',…)) })` — `Layout` before, `Card` after.
   * The array itself is excluded (see `skipRange`).
   */
  if (emitPlacements) {
    for (const r of buildPlacementPropReplacements(
      compiledCode,
      elements,
      sourcePath,
      specifiers,
      filePath,
      { start: templateStart, end: templateSectionEnd },
      version,
    )) {
      replacements.push(r);
    }
  }

  if (replacements.length === 0) {
    return null;
  }

  // Fail CLOSED: the sentinel only ever entered the strings when `wrap` was
  // planned, so the wrap is applied under exactly that condition. No wrap ⇒ no
  // sentinel ⇒ the module degrades to source-only, never to corrupt output.
  if (wrap && taggedElementCount > 0) {
    // Both substitutions ride the SAME existing offsets (wrap.argStart /
    // wrap.argEnd). No new offset arithmetic anywhere — that arithmetic is what
    // corrupted this file in review round 3.
    replacements.push({ start: wrap.argStart, end: wrap.argStart, replacement: '$$sqTpl(' });
    replacements.push({
      start: wrap.argEnd,
      end: wrap.argEnd,
      replacement: ',$$sqPl($$props),$$sqLq($$props),$$sqLp($$props),$$sqAt($$props),$$sqUv($$props))',
    });
  }

  replacements.sort((a, b) => b.start - a.start);
  let code = compiledCode;
  for (const r of replacements) {
    code = code.slice(0, r.start) + r.replacement + code.slice(r.end);
  }

  return { code };
}

/* ------------------------------------------------------------------ *
 * THE PARSE GATE (task-176, 2026-08-05) — the last thing that runs, and the
 * only guarantee in this file that does not depend on the scan being right.
 *
 * Every scan above is a REGEX over compiled bytes. Three times now that regex
 * has spliced an attribute somewhere it must not (a depth counter that lied; a
 * rebased offset that wrote into `__template`'s `raw` parameter; and a
 * `data-sq-source` written inside a JS STRING LITERAL, which makes the module
 * stop parsing and takes the user's page to HTTP 500 — measured live on astro
 * 4.16.19 for `<div set:html="<u>x</u>">`, rollup
 * `Unexpected token \`ident\`. Expected \`}\``).
 *
 * So: after the splice pass and before returning, hand the ASSEMBLED module to
 * a real JS parser. If it does not parse, return `null` — astro then serves its
 * own untagged module and the file is simply not editable this session.
 * Degraded and honest, never broken. No scan bug in this file can serve a
 * module that does not parse again.
 *
 * ── The parser is INJECTED, like `parse` ───────────────────────────────────
 * This file is dependency-free by contract. `options.parseJs` is supplied by
 * `sq-source-plugin.js`'s local branch, which resolves `rollup/parseAst` from
 * the USER project's own install (rollup is a hard dep of vite, itself a hard
 * dep of astro). That is deliberately the SAME parser whose error the user saw,
 * so the gate's verdict is by construction astro's own.
 *
 * ── Why LOCAL MODE ONLY ────────────────────────────────────────────────────
 * Every reported 500 came from the local call site, which is also the only one
 * that passes `options`. The 6-arg host-plugin path supplies no `parseJs`, runs
 * no extra parse, and is therefore byte-identical by CONSTRUCTION — the 42
 * golden assertions in `sq-tagging-goldens.test.ts` are the check, not the
 * argument.
 *
 * ── What it does NOT do ────────────────────────────────────────────────────
 * It cannot see a wrong-but-VALID address. `<p>{'<i class="x">i</i>'}</p>`
 * splices into a single-quoted literal, parses cleanly, leaks `data-sq-*` into
 * the user's HTML and still steals the next `<i>`'s coordinates. That is the
 * scan's job (the mode-stack lexer + alignment gate, task-176 proper) and is
 * deliberately NOT built here.
 * ------------------------------------------------------------------ */

/**
 * `{ code }` when `code` parses (or no parser was injected), `null` when it
 * does not. Never throws — a broken gate must not become a broken build.
 */
function applyParseGate(code, parseJs, filePath, compiledCode) {
  if (typeof parseJs !== 'function') return { code };
  try {
    parseJs(code);
    return { code };
  } catch (error) {
    const detail = (error && error.message) || String(error);
    // Distinguish OUR damage from the compiler's. `set:html='<u class="x">'`
    // (a single-quoted astro attribute holding double quotes) makes
    // @astrojs/compiler 2.13.0 itself emit `${"<u class="x">"}` — invalid JS
    // before we touch it, confirmed on a plugin-free control server. Blaming
    // the tagger for that would send the next reader hunting in the wrong file.
    let inputBroken = false;
    try {
      parseJs(compiledCode);
    } catch {
      inputBroken = true;
    }
    console.warn(
      inputBroken
        ? `[sq-source] ${filePath}: the COMPILED module does not parse before tagging ` +
            `(upstream @astrojs/compiler output) — served untagged. ${detail}`
        : `[sq-source] ${filePath}: tagging produced a module that does not parse — ` +
            `served UNTAGGED, its elements are not editable this session. ${detail}`,
    );
    return null;
  }
}

/**
 * Inject data-sq-source attributes into compiled Astro output.
 * `parse` is @astrojs/compiler's parse, injected by the caller (each consumer
 * resolves it from a different node_modules — see file header).
 *
 * `options.placements` (task-149) additionally emits per-placement identity —
 * see the PLACEMENT IDENTITY block above. It is passed by exactly ONE call
 * site, `sq-source-plugin.js`'s local-mode branch. The host plugin
 * (`app/src/vite-plugin/index.ts`) calls with 6 args and must
 * keep getting byte-identical output; that contract is pinned by
 * `app/src/vite-plugin/__tests__/sq-tagging-goldens.test.ts`.
 *
 * `options.parseJs` (task-176) is the PARSE GATE — see THE PARSE GATE above.
 * Injected by the same local-only call site; absent ⇒ no gate, no extra work.
 */
export async function transformCompiledOutput(
  compiledCode,
  originalCode,
  filePath,
  projectRoot,
  pathMode,
  parse,
  options
) {
  const emitPlacements = options?.placements === true;
  const version = emitPlacements ? sourceVersion(originalCode) : undefined;
  const parseResult = await parse(originalCode, {
    position: true,
  });

  const elements = [];
  collectElements(parseResult.ast, elements);

  if (elements.length === 0) {
    return null;
  }

  elements.sort((a, b) => {
    if (a.line !== b.line) return a.line - b.line;
    return a.column - b.column;
  });

  const sourcePath =
    // Keys are POSIX on every OS: the editor stores them and the write routes refuse a backslash (Windows).
    pathMode === 'relative' ? path.relative(projectRoot, filePath).split(path.sep).join('/') : filePath;

  // Memoised static-template shape — REACHABLE (a single `<script is:inline>`
  // is enough; see the TEMPLATE_PLACEMENTS block). Placements are emitted here
  // too, via the sentinel + `$$sqTpl` wrap; if the `$$render(` call cannot be
  // matched, no sentinel is emitted and behaviour degrades to source-only.
  if (compiledCode.includes('__template(')) {
    const out = injectTagsDirectly(
      compiledCode,
      elements,
      sourcePath,
      emitPlacements,
      emitPlacements ? collectImportSpecifiers(originalCode) : null,
      filePath,
      version,
    );
    if (!out) return null;
    // The prelude is needed for EITHER emitted helper: `$$sqTpl` (this module's
    // own elements) or `$$sqSite` (the components it PLACES). A module can emit
    // the second without the first — e.g. the `$$render(` wrap could not be
    // planned, or the module has no taggable element of its own.
    const needsPrelude =
      emitPlacements && (out.code.includes('$$sqTpl(') || out.code.includes('$$sqSite('));
    return applyParseGate(
      needsPrelude ? PLACEMENT_PRELUDE + out.code : out.code,
      options?.parseJs,
      filePath,
      compiledCode,
    );
  }

  const renderStartIdx = compiledCode.indexOf('$$render`');
  if (renderStartIdx === -1) {
    return null;
  }

  const templateStartIdx = renderStartIdx + 9;
  const endPattern = '`;\n},';
  const templateEndIdx = compiledCode.indexOf(endPattern, templateStartIdx);
  if (templateEndIdx === -1) {
    return null;
  }

  const templateContent = compiledCode.substring(templateStartIdx, templateEndIdx);
  const elementOccurrences = buildElementOccurrences(elements);

  let modifiedTemplate = templateContent;
  const matchCounters = new Map();
  // `\$\{` = the dynamic-first form, `<a${$$addAttribute(url, "href")} …>`.
  // See THE OCCURRENCE SHIFT above.
  const tagPattern = /<([A-Za-z][A-Za-z0-9-]*|\$\{[^}]+\})(\s|>|\/|\$\{)/g;
  let match;
  const replacements = [];

  // Comments and script/style bodies: NOT counted, NOT injected into.
  // See THE OPAQUE REGIONS above.
  const opaqueRegions = findOpaqueRegions(templateContent);

  while ((match = tagPattern.exec(templateContent)) !== null) {
    const fullMatch = match[0];
    const tagName = match[1];
    const after = match[2];

    if (tagName.startsWith('${')) continue;

    if (isInOpaqueRegion(opaqueRegions, match.index)) continue;

    const tagNameLower = tagName.toLowerCase();
    if (SKIP_INJECTION_TAGS.has(tagNameLower)) continue;

    const count = (matchCounters.get(tagName) || 0) + 1;
    matchCounters.set(tagName, count);

    const elementInfo = elementOccurrences.find(
      (e) => e.tagName === tagName && e.occurrence === count
    );

    // An `is:raw` element's BODY is opaque and has no marker of its own in the
    // compiled bytes — jump the cursor past it from HERE, the one place its
    // extent is anchored. Done BEFORE the injection below and driven off the
    // MATCH, not off the injection, so a `<div class={x} is:raw>` — whose own
    // opening tag is the dynamic-first form — is jumped over just the same.
    if (elementInfo && elementInfo.rawCloseCount !== null) {
      const bodyEnd = findRawBodyEnd(
        templateContent,
        tagName,
        match.index + fullMatch.length,
        elementInfo.rawCloseCount,
      );
      tagPattern.lastIndex = bodyEnd === -1 ? templateContent.length : bodyEnd;
    }

    if (elementInfo) {
      const attr =
        ` data-sq-source="${sourcePath}:${elementInfo.line}:${elementInfo.column}"` +
        (emitPlacements ? ` data-sq-source-version="${version}"` : '') +
        fallbackAttrs(elementInfo.fallbacks, '"') +
        (emitPlacements ? PLACEMENT_ATTR : '');
      const newMatch = `<${tagName}${attr}${after}`;
      replacements.push({
        start: match.index,
        end: match.index + fullMatch.length,
        replacement: newMatch,
      });
    }
  }

  if (emitPlacements) {
    for (const r of buildPlacementPropReplacements(
      templateContent,
      elements,
      sourcePath,
      collectImportSpecifiers(originalCode),
      filePath,
      undefined,
      version,
    )) {
      replacements.push(r);
    }
  }

  // Apply right-to-left so earlier offsets stay valid. (The element scan alone
  // produces an ascending list — this sort is the same order its old
  // `.reverse()` produced, and merges the placement-prop insertions in.)
  replacements.sort((a, b) => b.start - a.start);
  for (const r of replacements) {
    modifiedTemplate =
      modifiedTemplate.slice(0, r.start) +
      r.replacement +
      modifiedTemplate.slice(r.end);
  }

  if (modifiedTemplate === templateContent) {
    return null;
  }

  const result =
    compiledCode.slice(0, templateStartIdx) +
    modifiedTemplate +
    compiledCode.slice(templateEndIdx);

  return applyParseGate(
    emitPlacements ? PLACEMENT_PRELUDE + result : result,
    options?.parseJs,
    filePath,
    compiledCode,
  );
}
