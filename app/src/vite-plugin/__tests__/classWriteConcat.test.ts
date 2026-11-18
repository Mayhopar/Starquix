/**
 * The two class writers must agree, and neither may destroy a token.
 *
 * There are TWO implementations of `replaceOrAddClassAttribute` — one in
 * `vite-plugin/ast-updater.ts` (host endpoints + export's applySourceOverrides)
 * and one in `preview-template/src/plugins/sq-source-plugin.js` (the astro-dev
 * plugin server mode and local mode write through). They are near-duplicates by
 * necessity: the plugin ships standalone JS into the user's dev server / the WC
 * snapshot, the host copy is bundled into the browser app. Nothing structural
 * keeps them in sync, and they have already drifted once
 * (`export/generateAstro.ts` carries a third, older copy that still bakes over
 * dynamic expressions). This file is the guard: every case runs through BOTH and
 * their bytes must be identical.
 *
 * Two defects it pins, both confirmed on real served bytes from `astro dev`
 * 4.16.19 before the fix:
 *
 *  A. `class={'px-4 py-3 ' + variant}` — a class edit replaced the leading
 *     literal WITHOUT its trailing space, so `'px-12 py-3' + variant` rendered
 *     `class="px-12 py-3flex gap-4"`: `py-3` and `flex` both destroyed as
 *     tokens, in the user's real .astro file.
 *  B. `class:list={['px-4 py-2', variant]}` — no branch matched, so the writer
 *     fell through to "add a class attribute". Astro does not replace the
 *     directive with it, it CONCATENATES: the served markup became
 *     `class="px-12 py-2 flex gap-4 px-4 py-2 flex gap-4"`, the original `px-4`
 *     survived and still won the cascade, and the write reported success.
 *
 * The rule for A is "preserve the original literal's trailing whitespace
 * verbatim", never "always append a space": the author of
 * `class={'text-' + size}` is building ONE token by concatenation, and a space
 * there would break the class instead of fixing it.
 *
 *  C. THE OWNERSHIP CONTRACT (task-166). A and B both left the deeper defect
 *     standing: the writer was handed the element's WHOLE EFFECTIVE class list
 *     and wrote all of it into a literal that only ever owned SOME of those
 *     tokens. Seen live twice:
 *       - `class={'text-' + size}` (size="lg") + an added `font-bold` wrote
 *         `{'text-lg font-bold' + size}` and served
 *         `class="text-lg font-boldlg"` — bold destroyed, fontWeight back to
 *         400, and the needle `text-lg font-bold` is a SUBSTRING of the garbage
 *         token so push-verify passed and the toast said success.
 *       - `class:list={['px-4 py-2', variant]}` absorbed the variant's tokens
 *         into the literal (`flex gap-4` rendered twice); REMOVING a token the
 *         variant owns "succeeded", then came back on reload with the override
 *         cleared and no dirty marker left.
 *
 *     The contract now: the ORIGINAL LITERAL TEXT in the file is the ground
 *     truth for what the literal owns, and `baseClasses` (the class list the
 *     element renders while file and doc agree) is the ground truth for what the
 *     dynamic part contributes — `dynamic = baseClasses \ owned`. Only
 *     `newClasses \ dynamic` is written. A `newClasses` that DROPS a dynamic
 *     token cannot be honoured by editing the literal at all, so it is refused
 *     with a reason instead of reported as success. A partial shape with no
 *     `baseClasses` is refused too — guessing is what produced both artefacts.
 */
import { describe, it, expect } from 'vitest';
import { updateClassAttribute } from '../ast-updater';
// eslint-disable-next-line import/no-relative-packages -- cross-tree import, same pattern as snapshot-parity
// @ts-expect-error plain-JS preview-template plugin, no types
import { updateClassAttribute as instanceUpdateClassAttribute } from '../../../../preview-template/src/plugins/sq-source-plugin.js';

interface WriteCase {
  name: string;
  /** Single-line .astro body; the element is always at 1:1. */
  source: string;
  /** The element's WHOLE effective class list, which is what the editor sends. */
  newClasses: string;
  /**
   * What the element renders while the file and the doc agree — `owned ∪
   * dynamic`. Omitted = the caller could not supply one, which every PARTIAL
   * shape must refuse rather than guess.
   */
  baseClasses?: string;
  /** Expected file content, or the substring the refusal must mention. */
  expect: { file: string } | { throws: string };
}

