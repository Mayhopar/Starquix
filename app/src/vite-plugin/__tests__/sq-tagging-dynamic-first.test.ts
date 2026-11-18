/**
 * REGRESSION — the DYNAMIC-FIRST element had no identity at all (task-167,
 * 2026-08-05).
 *
 * @astrojs/compiler emits an element whose FIRST attribute is dynamic with NO
 * separator after the tag name:
 *
 *   <div class={cls}>        →  <div${$$addAttribute(cls, "class")}>
 *   <div class:list={[…]}>   →  <div${$$addAttribute([…], "class:list")}>
 *   <div {...rest}>          →  <div${$$spreadAttributes(rest)}>
 *
 * ROUND 17 taught both scans to COUNT such a tag so it stops shifting its
 * same-tag siblings, but deliberately injected nothing into it. That left the
 * element with **no `data-sq-source` and no `data-sq-placement`**, which is
 * task-182: a component ROOT of that shape falls back to
 * `data-astro-source-*`, and the bridge's `resolvePlacement` walks past it with
 * `closest('[data-sq-placement]')` to the LAYOUT's div — so two placements of
 * the same component share ONE placement id and `localOverridesForPlacement`
 * cannot separate them. Push on placement B then writes A's unpushed edit into
 * the master.
 *
 * The contract this pins: such an element is TAGGED, with the attributes
 * spliced OUTSIDE the `${…}` expression, in BOTH compiled branches.
 *
 * `fixtures/sq-tagging-dynamic-first-fixtures.json` holds the VERBATIM compiled
 * modules of a plugin-free `astro dev` 4.16.19 control (astro 4.16.19,
 * @astrojs/compiler 2.13.0). Only three normalisations were applied: the rig's
 * absolute root → `/rig`, vite's `/@fs/…` resolution of astro's compiler runtime
 * → `astro/compiler-runtime`, and the trailing `//# sourceMappingURL=` blob
 * dropped (it embeds the absolute root).
 *
 * Authored coordinates below were read off a direct @astrojs/compiler AST parse,
 * NOT off the tagger, so the expectations cannot be circular:
 *   DynCard.astro  — div 4:1 (class=expression) · p 5:3
 *   TplCard.astro  — section 5:1 (class=expression) · b 5:30 · section 6:1
 *   Nav.astro      — nav 4:1 · a 5:3 (href=expression) · a 6:3 · a 7:3
 *   Spread.astro   — div 4:1 (spread) · span 4:16
 *   ListCard.astro — div 4:1 (class:list=expression) · span 4:37
 *   Base.astro     — head 9:3 · title 9:9 · body 10:3 · div 11:5
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@astrojs/compiler';
import { parseAst } from 'rollup/parseAst';
// eslint-disable-next-line import/no-relative-packages
import { transformCompiledOutput } from '../../../../preview-template/src/plugins/sq-tagging.js';
import fixtures from './fixtures/sq-tagging-dynamic-first-fixtures.json';
import { withoutSourceVersionEnvelope } from './taggingVersionTestUtils';

interface DynamicFirstFixture {
  name: string;
  filePath: string;
  source: string;
  compiled: string;
}

const FIXTURES = fixtures as unknown as DynamicFirstFixture[];
const fixture = (name: string): DynamicFirstFixture => {
  const f = FIXTURES.find((x) => x.name === name);
  if (!f) throw new Error(`missing dynamic-first fixture: ${name}`);
  return f;
};

/**
 * `data-astro-source-loc` → the `data-sq-source` on that SAME opening tag (null
 * when the tag carries none).
 *
 * Astro's own annotation is the locator on purpose: it is present on every
 * element in the verbatim fixture, it is emitted by the compiler rather than by
 * the code under test, and — unlike `class` — it survives a dynamic-first
 * element, whose own `class` is an EXPRESSION and therefore leaves no literal
 * `class="…"` to find it by. (It is also a DIFFERENT address from the tagger's:
 * `data-astro-source-loc` is the CONTENT start, `4:30`, where the tagger emits
 * the TAG start, `4:1`. That gap is exactly the bug.)
 *
 * `[^<>]*` and the optional `\\` tolerate the `__template` branch, where the
 * attribute run legitimately spans a JS string seam with escaped quotes.
 */
