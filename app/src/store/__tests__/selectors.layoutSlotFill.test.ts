import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { createEditorDoc } from '../createEditorDoc';
import { selectPageComponents } from '../selectors';
import { pageLayoutElementId } from '../layoutElement';
import { emptyClassData } from '../types';

function makePage(doc: Y.Doc, id: string) {
  applyCommand(doc, { type: 'ADD_PAGE', page: { id, name: 'Home', rootElementIds: [], children: [] } });
}

describe('page-level layout slot fill', () => {
  it('a root element with slotName composes into the matching <slot name>', () => {
    const doc = createEditorDoc();
    makePage(doc, 'p1');
    applyCommand(doc, { type: 'ADD_ELEMENT', element: { id: 'el-side', pageId: 'p1', parentId: null, index: 0, type: 'instance', slotName: 'sidebar', classes: emptyClassData(), staticMarkup: '<aside>SIDE</aside>' } as never });
    applyCommand(doc, { type: 'SET_PAGE_LAYOUT', pageId: 'p1', layoutName: 'Marketing' });
    const layoutBodies = new Map<string, string>([['Marketing', '<div><slot name="sidebar"></slot><slot></slot></div>']]);
    const [wrapped] = selectPageComponents(doc, 'p1', layoutBodies);
    expect(wrapped.staticMarkup).toContain('SIDE');
    // SIDE must sit inside the named slot region, before the default slot
    expect(wrapped.staticMarkup.indexOf('SIDE')).toBeLessThan(wrapped.staticMarkup.indexOf('<slot></slot>'));
  });

  it('a FILLED slot becomes a persistent <div> container — slot class + key kept, content INSIDE', () => {
    const doc = createEditorDoc();
    makePage(doc, 'p2');
    applyCommand(doc, { type: 'ADD_ELEMENT', element: { id: 'el-c', pageId: 'p2', parentId: null, index: 0, type: 'instance', classes: emptyClassData(), staticMarkup: '<section>HELLO</section>' } as never });
    applyCommand(doc, { type: 'SET_PAGE_LAYOUT', pageId: 'p2', layoutName: 'L' });
    const bodies = new Map([['L', '<slot data-key="layoutchrome-p2:slot-0" class="bg-white"></slot>']]);
    const [wrapped] = selectPageComponents(doc, 'p2', bodies);
    const m = wrapped.staticMarkup;
    // <slot> → <div> container carrying the slot's class + key, content nested INSIDE it
    expect(m).toMatch(/<div[^>]*data-key="layoutchrome-p2:slot-0"[^>]*data-sq-slot[^>]*>/);
    expect(m).toContain('bg-white');
    expect(m).toContain('HELLO');
    expect(m).not.toMatch(/<slot\b/i); // the filled slot is no longer a literal <slot>
  });

  it('renders the layout component under the layout-element id (not __layout__) so chrome keys land in the layoutchrome-<pageId> namespace', () => {
    // Real fallback path: no layout-chrome element yet + an UNKEYED discovered body.
    // The bridge keys unkeyed chrome under the returned component id, so that id
    // MUST be the layout-element id — else the slot is keyed __layout__:slot-0 and
    // every layoutchrome-<pageId>: consumer (layers node, canvas drill, DesignBar) misses it.
    const doc = createEditorDoc();
    makePage(doc, 'p9');
    applyCommand(doc, { type: 'ADD_ELEMENT', element: { id: 'el-c', pageId: 'p9', parentId: null, index: 0, type: 'instance', classes: emptyClassData(), staticMarkup: '<section>HI</section>' } as never });
    applyCommand(doc, { type: 'SET_PAGE_LAYOUT', pageId: 'p9', layoutName: 'Marketing' });
    const bodies = new Map<string, string>([['Marketing', '<header>NAV</header><slot></slot>']]); // UNKEYED
    const [comp] = selectPageComponents(doc, 'p9', bodies);
    expect(comp.id).toBe(pageLayoutElementId('p9')); // 'layoutchrome-p9', NOT '__layout__'
  });

  it('marks chrome tags with data-sq-chrome but leaves content roots unmarked', () => {
    const doc = createEditorDoc();
    makePage(doc, 'p1');
    applyCommand(doc, { type: 'ADD_ELEMENT', element: { id: 'el-c', pageId: 'p1', parentId: null, index: 0, type: 'instance', classes: emptyClassData(), staticMarkup: '<section>HELLO</section>' } as never });
    applyCommand(doc, { type: 'SET_PAGE_LAYOUT', pageId: 'p1', layoutName: 'Marketing' });
    // Chrome body pre-keyed in the layout-element namespace (layoutchrome-p1:…).
    const layoutBodies = new Map<string, string>([
      ['Marketing', '<header data-key="layoutchrome-p1:header-0" class="hd">H</header><main data-key="layoutchrome-p1:main-0"><slot data-key="layoutchrome-p1:slot-0" class="bg-white"></slot></main>'],
    ]);
    const result = selectPageComponents(doc, 'p1', layoutBodies);
    const html = result[0].staticMarkup;

    // The slot wrapper div is chrome (carries both data-sq-slot and data-sq-chrome):
    expect(html).toMatch(/<div[^>]*data-sq-slot[^>]*data-sq-chrome|<div[^>]*data-sq-chrome[^>]*data-sq-slot/);
    // Every chrome-namespace data-key tag carries the marker:
    const chromePrefix = `${pageLayoutElementId('p1')}:`;
    const chromeKeyTags = [...html.matchAll(/<([a-z0-9]+)\b[^>]*data-key="([^"]+)"[^>]*>/gi)]
      .filter((mt) => mt[2].startsWith(chromePrefix));
    expect(chromeKeyTags.length).toBeGreaterThan(0);
    for (const mt of chromeKeyTags) {
      expect(mt[0]).toContain('data-sq-chrome');
    }
    // Content root (its own source key, not chrome-namespace) is NOT marked:
    const contentTag = html.match(/<section\b[^>]*>/i)?.[0] ?? '';
    expect(contentTag).not.toContain('data-sq-chrome');
  });
});
