import { describe, it, expect } from 'vitest';
import { applyCommand } from '../commands';
import { createEditorDoc } from '../createEditorDoc';
import { selectPageComponents } from '../selectors';
import { emptyClassData } from '../types';

// A realistic Astro layout: a FULL document (doctype/html/head/body) — the
// convention for Astro layouts — with visible chrome (<header>), a <slot/>, and
// the bridge <script> the snapshot template injects.
const BODY = [
  '<!doctype html>',
  '<html lang="en"><head><meta charset="UTF-8" /><title>eded</title></head>',
  '<body class="shell">',
  '<header class="nav">NAV</header>',
  '<slot />',
  '<script is:inline src="/scripts/bridge.js"></script>',
  '</body></html>',
].join('');

describe('selectPageComponents — page-level layout wrap', () => {
  it('splices content into the layout body slot, stripping document boilerplate (no doc-in-doc, no runtime <slot>)', () => {
    const doc = createEditorDoc();
    applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'p1', name: 'Home', rootElementIds: [], children: [] } });
    applyCommand(doc, { type: 'ADD_ELEMENT', element: { id: 'el-a', pageId: 'p1', parentId: null, index: 0, type: 'instance', classes: emptyClassData(), staticMarkup: '<section data-astro-source-file="X">A</section>' } as never });
    applyCommand(doc, { type: 'SET_PAGE_LAYOUT', pageId: 'p1', layoutName: 'L' });

    const bodies = new Map([['L', BODY]]);
    const out = selectPageComponents(doc, 'p1', bodies);
    const markup = out[0].staticMarkup;

    expect(out).toHaveLength(1);
    // Visible chrome survives, content is spliced into the slot, source attrs kept.
    expect(markup).toContain('<header class="nav">NAV</header>');
    expect(markup).toContain('>A<');
    expect(markup).toContain('data-astro-source-file="X"'); // source-tracking preserved → layers
    expect(markup).not.toMatch(/<slot\b/i);                 // slot replaced, not kept
    // Document boilerplate MUST be stripped — this blob is injected into the
    // existing preview document (#sq-components), not rendered as a page.
    expect(markup).not.toMatch(/<!doctype/i);
    expect(markup).not.toMatch(/<html\b/i);
    expect(markup).not.toMatch(/<head\b/i);
    expect(markup).not.toMatch(/<title\b/i);
    expect(markup).not.toMatch(/<script\b/i);               // re-injected bridge.js dropped
    expect(markup).not.toContain('class="shell"');          // <body> wrapper gone
  });

  it('returns flat roots unchanged when the page has no layoutName', () => {
    const doc = createEditorDoc();
    applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'p2', name: 'Home', rootElementIds: [], children: [] } });
    applyCommand(doc, { type: 'ADD_ELEMENT', element: { id: 'el-b', pageId: 'p2', parentId: null, index: 0, type: 'instance', classes: emptyClassData(), staticMarkup: '<section>B</section>' } as never });
    const out = selectPageComponents(doc, 'p2', new Map());
    expect(out.map((c) => c.id)).toEqual(['el-b']);
  });
});
