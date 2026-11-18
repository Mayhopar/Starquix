import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { createEditorDoc } from '../createEditorDoc';
import { pageLayoutElementId } from '../layoutElement';

const BODY = '<body class="shell"><header class="nav">NAV</header><slot /></body>';

function makePage(doc: Y.Doc, id = 'p1') {
  applyCommand(doc, { type: 'ADD_PAGE', page: { id, name: 'Home', rootElementIds: [], children: [] } });
  return doc.getMap('pages').get(id) as Y.Map<unknown>;
}
const layoutEl = (doc: Y.Doc, pageId = 'p1') =>
  doc.getMap('elements').get(pageLayoutElementId(pageId)) as Y.Map<unknown> | undefined;

describe('SET_PAGE_LAYOUT — derived layout element', () => {
  it('creates the layout-chrome element when body is supplied', () => {
    const doc = createEditorDoc();
    const page = makePage(doc);
    applyCommand(doc, { type: 'SET_PAGE_LAYOUT', pageId: 'p1', layoutName: 'Marketing', body: BODY });
    // page-level association unchanged (codegen source of truth)
    expect(page.get('layoutName')).toBe('Marketing');
    // derived element exists; masterVersion is deferred to the DesignBar source-init
    const el = layoutEl(doc)!;
    expect(el.get('componentType')).toBe('Marketing');
    expect(el.get('masterVersion')).toBeUndefined();
  });

  it('does NOT create the element when body is omitted (lazy-ensure path)', () => {
    const doc = createEditorDoc();
    makePage(doc);
    applyCommand(doc, { type: 'SET_PAGE_LAYOUT', pageId: 'p1', layoutName: 'Marketing' });
    expect(layoutEl(doc)).toBeUndefined();
    // page association still set — render/DesignBar will lazily ensure the element
    expect((doc.getMap('pages').get('p1') as Y.Map<unknown>).get('layoutName')).toBe('Marketing');
  });

  it('removes the element on detach (layoutName=null)', () => {
    const doc = createEditorDoc();
    makePage(doc);
    applyCommand(doc, { type: 'SET_PAGE_LAYOUT', pageId: 'p1', layoutName: 'Marketing', body: BODY });
    expect(layoutEl(doc)).toBeDefined();
    applyCommand(doc, { type: 'SET_PAGE_LAYOUT', pageId: 'p1', layoutName: null });
    expect(layoutEl(doc)).toBeUndefined();
  });

  it('replaces the element when switching to a different layout', () => {
    const doc = createEditorDoc();
    makePage(doc);
    applyCommand(doc, { type: 'SET_PAGE_LAYOUT', pageId: 'p1', layoutName: 'Marketing', body: BODY });
    const OTHER = '<body><footer>F</footer><slot /></body>';
    applyCommand(doc, { type: 'SET_PAGE_LAYOUT', pageId: 'p1', layoutName: 'Minimal', body: OTHER });
    expect(layoutEl(doc)!.get('componentType')).toBe('Minimal');
  });

  it('never adds the layout element to rootElementIds (codegen stays flat)', () => {
    const doc = createEditorDoc();
    const page = makePage(doc);
    applyCommand(doc, { type: 'SET_PAGE_LAYOUT', pageId: 'p1', layoutName: 'Marketing', body: BODY });
    expect((page.get('rootElementIds') as Y.Array<string>).toArray()).not.toContain(pageLayoutElementId('p1'));
  });
});

describe('ENSURE_LAYOUT_ELEMENT — lazy materialization', () => {
  it('creates the element for an already-applied layout (no body on apply)', () => {
    const doc = createEditorDoc();
    makePage(doc);
    applyCommand(doc, { type: 'SET_PAGE_LAYOUT', pageId: 'p1', layoutName: 'Marketing' });
    expect(layoutEl(doc)).toBeUndefined();
    applyCommand(doc, { type: 'ENSURE_LAYOUT_ELEMENT', pageId: 'p1', layoutName: 'Marketing', body: BODY });
    expect(layoutEl(doc)!.get('componentType')).toBe('Marketing');
  });

  it('is a no-op when the page no longer has that layout applied', () => {
    const doc = createEditorDoc();
    makePage(doc);
    const ok = applyCommand(doc, { type: 'ENSURE_LAYOUT_ELEMENT', pageId: 'p1', layoutName: 'Marketing', body: BODY });
    expect(ok).toBe(false);
    expect(layoutEl(doc)).toBeUndefined();
  });
});

describe('DELETE_PAGE_LAYOUT_WITH_CONTENT — derived layout element', () => {
  it('removes the layout element along with the content', () => {
    const doc = createEditorDoc();
    makePage(doc);
    applyCommand(doc, { type: 'SET_PAGE_LAYOUT', pageId: 'p1', layoutName: 'Marketing', body: BODY });
    applyCommand(doc, { type: 'DELETE_PAGE_LAYOUT_WITH_CONTENT', pageId: 'p1' });
    expect(layoutEl(doc)).toBeUndefined();
    expect((doc.getMap('pages').get('p1') as Y.Map<unknown>).get('layoutName') ?? null).toBeNull();
  });
});
