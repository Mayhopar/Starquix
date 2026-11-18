import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { createEditorDoc } from '../createEditorDoc';
import {
  pageLayoutElementId,
  ensureLayoutElement,
  removeLayoutElement,
  layoutChromeMarkup,
  resolvedLayoutChrome,
} from '../layoutElement';
import type { ScannedComponent } from '../../hooks/useComponentLibrary';

const FULL_DOC_BODY = [
  '<!doctype html>',
  '<html lang="en"><head><title>x</title></head>',
  '<body class="shell"><header class="nav">NAV</header><slot /></body></html>',
].join('');

function setup() {
  const doc = createEditorDoc();
  applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'p1', name: 'Home', rootElementIds: [], children: [] } });
  return doc;
}
const elOf = (doc: Y.Doc, pageId: string) =>
  doc.getMap('elements').get(pageLayoutElementId(pageId)) as Y.Map<unknown> | undefined;

describe('ensureLayoutElement', () => {
  it('creates a layout-chrome element with the expected instance fields', () => {
    const doc = setup();
    ensureLayoutElement(doc, 'p1', 'Marketing', FULL_DOC_BODY);
    const el = elOf(doc, 'p1')!;
    expect(el).toBeDefined();
    expect(el.get('id')).toBe('layoutchrome-p1');
    expect(el.get('pageId')).toBe('p1');
    expect(el.get('parentId') ?? null).toBeNull();
    expect(el.get('type')).toBe('instance');
    expect(el.get('componentType')).toBe('Marketing');
    expect(el.get('astroSource')).toBe('layouts/Marketing.astro');
    expect(el.get('bindingType')).toBe('layout-chrome');
    expect(el.get('classOverrides')).toBeInstanceOf(Y.Map);
  });

  it('does NOT stamp masterVersion (the concept is retired — masters overlay is live) and keys the stored chrome', () => {
    const doc = setup();
    ensureLayoutElement(doc, 'p1', 'Marketing', FULL_DOC_BODY);
    const el = elOf(doc, 'p1')!;
    expect(el.get('masterVersion')).toBeUndefined();
    const markup = el.get('staticMarkup') as string;
    // Boilerplate stripped (injected into existing preview doc, not a page).
    expect(markup).not.toMatch(/<!doctype/i);
    expect(markup).not.toMatch(/<html\b/i);
    expect(markup).toContain('NAV');
    // Keyed to the element so it is selectable like an instance.
    expect(markup).toContain('layoutchrome-p1:');
  });

  it('never inserts the element into rootElementIds', () => {
    const doc = setup();
    ensureLayoutElement(doc, 'p1', 'Marketing', FULL_DOC_BODY);
    const roots = (doc.getMap('pages').get('p1') as Y.Map<unknown>).get('rootElementIds') as Y.Array<string>;
    expect(roots.toArray()).not.toContain('layoutchrome-p1');
  });

  it('is idempotent for the same layout and PRESERVES user overrides (no silent re-snapshot)', () => {
    const doc = setup();
    ensureLayoutElement(doc, 'p1', 'Marketing', FULL_DOC_BODY);
    const el = elOf(doc, 'p1')!;
    const markup1 = el.get('staticMarkup');

    // Simulate a user override on the chrome.
    (el.get('classOverrides') as Y.Map<unknown>).set('header-0', new Y.Map());

    // Re-ensure with a CHANGED body for the SAME layout → must not touch the element.
    const NEW_BODY = FULL_DOC_BODY.replace('NAV', 'NAV v2');
    ensureLayoutElement(doc, 'p1', 'Marketing', NEW_BODY);
    const el2 = elOf(doc, 'p1')!;
    expect(el2.get('staticMarkup')).toBe(markup1); // snapshot preserved (no silent re-snapshot)
    expect((el2.get('classOverrides') as Y.Map<unknown>).has('header-0')).toBe(true);
  });

  it('replaces the element (fresh chrome, dropped overrides) when the layout name changes', () => {
    const doc = setup();
    ensureLayoutElement(doc, 'p1', 'Marketing', FULL_DOC_BODY);
    (elOf(doc, 'p1')!.get('classOverrides') as Y.Map<unknown>).set('header-0', new Y.Map());

    const OTHER_BODY = '<body><footer>F</footer><slot /></body>';
    ensureLayoutElement(doc, 'p1', 'Minimal', OTHER_BODY);
    const el = elOf(doc, 'p1')!;
    expect(el.get('componentType')).toBe('Minimal');
    expect(el.get('astroSource')).toBe('layouts/Minimal.astro');
    expect(el.get('staticMarkup')).toContain('F'); // fresh chrome from the new layout
    expect((el.get('classOverrides') as Y.Map<unknown>).has('header-0')).toBe(false);
  });

  it('removeLayoutElement deletes it', () => {
    const doc = setup();
    ensureLayoutElement(doc, 'p1', 'Marketing', FULL_DOC_BODY);
    removeLayoutElement(doc, 'p1');
    expect(elOf(doc, 'p1')).toBeUndefined();
  });
});

describe('layoutChromeMarkup', () => {
  it('ignores document boilerplate (full-doc body and its stripped form match)', () => {
    const stripped = '<header class="nav">NAV</header><slot />';
    const full = `<!doctype html><html><body>${stripped}</body></html>`;
    // stripDocumentBoilerplate reduces both to the same inner chrome.
    expect(layoutChromeMarkup(full)).toBe(layoutChromeMarkup(`<body>${stripped}</body>`));
  });
});

describe('resolvedLayoutChrome', () => {
  const lib = [
    { name: 'Header', path: 'library/Header.astro', source: 'built-in', html: '<header>NAV</header>', category: 'Header', props: [], slots: [], dependencies: [] },
  ] as unknown as ScannedComponent[];

  it('EXPANDS composed components so the layout renders complete (no literal <Header/>)', () => {
    const out = resolvedLayoutChrome('<body><slot /><Header /></body>', lib);
    expect(out).toContain('NAV');
    expect(out).toMatch(/<header\b/);          // expanded to real HTML
    expect(out).not.toMatch(/<Header\b/);      // no unrendered PascalCase tag
    expect(out).toMatch(/<slot\b/);            // the slot is preserved
  });

  it('strips document boilerplate', () => {
    const out = resolvedLayoutChrome('<!doctype html><html><body><slot /></body></html>', []);
    expect(out).not.toMatch(/<!doctype|<html\b/i);
    expect(out).toMatch(/<slot\b/);
  });
});
