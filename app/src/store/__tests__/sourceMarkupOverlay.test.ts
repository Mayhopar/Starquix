/**
 * Inline-link markup overlay (UPDATE_SOURCE_MARKUP) — the doc tier that makes
 * a link wrap/unwrap on a source-tracked element survive in WC (where the
 * file writer silently no-ops) and across preview reloads (scan re-apply).
 *
 * Regression tests for the WC-vs-local parity gap: MARKUP_CHANGED's source
 * branch used to persist ONLY via viteTextWriter.writeTextUpdate, so in WC
 * the link existed in the iframe DOM alone and vanished on reload.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import {
  LINK_MARKUP_FIELD,
  linkMarkupFlatText,
  forEachSourceLinkAttrsEntry,
} from '../sourceOverrideEntries';

const KEY = 'src/components/Hero.astro:5:1';
const MARKUP = 'Visit <a href="/about">our team</a> today';

function entryMap(doc: Y.Doc, key: string): Y.Map<unknown> | undefined {
  return doc.getMap('sourceLinkAttributes').get(key) as Y.Map<unknown> | undefined;
}

describe('UPDATE_SOURCE_MARKUP', () => {
  it('stores the markup under LINK_MARKUP_FIELD in sourceLinkAttributes', () => {
    const doc = new Y.Doc();
    const ok = applyCommand(doc, { type: 'UPDATE_SOURCE_MARKUP', sourceKey: KEY, markup: MARKUP });
    expect(ok).toBe(true);
    expect(entryMap(doc, KEY)?.get(LINK_MARKUP_FIELD)).toBe(MARKUP);
  });

  it('refuses non-source keys (instance-child markup has its own overlay)', () => {
    const doc = new Y.Doc();
    const ok = applyCommand(doc, {
      type: 'UPDATE_SOURCE_MARKUP', sourceKey: 'el-123:h2-0', markup: MARKUP,
    });
    expect(ok).toBe(false);
    expect(doc.getMap('sourceLinkAttributes').size).toBe(0);
  });

  it('coexists with real link attributes on the same entry', () => {
    const doc = new Y.Doc();
    applyCommand(doc, {
      type: 'UPDATE_LINK_ATTRIBUTE', elementId: KEY, attribute: 'href', value: '/pricing',
    });
    applyCommand(doc, { type: 'UPDATE_SOURCE_MARKUP', sourceKey: KEY, markup: MARKUP });
    const entry = entryMap(doc, KEY)!;
    expect(entry.get('href')).toBe('/pricing');
    expect(entry.get(LINK_MARKUP_FIELD)).toBe(MARKUP);
  });

  it('unsetting the last real attribute keeps the entry while markup remains', () => {
    const doc = new Y.Doc();
    applyCommand(doc, {
      type: 'UPDATE_LINK_ATTRIBUTE', elementId: KEY, attribute: 'href', value: '/pricing',
    });
    applyCommand(doc, { type: 'UPDATE_SOURCE_MARKUP', sourceKey: KEY, markup: MARKUP });
    applyCommand(doc, {
      type: 'UPDATE_LINK_ATTRIBUTE', elementId: KEY, attribute: 'href', value: '',
    });
    expect(entryMap(doc, KEY)?.get(LINK_MARKUP_FIELD)).toBe(MARKUP);
  });
});

describe('UPDATE_SOURCE_TEXT × markup overlay interplay', () => {
  it('keeps the markup when the new text matches the markup flat text (wrap-then-exit flow)', () => {
    // handleWrapSelectionInLink sends MARKUP_CHANGED first, then
    // EDIT_MODE_EXITED with the SAME text — the text dispatch must not
    // destroy the markup that carries the link.
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'UPDATE_SOURCE_MARKUP', sourceKey: KEY, markup: MARKUP });
    applyCommand(doc, {
      type: 'UPDATE_SOURCE_TEXT', sourceKey: KEY, textContent: 'Visit our team today',
    });
    expect(entryMap(doc, KEY)?.get(LINK_MARKUP_FIELD)).toBe(MARKUP);
  });

  it('drops a stale markup when a later plain-text edit changes the text', () => {
    // Typing AFTER wrapping makes the text the newer truth — a reload must
    // not resurrect the old text via the markup override.
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'UPDATE_SOURCE_MARKUP', sourceKey: KEY, markup: MARKUP });
    applyCommand(doc, {
      type: 'UPDATE_SOURCE_TEXT', sourceKey: KEY, textContent: 'Completely new copy',
    });
    expect(entryMap(doc, KEY)).toBeUndefined(); // field dropped, empty entry pruned
  });

  it('keeps real link attributes when only the stale markup is dropped', () => {
    const doc = new Y.Doc();
    applyCommand(doc, {
      type: 'UPDATE_LINK_ATTRIBUTE', elementId: KEY, attribute: 'href', value: '/pricing',
    });
    applyCommand(doc, { type: 'UPDATE_SOURCE_MARKUP', sourceKey: KEY, markup: MARKUP });
    applyCommand(doc, {
      type: 'UPDATE_SOURCE_TEXT', sourceKey: KEY, textContent: 'Completely new copy',
    });
    const entry = entryMap(doc, KEY)!;
    expect(entry.get('href')).toBe('/pricing');
    expect(entry.get(LINK_MARKUP_FIELD)).toBeUndefined();
  });
});

describe('linkMarkupFlatText', () => {
  it('strips tags and decodes innerHTML-serialization entities', () => {
    expect(linkMarkupFlatText('a <a href="/x">b &amp; c</a> &lt;d&gt;')).toBe('a b & c <d>');
  });
});

describe('forEachSourceLinkAttrsEntry', () => {
  it('separates real attributes from the markup bookkeeping field', () => {
    const doc = new Y.Doc();
    applyCommand(doc, {
      type: 'UPDATE_LINK_ATTRIBUTE', elementId: KEY, attribute: 'href', value: '/pricing',
    });
    applyCommand(doc, {
      type: 'UPDATE_LINK_ATTRIBUTE', elementId: KEY, attribute: 'ariaLabel', value: 'Pricing',
    });
    applyCommand(doc, { type: 'UPDATE_SOURCE_MARKUP', sourceKey: KEY, markup: MARKUP });

    const seen: Array<{ key: string; attributes: Record<string, string>; markup?: string }> = [];
    forEachSourceLinkAttrsEntry(doc, (e) => seen.push(e));
    expect(seen).toEqual([{
      key: KEY, file: 'src/components/Hero.astro', line: 5, col: 1,
      attributes: { href: '/pricing', ariaLabel: 'Pricing' },
      markup: MARKUP,
    }]);
  });

  it('skips instance-child keyed entries (doc names) and empty entries', () => {
    const doc = new Y.Doc();
    applyCommand(doc, {
      type: 'UPDATE_LINK_ATTRIBUTE', elementId: KEY, attribute: 'href', value: '/a',
    });
    // instance-child link overrides live on the element, not this map — but a
    // hypothetical non-source key in the map must still be ignored.
    const raw = doc.getMap('sourceLinkAttributes');
    const bogus = new Y.Map();
    bogus.set('href', '/b');
    raw.set('el-9:a-0', bogus);

    const keys: string[] = [];
    forEachSourceLinkAttrsEntry(doc, (e) => keys.push(e.key));
    expect(keys).toEqual([KEY]);
  });
});

