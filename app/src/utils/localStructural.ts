/**
 * task-133 Task 4: shared placement resolver + post-write selection
 * prediction for local-mode structural ops.
 *
 * Pure functions — no React, no store access. Callers pass the selected
 * scanned element (or null), the current scan, and the page's source file.
 *
 * SEQUENCING RULE (binding, Task 3 reviewer finding): consumers MUST await
 * each same-file structural write (insert/remove/move/import) before issuing
 * the next one — writes race the HMR reload and a second write computed
 * against pre-reload line numbers corrupts the file.
 */

import type { SourceLocation } from '@/core/state/index';
import type { ScannedElement } from '@/context/SelectionContext';
import type { StructuralInsertPosition } from '@/services/ViteStructuralWriter';

/**
 * HTML void tags — cannot take children, so they are never inside-end
 * targets. MUST stay in sync with STRUCTURAL_VOID_TAGS in
 * preview-template/src/plugins/sq-source-plugin.js (Task 1 throws on
 * inside-end into these). Self-closing syntax on a non-void tag can't be
 * known from the tag name alone; those are treated as containers and the
 * plugin is the final guard.
 */
const VOID_TAGS = new Set([
  'img', 'br', 'hr', 'input', 'meta', 'link', 'source',
  'area', 'base', 'col', 'embed', 'track', 'wbr',
]);

/**
 * Tags the HTML parser auto-closes before block content (C5 local,
 * 2026-08-26): splicing a <div>/<section> inside a <p> writes invalid markup
 * — the browser hoists the element out of the <p>, so it renders somewhere
 * the user never put it while the FILE keeps the broken nesting. Treated like
 * void tags for insert targeting: the new element lands AFTER.
 * ponytail: `p` is the only tag with auto-close-before-block semantics;
 * headings etc. parse as written and stay containers.
 */
const NO_BLOCK_CHILD_TAGS = new Set(['p']);

/**
 * Text-leaf tags the NO-SELECTION fallback never appends INTO. With nothing
 * selected the intent is "add to the page": landing a new <h1> inside the
 * last <h2> (h2 > h2 > h1 nesting, MCP live run 2026-09-20) is never it.
 * Explicit selections keep the container semantics (the user chose the box).
 */
const TEXT_LEAF_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'a', 'button', 'label', 'strong', 'em', 'b', 'i', 'small', 'code']);
/**
 * Sectioning / self-contained blocks the NO-SELECTION fallback appends AFTER,
 * not into: a new page section belongs beside the last one, never inside it
 * (MCP live run 2026-09-20: the footer landed inside the last <section>).
 * Wrappers (main, div, …) keep inside-end — that IS "the page body".
 */
const NO_FALLBACK_INTO = new Set([...TEXT_LEAF_TAGS, 'section', 'article', 'header', 'footer', 'nav', 'aside', 'form', 'table', 'ul', 'ol', 'figure', 'p']);

/** Loop-generated copy / component instance key (`file:line:col#n`). */
function isInstanceKey(key: string): boolean {
  return /#\d+$/.test(key);
}

function isContainerTag(tagName: string): boolean {
  const t = tagName.toLowerCase();
  return !VOID_TAGS.has(t) && !NO_BLOCK_CHILD_TAGS.has(t);
}

export type InsertTargetResult =
  | { loc: SourceLocation; position: StructuralInsertPosition }
  /**
   * Fix 1 (task-148): no DOM anchor in the page file, but we DO have a page
   * file — the caller must use the page-BODY anchor (viteStructuralWriter
   * .writeAppendPage → sq:write-append-page), which the plugin resolves from
   * the file itself. This is the normal outcome for a layout-based page whose
   * template body is only component tags (no scanned node carries the page
   * file's key) — i.e. essentially every real Astro page.
   */
  | { pageBody: true }
  | { error: 'component-instance' | 'no-target' };

/**
 * task-133 Task 9: honest outcome of a local structural insert module
 * (localComponentInsert / localDrawInsert). UI callers may ignore it (they
 * toast internally); the AI tools relay `reason` into the tool result so the
 * model never reports false success on an unresolved write.
 */
export type LocalStructuralResult =
  | { ok: true; file: string; insertedLine: number }
  | { ok: false; reason: string };