function sqByAstroLoc(code: string): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const tagPattern = /<[a-z][a-z0-9-]*([^<>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagPattern.exec(code)) !== null) {
    const attrs = m[1];
    const loc = /data-astro-source-loc=\\?"([^"\\]*)\\?"/.exec(attrs);
    if (!loc) continue;
    const key = /data-sq-source=\\?"([^"\\]*)\\?"/.exec(attrs);
    out[loc[1]] = key ? key[1] : null;
  }
  return out;
}

/** Same locator, but reading the placement attribute instead. */
function placementByAstroLoc(code: string): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const tagPattern = /<[a-z][a-z0-9-]*([^<>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagPattern.exec(code)) !== null) {
    const attrs = m[1];
    const loc = /data-astro-source-loc=\\?"([^"\\]*)\\?"/.exec(attrs);
    if (!loc) continue;
    const pl = /data-sq-placement=\\?"((?:[^"\\]|\\u)*)\\?"/.exec(attrs);
    out[loc[1]] = pl ? pl[1] : null;
  }
  return out;
}

async function tag(f: DynamicFirstFixture, options?: Record<string, unknown>) {
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
  return withoutSourceVersionEnvelope((out as { code: string }).code);
}

const LOCAL = { placements: true } as const;

describe('sq-tagging — an element whose FIRST attribute is dynamic gets its own identity', () => {
  describe('$$render` branch — `<div${$$addAttribute(cls, "class")}>`', () => {
    it('the dynamic-first component ROOT gets its own data-sq-source', async () => {
      const keys = sqByAstroLoc(await tag(fixture('dynCardRenderBranch')));
      // Before the fix this was null — the root had NO key and fell back to
      // astro's own `4:30` (the CONTENT start), which is a different address.
      expect(keys['4:30']).toBe('src/components/DynCard.astro:4:1');
    });

    it('the dynamic-first root gets a data-sq-placement (task-182)', async () => {
      const pl = placementByAstroLoc(await tag(fixture('dynCardRenderBranch'), LOCAL));
      // The per-render read of the placing site. Two invocations of DynCard
      // therefore render two DIFFERENT ids instead of both inheriting the
      // layout's.
      expect(pl['4:30']).toBe('${$$sqPl($$props)}');
    });

    it('emits the transitional -lq / -lp chains on it too, exactly as on a tagged element', async () => {
      const code = await tag(fixture('dynCardRenderBranch'), LOCAL);
      expect(code).toContain(
        '<div data-sq-source="src/components/DynCard.astro:4:1"' +
          ' data-sq-placement="${$$sqPl($$props)}"' +
          ' data-sq-lq="${$$sqLq($$props)}" data-sq-lp="${$$sqLp($$props)}"' +
          ' data-sq-usage="${$$sqAt($$props)}"' +
          '${$$addAttribute("card " + label, "class")}',
      );
    });

    it('splices OUTSIDE the ${…} expression — the expression text is byte-unchanged', async () => {
      const code = await tag(fixture('dynCardRenderBranch'), LOCAL);
      const expr = '${$$addAttribute("card " + label, "class")}';
      expect(code).toContain(expr);
      // nothing of ours landed between `${` and its matching `}`
      expect(code.slice(code.indexOf(expr), code.indexOf(expr) + expr.length)).not.toMatch(
        /data-sq-source/,
      );
    });

    it('the static-first sibling keeps the key it always had', async () => {
      const keys = sqByAstroLoc(await tag(fixture('dynCardRenderBranch')));
      expect(keys['5:23']).toBe('src/components/DynCard.astro:5:3');
    });

    it('a {...spread} first attribute is the same shape and is tagged too', async () => {
      const keys = sqByAstroLoc(await tag(fixture('spreadRoot')));
      expect(keys['4:40']).toBe('src/components/Spread.astro:4:16'); // the static sibling
      const code = await tag(fixture('spreadRoot'));
      expect(code).toContain(
        '<div data-sq-source="src/components/Spread.astro:4:1"${$$spreadAttributes(rest)}',
      );
    });

    it('a class:list first attribute is the same shape and is tagged too', async () => {
      const code = await tag(fixture('classListRoot'));
      expect(code).toContain('<div data-sq-source="src/components/ListCard.astro:4:1"${');
      const keys = sqByAstroLoc(await tag(fixture('classListRoot')));
      expect(keys['4:38']).toBe('src/components/ListCard.astro:4:1');
    });
  });

  describe('__template([…]) branch — the string chunk ENDS at the tag name', () => {
    it('the dynamic-first root gets its own key, spliced inside the chunk', async () => {
      const code = await tag(fixture('tplCardTemplateBranch'));
      // The chunk used to end bare: `"<section",`.
      expect(code).toContain('"<section data-sq-source=\\"src/components/TplCard.astro:5:1\\""');
      const keys = sqByAstroLoc(code);
      expect(keys['5:31']).toBe('src/components/TplCard.astro:5:1');
    });

    it('the later same-tag sibling stays on its OWN coordinates (ROUND 17 holds)', async () => {
      const keys = sqByAstroLoc(await tag(fixture('tplCardTemplateBranch')));
      expect(keys['6:29']).toBe('src/components/TplCard.astro:6:1');
      expect(keys['5:44']).toBe('src/components/TplCard.astro:5:30');
    });

    it('carries the placement SENTINELS, so $$sqTpl substitutes them per render', async () => {
      const code = await tag(fixture('tplCardTemplateBranch'), LOCAL);
      expect(code).toContain(
        '"<section data-sq-source=\\"src/components/TplCard.astro:5:1\\"' +
          ' data-sq-placement=\\"\\u0000sqp\\u0000\\"' +
          ' data-sq-lq=\\"\\u0000sqq\\u0000\\" data-sq-lp=\\"\\u0000sql\\u0000\\"' +
          ' data-sq-usage=\\"\\u0000squ\\u0000\\""',
      );
      expect(code).toContain('$$sqTpl(');
    });
  });

  describe('the ROUND 17 alignment contract is unchanged', () => {
    it('the dynamic-first <a> now has its own key and its siblings did not move', async () => {
      const keys = sqByAstroLoc(await tag(fixture('navAlignment')));
      expect(keys['5:31']).toBe('src/components/Nav.astro:5:3'); // was null
      expect(keys['6:21']).toBe('src/components/Nav.astro:6:3');
      expect(keys['7:20']).toBe('src/components/Nav.astro:7:3');
      expect(keys['4:18']).toBe('src/components/Nav.astro:4:1');
    });

    it('a file with NO dynamic-first element is untouched by this change', async () => {
      const keys = sqByAstroLoc(await tag(fixture('baseLayout')));
      expect(keys['11:29']).toBe('src/layouts/Base.astro:11:5');
    });
  });

  describe('the spliced module is still valid JS — both branches, both call shapes', () => {
    for (const name of [
      'dynCardRenderBranch',
      'tplCardTemplateBranch',
      'navAlignment',
      'spreadRoot',
      'classListRoot',
      'baseLayout',
    ]) {
      it(`${name} parses after tagging (6-arg WC/server and local)`, async () => {
        const wc = await tag(fixture(name));
        const local = await tag(fixture(name), LOCAL);
        // The INPUT parses too, so a failure below can only be the tagger's.
        expect(() => parseAst(fixture(name).compiled)).not.toThrow();
        expect(() => parseAst(wc)).not.toThrow();
        expect(() => parseAst(local)).not.toThrow();
      });
    }
  });
});
