/**
 * task-206: pure mutators over the raw <Media/> invocation source string.
 * The invocation is machine-owned (D5) — whole-attribute rewrites are fine,
 * but everything not named by the edit passes through verbatim.
 *
 * Count reuses componentMedia's items contract; width is the v2 class
 * contract (D3: col-span-8 / col-span-12 / col-span-full); everything else is
 * a plain attribute written by setProp (task-207 D10 retired the CSS-var
 * knobs — gap/pad/margin/radius are real props now).
 * Every mutator returns null when the markup can't be edited safely —
 * the caller toasts instead of guessing.
 */
import { setMediaItemCount } from '@/components/PostEditor/componentMedia';
import type { SpanMode } from '@/components/PostEditor/WidthControl';

const hasComponentTag = (src: string) => /^\s*<[A-Z]/.test(src);

export function setCount(src: string, count: number): string | null {
  // The items-expression refusal lives in setMediaItemCount itself, so the
  // post editor's direct calls get the same protection.
  return setMediaItemCount(src, count);
}

/** D3: null = the default 8-col measure; the class is always explicit. */
export function setWidth(src: string, mode: SpanMode): string | null {
  if (!hasComponentTag(src)) return null;
  const cls = mode === 'full' ? 'col-span-full' : `col-span-${mode ?? 8}`;
  const classRe = /class\s*=\s*"([^"]*)"/;
  const m = src.match(classRe);
  if (m) {
    const replaced = /(?:^|\s)col-span-(?:\d+|full)(?:\s|$)/.test(` ${m[1]} `)
      ? m[1].replace(/col-span-(?:\d+|full)/, cls)
      : (m[1] ? `${m[1]} ${cls}` : cls);
    return src.replace(classRe, `class="${replaced}"`);
  }
  return src.replace(/^(\s*<[A-Za-z0-9_]+)/, `$1 class="${cls}"`);
}

/** Read half of the width contract — kept beside setWidth so the two
 *  regex grammars over the class attr cannot drift. */
export function getWidth(src: string | null): SpanMode {
  if (!src) return null;
  if (/col-span-full/.test(src)) return 'full';
  if (/col-span-12/.test(src)) return 12;
  return null;
}

/**
 * task-207 D2/B-rows: write ONE prop on the invocation. Everything not named
 * passes through verbatim — same law as componentMedia's items writer.
 *
 * `null` REMOVES the attribute rather than writing "" (B5): an empty attr and
 * an absent attr mean different things to the component's own defaults.
 *
 * Refuses (returns null, caller toasts) rather than guessing when the existing
 * value is an expression or the tag carries a spread — that is the user's code,
 * not ours to rewrite.
 */
export type PropValue = string | number | boolean | null;

/** `{24}` / `{true}` / `{'x'}` are ours to overwrite; `{spacing}` is not. */
const LITERAL_EXPR = /^\{\s*(?:-?\d+(?:\.\d+)?|true|false|(['"])[\s\S]*\1)\s*\}$/;

const serialize = (v: Exclude<PropValue, null>) =>
  typeof v === 'string' ? `"${v.replace(/"/g, '&quot;')}"` : `{${v}}`;

const attrPattern = (name: string) => new RegExp(`\\s${name}\\s*=\\s*("[^"]*"|\\{[^{}]*\\})`);

/** Read half of the prop contract — beside setProp so the grammars can't
 *  drift (same law as getWidth/setWidth). `undefined` = absent or non-literal. */
export function getProp(src: string | null, name: string): string | number | boolean | undefined {
  const found = src?.match(attrPattern(name));
  if (!found) return undefined;
  const raw = found[1];
  if (raw.startsWith('"')) return raw.slice(1, -1).replace(/&quot;/g, '"');
  if (!LITERAL_EXPR.test(raw)) return undefined;
  const inner = raw.slice(1, -1).trim();
  if (inner === 'true') return true;
  if (inner === 'false') return false;
  if (/^['"]/.test(inner)) return inner.slice(1, -1);
  return Number(inner);
}

export function setProp(src: string, name: string, value: PropValue): string | null {
  if (!hasComponentTag(src)) return null;
  if (/\{\s*\.\.\./.test(src)) return null; // B7
  const attrRe = attrPattern(name);
  const found = src.match(attrRe);
  // Replacements go through a FUNCTION: a `$&`/`$1` inside a user's value must
  // land in the file literally, not be expanded as a backreference.
  if (found) {
    const current = found[1];
    if (current.startsWith('{') && !LITERAL_EXPR.test(current)) return null; // B2
    if (value === null) return src.replace(attrRe, () => '');
    return src.replace(attrRe, () => ` ${name}=${serialize(value)}`);
  }
  if (value === null) return src;
  return src.replace(/^(\s*<[A-Za-z0-9_]+)/, tag => `${tag} ${name}=${serialize(value)}`);
}
