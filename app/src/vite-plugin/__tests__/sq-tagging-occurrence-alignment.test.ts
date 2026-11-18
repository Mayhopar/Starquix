/**
 * REGRESSION — the occurrence SHIFT (2026-08-05).
 *
 * `sq-tagging.js` matches AST elements to compiled tags by (tagName,
 * occurrence): the k-th compiled `<T` gets the coordinates of the k-th AST `T`.
 * The compiled scan used to recognise only `<T` followed by a space, `>` or `/`,
 * but @astrojs/compiler emits a DYNAMIC FIRST ATTRIBUTE with no separator —
 * `<a${$$addAttribute(url,"href")} class="first">` — so that tag was never
 * matched and, crucially, never COUNTED. Every later `T` in the file then
 * inherited the PREVIOUS `T`'s coordinates: a valid-looking key resolving to the
 * wrong element, so a class write, a text edit or a DELETE silently landed on a
 * neighbour.
 *
 * The contract this pins: an element of that shape must CONSUME its occurrence
 * slot, so every other element keeps its own address. Shifted is never honest.
 *
 * UPDATED for task-167 (2026-08-05): the dynamic-first element is now TAGGED
 * too — the attributes are spliced immediately after the tag name, before the
 * `${…}`. This file keeps testing the ALIGNMENT (nobody wears a neighbour's
 * address); the three cases that asserted "…and it stays untagged" were
 * ROUND 17's explicit statement of what it had left undone, and task-167 is
 * what it was left undone for. Its own coverage lives in
 * `sq-tagging-dynamic-first.test.ts`.
 *
 * `fixtures/sq-tagging-alignment-fixtures.json` holds the VERBATIM compiled
 * modules of a live `astro dev` 4.16.19 rig (only the rig's absolute root was
 * rewritten to `/rig`), one per compiled shape:
 *   - navRenderBranch  → the `$$render\`` template-literal branch
 *   - tplTemplateBranch → the memoised `__template([…])` branch, where the
 *     string chunk simply ENDS after the tag name (`"<section",`)
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@astrojs/compiler';
// eslint-disable-next-line import/no-relative-packages
import { transformCompiledOutput } from '../../../../preview-template/src/plugins/sq-tagging.js';
import fixtures from './fixtures/sq-tagging-alignment-fixtures.json';

interface AlignmentFixture {
  name: string;
  filePath: string;
  source: string;
  compiled: string;
}

const FIXTURES = fixtures as unknown as AlignmentFixture[];
const fixture = (name: string): AlignmentFixture => {
  const f = FIXTURES.find((x) => x.name === name);
  if (!f) throw new Error(`missing alignment fixture: ${name}`);
  return f;
};

/**
 * marker (`id`, else `class`) → the `data-sq-source` key on that same opening
 * tag, or null when the tag carries none. Tolerates the `__template` branch's
 * escaped quotes (`\"`), which is how the injector writes into a JS string
 * literal.
 *
 * `id` is the marker of last resort on purpose: a dynamic-first element's own
 * `class` is an EXPRESSION, so it leaves no literal `class="…"` in the compiled
 * output to find it by.
 */
function keysByMarker(code: string): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  // `[^<>]*` deliberately: in the `__template` branch a dynamic-first tag's
  // string chunk ENDS after the tag name (`"<section", ' id="s1"…`), so the
  // attribute run legitimately contains the JS quoting junk of the chunk seam.
  const tagPattern = /<[a-z][a-z0-9-]*([^<>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagPattern.exec(code)) !== null) {
    const attrs = m[1];
    const marker =
      /(?:^|\s)id=\\?"([^"\\]*)\\?"/.exec(attrs) ??
      /(?:^|\s)class=\\?"([^"\\]*)\\?"/.exec(attrs);
    if (!marker) continue;
    const key = /data-sq-source=\\?"([^"\\]*)\\?"/.exec(attrs);
    out[marker[1]] = key ? key[1] : null;
  }
  return out;
}

async function tag(f: AlignmentFixture, options?: { placements: boolean }) {
  const out = await transformCompiledOutput(
    f.compiled,
    f.source,
    f.filePath,
    '/rig',
    'relative',
    parse,
    options,
  );
  expect(out).not.toBeNull();
  return (out as { code: string }).code;
}

/*
 * Authored coordinates, read off the @astrojs/compiler AST directly (NOT off
 * the tagger, so the expectations cannot be circular):
 *   Nav.astro — nav 4:1 · a 5:3 (href=expression) · a 6:3 · a 7:3
 *   Tpl.astro — section 4:1 (class=expression) · b 4:30 · section 5:1
 */
describe('sq-tagging — a tag the injector cannot match must still consume its occurrence slot', () => {
  describe('$$render` branch — `<a${$$addAttribute(url,"href")} class="first">`', () => {
    it('hands the dynamic-first element its OWN key (task-167)', async () => {
      const keys = keysByMarker(await tag(fixture('navRenderBranch')));
      // Was `toBeNull()` between ROUND 17 and task-167 — the element consumed
      // its slot but carried no key.
      expect(keys.first).toBe('src/components/Nav.astro:5:3');
    });

    it('leaves every LATER same-tag element on its OWN coordinates', async () => {
      const keys = keysByMarker(await tag(fixture('navRenderBranch')));
      // Before the fix these were 5:3 and 6:3 — the PREVIOUS anchor's address.
      expect(keys.second).toBe('src/components/Nav.astro:6:3');
      expect(keys.third).toBe('src/components/Nav.astro:7:3');
    });

    it('the untouched static-first element keeps the key it always had', async () => {
      const keys = keysByMarker(await tag(fixture('navRenderBranch')));
      expect(keys.nav).toBe('src/components/Nav.astro:4:1');
    });

    it('holds in local mode too (placements: true)', async () => {
      const keys = keysByMarker(await tag(fixture('navRenderBranch'), { placements: true }));
      expect(keys.first).toBe('src/components/Nav.astro:5:3');
      expect(keys.second).toBe('src/components/Nav.astro:6:3');
      expect(keys.third).toBe('src/components/Nav.astro:7:3');
    });
  });

  describe('__template([…]) branch — the string chunk ends after `<section`', () => {
    it('leaves the later same-tag element on its OWN coordinates', async () => {
      const out = await tag(fixture('tplTemplateBranch'));
      // task-167: the attribute run is now spliced INSIDE that chunk, before
      // its closing quote (it used to end bare: `"<section",`).
      expect(out).toContain('"<section data-sq-source=\\"src/components/Tpl.astro:4:1\\""');
      const keys = keysByMarker(out);
      expect(keys.s1).toBe('src/components/Tpl.astro:4:1');
      // Before the fix "s2" carried 4:1 — the dynamic-first section's address.
      expect(keys.s2).toBe('src/components/Tpl.astro:5:1');
    });

    it('a DIFFERENT tag inside the same file is unaffected either way', async () => {
      const keys = keysByMarker(await tag(fixture('tplTemplateBranch')));
      expect(keys.b1).toBe('src/components/Tpl.astro:4:30');
    });
  });
});
