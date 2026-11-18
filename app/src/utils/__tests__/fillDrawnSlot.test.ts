import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { fillDrawnSlot } from '../fillDrawnSlot';
import { applyCommand } from '@/store/commands';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';

function seedDrawnSlot(doc: Y.Doc, slotKey: string, pageId: string) {
  applyCommand(doc, { type: 'ADD_PAGE', page: {
    id: pageId, name: 'P', rootElementIds: [], children: [],
  }});
  applyCommand(doc, { type: 'ADD_DRAWN_ELEMENT', element: {
    key: slotKey,
    tag: 'slot',
    classes: '',
    textContent: '',
    parentKey: null,
    insertIndex: 0,
    pageId,
    slotType: 'slot',
  }});
}

describe('fillDrawnSlot — stamps data-keys + records astroSource on the slot', () => {
  it('stamps every tag in the filler markup with a key in the slot id namespace', async () => {
    // Regression for: clicking an h2 inside a slot-fill produced a
    // bridge-generated `dynamic:h2:0@hash` fallback key because the stored
    // slotComponentMarkup was raw component.html with no data-key attributes.
    // Stamping at fill time makes clicks surface `slotKey:h2-0` instead,
    // routing through the instance-child override path.
    const doc = new Y.Doc();
  doc.getMap('meta').set('projectId', crypto.randomUUID());
    const slotKey = 'drawn-slot-1';
    seedDrawnSlot(doc, slotKey, 'page-1');

    const component: ScannedComponent = {
      name: 'Header',
      path: 'library/Header.astro',
      source: 'built-in',
      html: '<header class="x"><h2 class="text-2xl">Brand</h2><a>About</a></header>',
      category: '', props: [], slots: [], dependencies: [],
    };

    await fillDrawnSlot(doc, slotKey, 'child-1', component);

    const ySlot = doc.getMap('elements').get(slotKey) as Y.Map<unknown>;
    const stamped = ySlot.get('slotComponentMarkup') as string;
    expect(stamped).toMatch(/<header[^>]*data-key="drawn-slot-1:header-0"/);
    expect(stamped).toMatch(/<h2[^>]*data-key="drawn-slot-1:h2-0"/);
    expect(stamped).toMatch(/<a[^>]*data-key="drawn-slot-1:a-0"/);
  });

  it('sets astroSource on the slot to the filler component path', async () => {
    // Routes future pushOverridesToSource calls to the filler's source file
    // rather than no-op-ing on a slot with no astroSource. resolveOverrideSource
    // uses this as the fallback when a selector has no sub-component marker.
    const doc = new Y.Doc();
  doc.getMap('meta').set('projectId', crypto.randomUUID());
    const slotKey = 'drawn-slot-2';
    seedDrawnSlot(doc, slotKey, 'page-1');

    const component: ScannedComponent = {
      name: 'Header', path: 'library/Header.astro', source: 'built-in',
      html: '<header><h2>X</h2></header>',
      category: '', props: [], slots: [], dependencies: [],
    };

    await fillDrawnSlot(doc, slotKey, 'child-1', component);

    const ySlot = doc.getMap('elements').get(slotKey) as Y.Map<unknown>;
    expect(ySlot.get('astroSource')).toBe('library/Header.astro');
    expect(ySlot.get('slotComponentPath')).toBe('library/Header.astro');
  });

  it('preserves sub-component source markers from picker HTML through stamping', async () => {
    // When the picker scans a component that itself imports sub-components,
    // resolveCanvasHtml emits `data-sq-component-src` markers on the inlined
    // bodies. Stamping must not strip them — resolveOverrideSource walks
    // those markers to route per-source write-backs.
    const doc = new Y.Doc();
  doc.getMap('meta').set('projectId', crypto.randomUUID());
    const slotKey = 'drawn-slot-3';
    seedDrawnSlot(doc, slotKey, 'page-1');

    const component: ScannedComponent = {
      name: 'BlogPost', path: 'library/BlogPost.astro', source: 'built-in',
      html: '<div><header data-sq-component-src="library/Header.astro"><h2>X</h2></header></div>',
      category: '', props: [], slots: [], dependencies: [],
    };

    await fillDrawnSlot(doc, slotKey, 'child-1', component);

    const stamped = (doc.getMap('elements').get(slotKey) as Y.Map<unknown>).get('slotComponentMarkup') as string;
    expect(stamped).toMatch(/data-sq-component-src="library\/Header\.astro"/);
    expect(stamped).toMatch(/<h2[^>]*data-key="drawn-slot-3:h2-0"/);
  });
});
