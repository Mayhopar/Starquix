import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { createEditorDoc } from '../createEditorDoc';
import { applyCommand } from '../commands';
import { migrateLayoutPropsToSeo } from '../migrations/migrateLayoutPropsToSeo';

function seoOf(doc: Y.Doc, id: string) {
  const seo = (doc.getMap('pages').get(id) as Y.Map<unknown>).get('seo') as Y.Map<unknown> | undefined;
  return seo ? seo.toJSON() : {};
}
function layoutPropsOf(doc: Y.Doc, id: string) {
  return (doc.getMap('pages').get(id) as Y.Map<unknown>).get('layoutProps') as Record<string, string> | undefined;
}

describe('migrateLayoutPropsToSeo', () => {
  it('moves layoutProps.title into seo.title and strips it from layoutProps', () => {
    const doc = createEditorDoc();
    applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'p1', name: 'Home', rootElementIds: [], children: [] } });
    applyCommand(doc, { type: 'SET_PAGE_LAYOUT', pageId: 'p1', layoutName: 'Marketing', layoutProps: { title: 'Hand Typed', variant: 'wide' } });

    migrateLayoutPropsToSeo(doc);

    expect(seoOf(doc, 'p1')).toMatchObject({ title: 'Hand Typed' });
    expect(layoutPropsOf(doc, 'p1')).toEqual({ variant: 'wide' });
  });

  it('does not clobber an existing seo.title', () => {
    const doc = createEditorDoc();
    applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'p1', name: 'Home', rootElementIds: [], children: [] } });
    applyCommand(doc, { type: 'UPDATE_PAGE_SEO', pageId: 'p1', field: 'title', value: 'Canonical' });
    applyCommand(doc, { type: 'SET_PAGE_LAYOUT', pageId: 'p1', layoutName: 'Marketing', layoutProps: { title: 'Hand Typed' } });

    migrateLayoutPropsToSeo(doc);

    expect(seoOf(doc, 'p1')).toMatchObject({ title: 'Canonical' });
    expect(layoutPropsOf(doc, 'p1') ?? {}).not.toHaveProperty('title');
  });

  it('is idempotent (second run is a no-op)', () => {
    const doc = createEditorDoc();
    applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'p1', name: 'Home', rootElementIds: [], children: [] } });
    applyCommand(doc, { type: 'SET_PAGE_LAYOUT', pageId: 'p1', layoutName: 'Marketing', layoutProps: { title: 'Hand Typed' } });
    migrateLayoutPropsToSeo(doc);
    migrateLayoutPropsToSeo(doc);
    expect(seoOf(doc, 'p1')).toMatchObject({ title: 'Hand Typed' });
  });
});