/**
 * Clamp a ⌘K insert anchor to the PAGE file (task-149).
 *
 * On a real Astro page almost everything visible is rendered BY a component,
 * so a scanned element's `sourceLocation.file` is that component's file. The
 * write-scope law refuses a cross-file target (it would rewrite the master for
 * every page) — which meant that selecting anything on the page and adding a
 * component did nothing but a toast. The user's intent ("put this component on
 * THIS page") is expressible without touching the master: walk up the scan to
 * the nearest ancestor that really lives in the page file and anchor there;
 * with none (a component-only page) return null so the caller falls back to the
 * page-BODY anchor.
 *
 * ⌘K insert only — a DRAW keeps the honest refusal, because silently relocating
 * a box the user drew on top of a component is worse than saying no.
 *
 * A same-file selection is returned untouched (`#n` copies included, so the
 * component-instance refusal in resolveInsertTarget still fires).
 */
export function resolvePageFileAnchor(
  selection: ScannedElement | null,
  scannedElements: ScannedElement[],
  pageFile: string | null,
): ScannedElement | null {
  if (!selection || !pageFile) return selection;
  if (selection.sourceLocation?.file === pageFile) return selection;

  const byKey = new Map(scannedElements.map((e) => [e.key, e]));
  let node = selection;
  // Bounded by the scan size: a malformed parentKey cycle can't spin forever.
  for (let i = 0; i < scannedElements.length; i++) {
    const parent = node.parentKey ? byKey.get(node.parentKey) : undefined;
    if (!parent) return null;
    if (parent.sourceLocation?.file === pageFile && !isInstanceKey(parent.key)) return parent;
    node = parent;
  }
  return null;
}

/**
 * Resolve where a structural insert should land.
 *
 * - Container selected → inside-end of it; void tag → after it.
 * - Instance-suffixed selection (#n) → refused ('component-instance'):
 *   structural ops on loop copies / component instances are blocked.
 * - Cross-file selection (element inside a user component rendered on the
 *   page) is VALID — files-truth: the write targets the component file.
 * - No selection (or selection without a sourceLocation) → fallback: the
 *   LAST root-level scanned element of pageFile. "Root-level" = its parent
 *   (via parentKey) is null, missing from the scan, or lives in a different
 *   file; "last" = highest line, then column (ScannedElement has no depth
 *   field — parentKey + line order is the real shape). Instance copies are
 *   skipped.
 * - No root-level element for pageFile → { pageBody: true } (Fix 1,
 *   task-148): component-only pages carry NO node keyed to the page file, so
 *   the anchor must be resolved server-side from the file. 'no-target' is now
 *   reserved for "there is no page file at all".
 */
export function resolveInsertTarget(
  selection: ScannedElement | null,
  scannedElements: ScannedElement[],
  pageFile: string | null
): InsertTargetResult {
  if (!pageFile) return { error: 'no-target' };
  if (selection) {
    if (isInstanceKey(selection.key)) return { error: 'component-instance' };
    if (selection.sourceLocation) {
      return {
        loc: selection.sourceLocation,
        position: isContainerTag(selection.tagName) ? 'inside-end' : 'after',
      };
    }
    // Selection with no source location (e.g. drawn element): fall through
    // to the page-anchor fallback — there is nothing to target in source.
  }

  const byKey = new Map(scannedElements.map((e) => [e.key, e]));
  const roots = scannedElements.filter((e) => {
    if (!e.sourceLocation || e.sourceLocation.file !== pageFile) return false;
    if (isInstanceKey(e.key)) return false;
    if (!e.parentKey) return true;
    const parent = byKey.get(e.parentKey);
    return !parent || parent.sourceLocation?.file !== pageFile;
  });
  if (roots.length === 0) return { pageBody: true };

  const last = roots.reduce((a, b) => {
    const la = a.sourceLocation!;
    const lb = b.sourceLocation!;
    if (lb.line !== la.line) return lb.line > la.line ? b : a;
    return lb.column > la.column ? b : a;
  });
  const tag = last.tagName.toLowerCase();
  return {
    loc: last.sourceLocation!,
    position: isContainerTag(tag) && !NO_FALLBACK_INTO.has(tag) ? 'inside-end' : 'after',
  };
}

/**
 * Key prefix the freshly inserted element is expected to scan as
 * (`file:line:` — column is unknowable before the rescan).
 */
export function predictSelectionKey(file: string, insertedLine: number): string {
  return `${file}:${insertedLine}:`;
}

