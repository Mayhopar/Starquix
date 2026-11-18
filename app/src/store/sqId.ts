/**
 * task-118 — data-sq-id minting. Ids are stable rebind anchors for positional
 * override selectors: minted lazily into `masters[astroSource].markup` when an
 * override is created, consumed by computeSelectorRemap on SET_MASTER_MARKUP.
 * Doc-only (v1): zero disk writes; export strips the attribute.
 *
 * MUST NOT bump masters `rev` — the id is semantically invisible; a bump
 * would flip ↻ on every overridden placement (ledger #21).
 */
import * as Y from 'yjs';
import { MASTERS_MAP } from './masters';
import { SQ_ID_ATTR, tokenizeForRemap } from './selectorRemap';

/** Positional instance-child selector — excludes dynamic:*, blogcard, drawn-*, layoutchrome-* (ledger #32). */
const SELECTOR_RE = /^[a-z][a-z0-9]*-\d+$/;

/** 6-char base36 id, regenerated until it doesn't collide within `markup`. */
export function mintSqId(markup: string): string {
  for (;;) {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    const id = Array.from(bytes, (b) => (b % 36).toString(36)).join('');
    if (!markup.includes(`${SQ_ID_ATTR}="${id}"`)) return id;
  }
}

/**
 * Ensure the element at `selector` in the instance's master markup carries a
 * data-sq-id. Creates the masters entry from the instance's frozen
 * staticMarkup when absent (keys already stamped — baseMarkup re-stamps per
 * placement anyway). Never touches `rev`.
 */
export function ensureSqIdInMasters(doc: Y.Doc, instanceEl: Y.Map<unknown>, selector: string): void {
  const astroSource = instanceEl.get('astroSource') as string | undefined;
  if (!astroSource) return;
  if (!SELECTOR_RE.test(selector)) return;

  const masters = doc.getMap(MASTERS_MAP);
  let entry = masters.get(astroSource) as Y.Map<unknown> | undefined;
  if (!entry) {
    const frozen = instanceEl.get('staticMarkup') as string | undefined;
    if (!frozen) return;
    entry = new Y.Map();
    entry.set('markup', frozen);
    masters.set(astroSource, entry);
  }

  const markup = entry.get('markup') as string | undefined;
  if (!markup) return;
  const token = tokenizeForRemap(markup).find((t) => t.selector === selector);
  if (!token) return; // selector doesn't resolve in this markup — nothing to anchor
  if (token.sqId) return; // already minted

  const pos = token.start + 1 + token.tag.length;
  entry.set(
    'markup',
    markup.slice(0, pos) + ` ${SQ_ID_ATTR}="${mintSqId(markup)}"` + markup.slice(pos)
  );
}
