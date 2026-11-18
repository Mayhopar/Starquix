/**
 * Link-markup override × plain-text edit semantics (adversarial-review sweep):
 *
 * 1. PIN — linkMarkupFlatText decodes `&nbsp;` to U+00A0, the character
 *    Element.textContent yields. Two reviewers independently read the
 *    replacement literal as a plain U+0020 space (a raw U+00A0 renders
 *    identically to a space); this test makes the contract unmistakable so a
 *    regression to ' ' — which would delete a just-created link on the wrap
 *    flow's own EDIT_MODE_EXITED — can never land silently.
 *
 * 2. REGRESSION (wrap → edit-text → reload) — a plain-text edit AFTER a wrap
 *    used to unconditionally DROP the markup override whenever the flat text
 *    differed, silently unwrapping the link on the next reload while the live
 *    DOM kept showing it. Now the edit is spliced INTO the stored markup when
 *    it is unambiguous (contained in one text run), so the wrap persists
 *    around the edited text; only a tag-boundary-spanning edit still drops.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import {
  LINK_MARKUP_FIELD,
  linkMarkupFlatText,
  spliceLinkMarkupText,
} from '../sourceOverrideEntries';

const KEY = 'src/components/Hero.astro:5:1';
const MARKUP = 'Visit <a href="/about">our team</a> today';

function markupOf(doc: Y.Doc, key: string): unknown {
  const entry = doc.getMap('sourceLinkAttributes').get(key) as Y.Map<unknown> | undefined;
  return entry?.get(LINK_MARKUP_FIELD);
}

function docWithMarkup(markup: string): Y.Doc {
  const doc = new Y.Doc();
  applyCommand(doc, { type: 'UPDATE_SOURCE_MARKUP', sourceKey: KEY, markup });
  return doc;
}

describe('linkMarkupFlatText &nbsp; contract (U+00A0, never U+0020)', () => {
  it('decodes &nbsp; to the non-breaking space textContent yields', () => {
    const flat = linkMarkupFlatText('Visit&nbsp;<a href="/x">our team</a>');
    expect(flat).toBe('Visit\u00a0our team');
    expect(flat.charCodeAt(5)).toBe(0xa0); // NOT 0x20
  });

  it('wrap-then-exit with a contentEditable nbsp keeps the markup', () => {
    // contentEditable inserts U+00A0 for double/trailing spaces; innerHTML
    // serializes it as &nbsp; while EDIT_MODE_EXITED's textContent carries the
    // raw U+00A0 — the equality the wrap flow depends on must hold.
    const doc = docWithMarkup('Visit&nbsp;<a href="/about">our team</a>');
    applyCommand(doc, {
      type: 'UPDATE_SOURCE_TEXT', sourceKey: KEY, textContent: 'Visit\u00a0our team',
    });
    expect(markupOf(doc, KEY)).toBe('Visit&nbsp;<a href="/about">our team</a>');
  });
});

describe('spliceLinkMarkupText', () => {
  it('returns the markup unchanged when the flat text already matches', () => {
    expect(spliceLinkMarkupText(MARKUP, 'Visit our team today')).toBe(MARKUP);
  });

  it('splices an edit AFTER the link, keeping the wrap', () => {
    expect(spliceLinkMarkupText(MARKUP, 'Visit our team tomorrow'))
      .toBe('Visit <a href="/about">our team</a> tomorrow');
  });

  it('splices an edit BEFORE the link, keeping the wrap', () => {
    expect(spliceLinkMarkupText(MARKUP, 'Meet our team today'))
      .toBe('Meet <a href="/about">our team</a> today');
  });

  it('splices an edit INSIDE the link text', () => {
    expect(spliceLinkMarkupText(MARKUP, 'Visit our website today'))
      .toBe('Visit <a href="/about">our website</a> today');
  });

  it('re-encodes entities in the edited run (nbsp round-trips)', () => {
    expect(spliceLinkMarkupText(MARKUP, 'Visit our team\u00a0today'))
      .toBe('Visit <a href="/about">our team</a>&nbsp;today');
  });

  it('handles pre-existing entities in the untouched runs', () => {
    const markup = 'A &amp; B <a href="/x">link</a> end';
    expect(spliceLinkMarkupText(markup, 'A & B link finish'))
      .toBe('A &amp; B <a href="/x">link</a> finish');
  });

  it('returns null when the change spans a tag boundary (ambiguous)', () => {
    // Deletion covering the link edge and surrounding text cannot be located
    // in one run — the caller must fall back to dropping the markup.
    expect(spliceLinkMarkupText(MARKUP, 'Completely new copy')).toBeNull();
  });
});

describe('UPDATE_SOURCE_TEXT after a wrap (regression: silent unwrap on reload)', () => {
  it('keeps the wrap when the user edits text around the link', () => {
    const doc = docWithMarkup(MARKUP);
    applyCommand(doc, {
      type: 'UPDATE_SOURCE_TEXT', sourceKey: KEY, textContent: 'Visit our team tomorrow',
    });
    // Before the fix this was undefined (field dropped) — the reload then
    // repainted plain text and the link the user still SAW was gone.
    expect(markupOf(doc, KEY)).toBe('Visit <a href="/about">our team</a> tomorrow');
  });

  it('keeps the wrap when the user edits the link text itself', () => {
    const doc = docWithMarkup(MARKUP);
    applyCommand(doc, {
      type: 'UPDATE_SOURCE_TEXT', sourceKey: KEY, textContent: 'Visit our website today',
    });
    expect(markupOf(doc, KEY)).toBe('Visit <a href="/about">our website</a> today');
  });

  it('still drops the markup on a wholesale replacement (text is newer truth)', () => {
    const doc = docWithMarkup(MARKUP);
    applyCommand(doc, {
      type: 'UPDATE_SOURCE_TEXT', sourceKey: KEY, textContent: 'Completely new copy',
    });
    expect(markupOf(doc, KEY)).toBeUndefined();
  });
});