const CASES: WriteCase[] = [
  // ── DEFECT A — the separator ──────────────────────────────────────────────
  {
    name: "A: class={'lit ' + tail} keeps the literal's trailing space",
    source: "<div class={'px-4 py-3 ' + variant}>x</div>\n",
    baseClasses: 'px-4 py-3 flex gap-4',
    newClasses: 'px-12 py-3 flex gap-4',
    expect: { file: "<div class={'px-12 py-3 ' + variant}>x</div>\n" },
  },
  {
    name: 'A: a literal that is only whitespace still separates',
    source: "<div class={' ' + variant}>x</div>\n",
    baseClasses: 'flex',
    newClasses: 'px-12 flex',
    expect: { file: "<div class={'px-12 ' + variant}>x</div>\n" },
  },
  {
    name: "A: an EXPLICIT ' ' separator is not duplicated (the literal has no trailing space and needs none)",
    source: "<div class={'px-4 py-3' + ' ' + variant}>x</div>\n",
    baseClasses: 'px-4 py-3 flex gap-4',
    newClasses: 'px-12 py-3 flex gap-4',
    expect: { file: "<div class={'px-12 py-3' + ' ' + variant}>x</div>\n" },
  },
  {
    name: 'A: trailing whitespace is preserved even when the new list is empty',
    source: "<div class={'px-4 ' + variant}>x</div>\n",
    baseClasses: 'px-4 flex',
    newClasses: 'flex',
    expect: { file: "<div class={' ' + variant}>x</div>\n" },
  },
  {
    name: 'A: junk tokens are still filtered, and the separator survives filtering',
    source: "<div class={'a b ' + extra}>x</div>\n",
    baseClasses: 'a b z',
    newClasses: 'a b c z undefined',
    expect: { file: "<div class={'a b c ' + extra}>x</div>\n" },
  },

  // ── DEFECT B — class:list is never written BESIDE ──────────────────────────
  {
    name: 'B: class:list array — the LEADING literal is edited, never a second class attribute',
    source: "<div class:list={['px-4 py-2', variant]}>x</div>\n",
    baseClasses: 'px-4 py-2 flex gap-4',
    newClasses: 'px-12 py-2 flex gap-4',
    expect: { file: "<div class:list={['px-12 py-2', variant]}>x</div>\n" },
  },
  {
    name: 'B: class:list plain string attribute',
    source: '<div class:list="px-4 py-2">x</div>\n',
    newClasses: 'px-12 py-2',
    expect: { file: '<div class:list="px-12 py-2">x</div>\n' },
  },
  {
    name: 'B: class:list with a single braced literal',
    source: "<div class:list={'px-4'}>x</div>\n",
    newClasses: 'px-12',
    expect: { file: "<div class:list={'px-12'}>x</div>\n" },
  },
  {
    name: 'B: class:list object form is REFUSED, never written beside',
    source: '<div class:list={{ active: isActive }}>x</div>\n',
    newClasses: 'px-12',
    expect: { throws: 'class:list' },
  },
  {
    name: 'B: class:list whose first entry is dynamic is REFUSED (same asymmetry as the + tail)',
    source: "<div class:list={[variant, 'px-4']}>x</div>\n",
    newClasses: 'px-12',
    expect: { throws: 'class:list' },
  },
  {
    name: 'B: class:list with an interpolated template literal is REFUSED',
    source: '<div class:list={[`px-${n}`, variant]}>x</div>\n',
    newClasses: 'px-12',
    expect: { throws: 'class:list' },
  },

  // ── CONTRACT C — the literal owns only SOME of the tokens ─────────────────
  {
    // The V1b artefact, verbatim: a PREFIX literal owns no complete token at
    // all. Writing the effective list into it fused `font-bold` with the tail
    // (`font-boldlg`) and destroyed the weight. Only the addition belongs in
    // the literal, and it must land BEFORE the prefix fragment.
    name: "C: a prefix literal ({'text-' + size}) receives ONLY the user's addition",
    source: "<div class={'text-' + size}>x</div>\n",
    baseClasses: 'text-lg',
    newClasses: 'text-lg font-bold',
    expect: { file: "<div class={'font-bold text-' + size}>x</div>\n" },
  },
  {
    name: 'C: a token the DYNAMIC part contributes is never written into the literal',
    source: "<div class={'px-4 py-3 ' + variant}>x</div>\n",
    baseClasses: 'px-4 py-3 flex gap-4',
    newClasses: 'px-4 py-3 flex gap-4 rounded',
    expect: { file: "<div class={'px-4 py-3 rounded ' + variant}>x</div>\n" },
  },
  {
    name: 'C: REMOVING a token the dynamic part owns is refused, not reported as success',
    source: "<div class:list={['px-4 py-2', variant]}>x</div>\n",
    baseClasses: 'px-4 py-2 flex gap-4',
    newClasses: 'px-12 py-2 gap-4',
    expect: { throws: 'flex' },
  },
  {
    name: 'C: REPLACING a token the dynamic part owns is refused for the same reason',
    source: "<div class={'px-4 ' + variant}>x</div>\n",
    baseClasses: 'px-4 flex',
    newClasses: 'px-4 block',
    expect: { throws: 'flex' },
  },
  {
    name: "C: a prefix literal refuses an edit to the token it only half-owns",
    source: "<div class={'text-' + size}>x</div>\n",
    baseClasses: 'text-lg',
    newClasses: 'text-xl',
    expect: { throws: 'text-lg' },
  },
  {
    name: 'C: dropping a token the LITERAL owns IS honoured — that one it can do',
    source: "<div class={'px-4 py-3 ' + variant}>x</div>\n",
    baseClasses: 'px-4 py-3 flex',
    newClasses: 'px-4 flex',
    expect: { file: "<div class={'px-4 ' + variant}>x</div>\n" },
  },
  {
    name: 'C: a PARTIAL shape with no baseClasses is refused, never guessed',
    source: "<div class={'px-4 ' + variant}>x</div>\n",
    newClasses: 'px-12 flex',
    expect: { throws: 'builds this element\'s class list in code' },
  },
  {
    name: 'C: class:list array with no baseClasses is refused too',
    source: "<div class:list={['px-4', variant]}>x</div>\n",
    newClasses: 'px-12 flex',
    expect: { throws: 'builds this element\'s class list in code' },
  },
  {
    name: 'C: a class:list whose SOLE entry is a literal owns everything — no baseClasses needed',
    source: "<div class:list={['px-4']}>x</div>\n",
    newClasses: 'px-12 flex',
    expect: { file: "<div class:list={['px-12 flex']}>x</div>\n" },
  },
  {
    // Astro compiles `class` and `class:list` into ONE attribute, so a plain
    // literal sitting next to a directive is a PARTIAL source exactly like a
    // `+` tail — the directive's tokens must stay out of it.
    name: 'C: class="lit" beside a class:list directive is partial too',
    source: '<div class="px-4" class:list={[variant]}>x</div>\n',
    baseClasses: 'px-4 flex',
    newClasses: 'px-12 flex',
    expect: { file: '<div class="px-12" class:list={[variant]}>x</div>\n' },
  },
  {
    name: 'C: a plain class="lit" with NO directive still owns everything',
    source: '<div class="px-4">x</div>\n',
    newClasses: 'px-12 flex',
    expect: { file: '<div class="px-12 flex">x</div>\n' },
  },

  // ── unchanged honest refusals, pinned so a "fix" cannot quietly bake them ──
  {
    name: 'an interpolated template literal is still refused',
    source: '<div class={`px-4 ${variant}`}>x</div>\n',
    newClasses: 'px-12',
    expect: { throws: 'dynamic expression' },
  },
  {
    name: "a TRAILING literal (tail + ' lit') is still refused — never corrupted",
    source: "<div class={variant + ' px-4'}>x</div>\n",
    newClasses: 'px-12',
    expect: { throws: 'dynamic expression' },
  },
  {
    name: 'a ternary is still refused',
    source: "<div class={cond ? 'a' : 'b'}>x</div>\n",
    newClasses: 'a c',
    expect: { throws: 'dynamic expression' },
  },
];

