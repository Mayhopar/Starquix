/**
 * task-207 D2: a component's Props declaration IS its editable-surface
 * manifest. Three tiers, in precedence order:
 *   2. `interface Props` / `type Props = {…}` — types pick the control.
 *   1. `const { a, b = 'x' } = Astro.props` — names + defaults only; every
 *      prop is a text field unless its NAME reads as media.
 *   3. `/** @tag *​/` doc-comments — only for what neither can express.
 * Absent or malformed input yields an EMPTY manifest, never an error (D3).
 */
export type Control =
  | { kind: 'text' }
  | { kind: 'number'; unit: string; min?: number; max?: number; step?: number }
  | { kind: 'boolean' }
  | { kind: 'enum'; values: (string | number)[] }
  /** An array-of-paths prop: N slots, count editable (Media's `items`). */
  | { kind: 'slots' }
  /** A single-path prop: one fixed slot (DoubleImage's `src1`). */
  | { kind: 'slot' };

export interface PropSpec {
  name: string;
  /** Humanized `name` unless `@label` overrides it. */
  label: string;
  control: Control;
  /** Literal default from the destructuring, when there is one. */
  default?: string;
}

export interface Manifest {
  props: PropSpec[];
}

export const EMPTY_MANIFEST: Manifest = { props: [] };