/**
 * Strip a task-149 placement segment and/or an instance suffix, then parse
 * `file:line:col`. (Only `matchPredictedKey`'s second branch reaches this, and
 * its first branch — a literal `file:line:` prefix match — already accepts
 * placement-scoped keys. The `~p…` alternative here is defence-in-depth for
 * any future caller.)
 */
function parseKey(key: string): { file: string; line: number; column: number } | null {
  // task-160: `[pqs]` — `s` is the STAMPED placement id (the current one),
  // `q` task-159's ordinal id and `p` the original coordinate id; stored keys
  // carry either legacy form until they migrate. Miss `s` here and every
  // stamped key silently stops resolving to a source location.
  const m = /^(.*):(\d+):(\d+)(?:~[pqs][0-9a-f]{16})?(?:#\d+)?$/.exec(key);
  if (!m) return null;
  return { file: m[1], line: parseInt(m[2], 10), column: parseInt(m[3], 10) };
}

/**
 * Find the fresh scan key for a predicted insert (see predictSelectionKey).
 * Column always drifts (re-key precedent: scanning.ts matches by file:line),
 * and the line itself can drift by one when the plugin added a separator
 * newline around the inserted markup — so match, in order: exact line, then
 * line+1 (separator inserted BEFORE the markup pushes it down), then line-1.
 * At each line: literal prefix match first, then parsed file:line compare
 * (covers keys with unusual column formatting). Instance-suffixed keys are
 * skipped — a newly inserted element's first occurrence is unsuffixed.
 * Returns null when nothing matches.
 *
 * `exactLineOnly` (task-133 Task 5 carry-forward b): component inserts pass
 * true — when the inserted component's root emits no data-sq-source (no
 * Astro.props spread), the ±1 fuzz would select a shifted SIBLING instead.
 */
export function matchPredictedKey(
  predicted: string,
  freshKeys: string[],
  opts: { exactLineOnly?: boolean } = {}
): string | null {
  const m = /^(.*):(\d+):$/.exec(predicted);
  if (!m) return null;
  const file = m[1];
  const line = parseInt(m[2], 10);

  for (const ln of opts.exactLineOnly ? [line] : [line, line + 1, line - 1]) {
    const prefix = `${file}:${ln}:`;
    const hit =
      freshKeys.find((k) => !isInstanceKey(k) && k.startsWith(prefix)) ??
      freshKeys.find((k) => {
        if (isInstanceKey(k)) return false;
        const p = parseKey(k);
        return p !== null && p.file === file && p.line === ln;
      });
    if (hit) return hit;
  }
  return null;
}

/**
 * The ONE spelling of "what do I write after `from` in an import statement":
 * a POSIX-relative specifier from one repo-relative source FILE to another,
 * './'-prefixed unless it climbs ('../…'). Local component inserts and local
 * layout applies both write an `import X from '<spec>'` line into the same
 * frontmatter, so they must agree byte-for-byte.
 *
 * The target's basename is never consumed as a shared directory segment
 * (`i < t.length - 1`) — a file is not a directory.
 */
export function importSpecifierFor(fromFile: string, toFile: string): string {
  const f = fromFile.split('/').slice(0, -1).filter((s) => s && s !== '.');
  const t = toFile.split('/').filter((s) => s && s !== '.');
  let i = 0;
  while (i < f.length && i < t.length - 1 && f[i] === t[i]) i++;
  const spec = [...Array<string>(f.length - i).fill('..'), ...t.slice(i)].join('/');
  return spec === '..' || spec.startsWith('../') ? spec : `./${spec}`;
}

/**
 * Build the markup + import statement pieces for inserting a user component
 * onto a page. importName is the sanitized PascalCase of component.name
 * (throws when nothing valid survives); importPath comes from the shared
 * importSpecifierFor.
 */
export function buildLocalComponentInsert(
  component: { name: string; path: string },
  pageFile: string
): { tagMarkup: string; importName: string; importPath: string } {
  let name = component.name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('')
    .replace(/^[0-9]+/, '');
  if (name) name = name[0].toUpperCase() + name.slice(1);
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
    throw new Error(
      `[localStructural] cannot derive a component identifier from name "${component.name}"`
    );
  }

  const importPath = importSpecifierFor(pageFile, component.path);

  return { tagMarkup: `<${name} />`, importName: name, importPath };
}
