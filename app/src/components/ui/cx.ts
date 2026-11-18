/**
 * cx - class joiner for the ui/ kit.
 *
 * twMerge-based so caller `className` overrides win over component defaults
 * (e.g. `<Row className="pl-0">` beats the built-in `pl-1`).
 */
import { twMerge } from 'tailwind-merge';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return twMerge(parts.filter(Boolean).join(' '));
}
