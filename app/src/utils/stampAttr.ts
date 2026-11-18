/**
 * task-160 — the `data-sq-id` stamp, as pure text.
 *
 * Deliberately a separate module from `vite-plugin/server/localStamp.ts`: that
 * one reads and WRITES the user's disk and is import-fenced out of `services/`
 * (see `localStampScope.test.ts`), because unifying the stamper into
 * `BaseViteWriter` would reopen the write-scope hole the 2026-08-02 data-loss
 * incident produced. The writers only ever need to recognise and remove the
 * text, so that is all this module does — no fs, no parser, no scope.
 *
 * Regex rather than an AST walk because the input is a markup FRAGMENT (an
 * insert payload is not a parseable `.astro` module), and because it must only
 * ever match text the stamper itself could have written: a grammar-valid quoted
 * `s<16 hex>`. A hand-authored opt-out (`data-sq-id={undefined}`) does not
 * match and survives untouched.
 */

/** The attribute the open-time stamping pass writes into the user's source. */
export const STAMP_ATTR = 'data-sq-id';

/** A grammar-valid stamp value: `s` = "stamped", so a key is self-classifying. */
export const STAMP_ID_PATTERN = /^s[0-9a-f]{16}$/;

const STAMP_ATTR_GLOBAL = /\s+data-sq-id=(["'])s[0-9a-f]{16}\1/g;

/**
 * Remove every stamp this feature could have written.
 *
 * Used in two places, for the same reason: spliced markup must never carry an
 * id that already belongs to a different invocation. A duplicated id is worse
 * than a sliding one — it poisons BOTH holders on the next open.
 *   - `ViteStructuralWriter.writeInsert` / `writeAppendPage` and the local
 *     component-insert path, before the bytes reach the user's file;
 *   - `POST /__sq/local/unstamp`, as the exact inverse of a stamping pass.
 */
export function stripStamps(source: string): string {
  return source.replace(STAMP_ATTR_GLOBAL, '');
}

/** Does this markup fragment carry a stamp we wrote? */
export function containsStamp(source: string): boolean {
  return /\sdata-sq-id=(["'])s[0-9a-f]{16}\1/.test(source);
}