/** Route 1: the host copy (server write endpoints + export/applySourceOverrides). */
async function viaAstUpdater(c: WriteCase): Promise<string> {
  return updateClassAttribute(
    c.source,
    'src/Test.astro',
    { file: 'src/Test.astro', line: 1, column: 1 },
    c.newClasses,
    c.baseClasses,
  );
}

describe('class writers: concatenation and class:list (defects A + B)', () => {
  /** Route 2: the instance's own transform (the socket write handler that
   *  used to wrap it was retired 2026-10-18). A refusal leaves the file as is. */
  async function viaPlugin(c: WriteCase): Promise<{ ok: boolean; error?: string; file: string }> {
    try {
      const file = await instanceUpdateClassAttribute(c.source, 'src/Test.astro',
        { file: 'src/Test.astro', line: 1, column: 1 }, c.newClasses, c.baseClasses);
      return { ok: true, file };
    } catch (error) {
      return { ok: false, error: (error as Error).message, file: c.source };
    }
  }

  for (const c of CASES) {
    it(`${c.name} — host writer`, async () => {
      if ('throws' in c.expect) {
        await expect(viaAstUpdater(c)).rejects.toThrow(c.expect.throws);
      } else {
        expect(await viaAstUpdater(c)).toBe(c.expect.file);
      }
    });

    it(`${c.name} — astro-dev plugin`, async () => {
      const r = await viaPlugin(c);
      if ('throws' in c.expect) {
        // An honest refusal: success:false with a message the DesignBar toasts
        // ("Style not saved to X.astro: …"), and the file untouched.
        expect(r.ok).toBe(false);
        expect(r.error).toContain(c.expect.throws);
        expect(r.file).toBe(c.source);
      } else {
        expect(r.ok).toBe(true);
        expect(r.file).toBe(c.expect.file);
      }
    });
  }

  it('the two implementations produce IDENTICAL bytes for every case', async () => {
    for (const c of CASES) {
      const host = await viaAstUpdater(c).then(
        f => ({ kind: 'file' as const, value: f }),
        (e: Error) => ({ kind: 'throw' as const, value: e.message }),
      );
      const plugin = await viaPlugin(c);
      const runtime = plugin.ok
        ? { kind: 'file' as const, value: plugin.file }
        : { kind: 'throw' as const, value: plugin.error ?? '' };
      expect({ case: c.name, ...runtime }).toEqual({ case: c.name, ...host });
    }
  });
});
