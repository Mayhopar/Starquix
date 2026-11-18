import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { createEditorDoc } from '../createEditorDoc';
import { selectPageComponents } from '../selectors';
import { pageLayoutElementId } from '../layoutElement';
import { emptyClassData, parseKey } from '../types';

const BODY = '<body class="shell"><header class="nav">NAV</header><slot /></body>';

function setupWithLayout() {
  const doc = createEditorDoc();
  applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'p1', name: 'Home', rootElementIds: [], children: [] } });
  applyCommand(doc, { type: 'ADD_ELEMENT', element: { id: 'el-a', pageId: 'p1', parentId: null, index: 0, type: 'instance', classes: emptyClassData(), staticMarkup: '<section data-astro-source-file="X">A</section>' } as never });
  applyCommand(doc, { type: 'SET_PAGE_LAYOUT', pageId: 'p1', layoutName: 'L', body: BODY });
  return doc;
}

describe('selectPageComponents — render chrome from the derived layout element', () => {
  it('wraps content into the element chrome (no discovered body needed)', () => {
    const doc = setupWithLayout();
    // Pass an EMPTY layoutBodies map — the chrome must come from the element.
    const out = selectPageComponents(doc, 'p1', new Map());
    expect(out).toHaveLength(1);
    const m = out[0].staticMarkup;
    expect(m).toContain('NAV');                               // chrome visible
    expect(m).toContain('>A<');                               // content spliced in
    expect(m).toContain('data-astro-source-file="X"');        // source tracking kept
    expect(m).not.toMatch(/<slot\b/i);                        // slot replaced
    expect(m).not.toMatch(/<!doctype|<html\b|class="shell"/i); // boilerplate stripped
  });

  it('keeps the chrome data-keyed to the layout element so it is selectable/editable', () => {
    const doc = setupWithLayout();
    const out = selectPageComponents(doc, 'p1', new Map());
    // The chrome carries data-key="<layoutElementId>:<selector>" — clicking it in
    // the canvas resolves (parseKey) to an instance-child of the layout element.
    expect(out[0].staticMarkup).toMatch(/data-key="layoutchrome-p1:[a-z]+-\d+"/i);
  });

  it('a chrome data-key parses to an instance-child of the layout element (selection routing)', () => {
    const doc = setupWithLayout();
    const m = selectPageComponents(doc, 'p1', new Map())[0].staticMarkup;
    const chromeKey = m.match(/data-key="(layoutchrome-p1:[a-z]+-\d+)"/i)?.[1];
    expect(chromeKey).toBeTruthy();
    const parsed = parseKey(chromeKey!);
    expect(parsed).toEqual({ type: 'instance-child', instanceId: pageLayoutElementId('p1'), selector: expect.any(String) });
  });

  it('applies the element overrides to the chrome (markupOverride replaces inner content)', () => {
    const doc = setupWithLayout();
    const layoutEl = doc.getMap('elements').get(pageLayoutElementId('p1')) as Y.Map<unknown>;

    // The stored chrome is data-keyed as `layoutchrome-p1:<selector>`. Grab the
    // real header selector so the test doesn't hardcode the keying scheme.
    const stored = layoutEl.get('staticMarkup') as string;
    const sel = stored.match(/data-key="layoutchrome-p1:([^"]+)"/)?.[1];
    expect(sel).toBeTruthy();

    const markupOverrides = new Y.Map<string>();
    markupOverrides.set(sel!, 'OVERRIDDEN');
    doc.transact(() => layoutEl.set('markupOverrides', markupOverrides));

    const out = selectPageComponents(doc, 'p1', new Map());
    expect(out[0].staticMarkup).toContain('OVERRIDDEN');
  });

  it('falls back to the discovered body when no element exists yet (lazy path)', () => {
    const doc = createEditorDoc();
    applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'p2', name: 'Home', rootElementIds: [], children: [] } });
    applyCommand(doc, { type: 'ADD_ELEMENT', element: { id: 'el-b', pageId: 'p2', parentId: null, index: 0, type: 'instance', classes: emptyClassData(), staticMarkup: '<section>B</section>' } as never });
    // No body in the command → no element created.
    applyCommand(doc, { type: 'SET_PAGE_LAYOUT', pageId: 'p2', layoutName: 'L' });
    const out = selectPageComponents(doc, 'p2', new Map([['L', BODY]]));
    expect(out).toHaveLength(1);
    expect(out[0].staticMarkup).toContain('<header class="nav">NAV</header>');
    expect(out[0].staticMarkup).toContain('>B<');
  });

  it('returns flat roots unchanged when there is no layout', () => {
    const doc = createEditorDoc();
    applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'p3', name: 'Home', rootElementIds: [], children: [] } });
    applyCommand(doc, { type: 'ADD_ELEMENT', element: { id: 'el-c', pageId: 'p3', parentId: null, index: 0, type: 'instance', classes: emptyClassData(), staticMarkup: '<section>C</section>' } as never });
    const out = selectPageComponents(doc, 'p3', new Map());
    expect(out.map((c) => c.id)).toEqual(['el-c']);
  });
});
