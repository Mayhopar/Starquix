import * as Y from 'yjs';

/**
 * Coerce a plain page.seo field value into its Yjs representation: arrays ->
 * Y.Array, objects -> (shallow) Y.Map, scalars unchanged. Null/undefined is the
 * caller's concern (UPDATE_PAGE_SEO deletes the field; hydration skips it), so
 * pass only non-null values here.
 *
 * Single source for this coercion so the UPDATE_PAGE_SEO command and
 * hydrateSeoMap stay in lockstep — a save -> hydrate round-trip must rebuild
 * the exact same Y structure the command would have produced.
 */
export function coerceSeoValueToYjs(value: unknown): unknown {
  if (Array.isArray(value)) {
    return Y.Array.from(value);
  }
  if (typeof value === 'object' && value !== null) {
    const m = new Y.Map();
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) m.set(k, v);
    return m;
  }
  return value;
}
