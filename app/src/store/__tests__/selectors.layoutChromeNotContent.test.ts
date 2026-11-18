/**
 * C4 dup-slot-node root cause (runtime-proven 2026-08-26, WC live session):
 *
 * The eager rootElementIds seed mapped the scanned layout-chrome slot
 * (`layoutchrome-<pageId>:slot-0`, an instance-child key) to its instanceId —
 * the layout-chrome element itself — and REORDER_PAGE_ELEMENTS inserted it
 * into rootElementIds, violating layoutElement.ts's "NEVER inserted into
 * rootElementIds" invariant. selectPageComponents then rendered the chrome as
 * page CONTENT filling its own default slot:
 *
 *   <div data-key="…:slot-0" data-sq-slot><slot data-key="…:slot-0"/></div>
 *
 * — two nodes, ONE key. Every downstream judged defect follows: React dup-key
 * spam from `…:slot-0`, the empty-slot "Choose Component" placeholder
 * coexisting with inserted content, master-drawn chrome nesting INSIDE the
 * slot subtree in Layers, and the double-height stale render after a master
 * move (chrome drawn once as chrome + once as content).
 *
 * Two guards, both tested here + the seed filter in scanning.seedGuard.test:
 * renderer skip (heals docs already poisoned) and seed exclusion (stops new
 * poisoning).
 */
import { describe, it, expect } from 'vitest';
import { applyCommand } from '../commands';
import { createEditorDoc } from '../createEditorDoc';
import { selectPageComponents } from '../selectors';
import { ensureLayoutElement, pageLayoutElementId } from '../layoutElement';

const LAYOUT_BODY = [
  '<!doctype html><html><head><title>t</title></head><body>',
  '<slot />',
  '</body></html>',
].join('');

function dataKeyCounts(markup: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of markup.matchAll(/data-key="([^"]+)"/g)) {
    out.set(m[1], (out.get(m[1]) ?? 0) + 1);
  }
  return out;
}

describe('layout chrome is never rendered as page content', () => {
  it('a poisoned rootElementIds (chrome id seeded as root) renders ONE node per key', () => {
    const doc = createEditorDoc();
    applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'p1', name: 'Home', rootElementIds: [], children: [] } });
    applyCommand(doc, { type: 'SET_PAGE_LAYOUT', pageId: 'p1', layoutName: 'L' });
    ensureLayoutElement(doc, 'p1', 'L', LAYOUT_BODY);

    // The poison: the eager scan seed used to push the chrome element id here.
    applyCommand(doc, {
      type: 'REORDER_PAGE_ELEMENTS',
      pageId: 'p1',
      elementIds: [pageLayoutElementId('p1')],
    });

    const out = selectPageComponents(doc, 'p1', new Map([['L', LAYOUT_BODY]]));
    expect(out).toHaveLength(1);
    const markup = out[0].staticMarkup;

    // No key may appear on two nodes — the div+slot twin pair was the
    // observed corruption.
    for (const [key, count] of dataKeyCounts(markup)) {
      expect(count, `data-key ${key} appears ${count}x in: ${markup}`).toBe(1);
    }
    // The empty chrome stays the literal <slot> (placeholder renders on it),
    // never a filled wrapper containing its own chrome.
    expect(markup).toMatch(/<slot\b/i);
    expect(markup).not.toMatch(/data-sq-slot/);
  });
});
