// Self-heal for pages the pre-fix AI add_page tool created without a
// rootPages entry (existed in Yjs, invisible in the Pages tree).
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { createEditorDoc } from '../../createEditorDoc';
import { adoptOrphanPages } from '../adoptOrphanPages';
import { COMPONENT_EDITOR_PAGE_ID } from '../../constants';

function rawPage(doc: Y.Doc, id: string, name: string, children: string[] = []) {
  const yPage = new Y.Map();
  yPage.set('id', id);
  yPage.set('name', name);
  yPage.set('rootElementIds', new Y.Array());
  yPage.set('children', Y.Array.from(children));
  doc.getMap('pages').set(id, yPage);
}

const roots = (doc: Y.Doc) => doc.getArray('rootPages').toArray() as string[];

describe('adoptOrphanPages', () => {
  it('appends orphan pages to rootPages', () => {
    const doc = createEditorDoc();
    rawPage(doc, 'p1', 'Home');
    doc.getArray('rootPages').push(['p1']);
    rawPage(doc, 'orphan', 'AI page'); // pre-fix add_page shape
    adoptOrphanPages(doc);
    expect(roots(doc)).toEqual(['p1', 'orphan']);
  });

  it('leaves child pages and the component-editor page alone; idempotent', () => {
    const doc = createEditorDoc();
    rawPage(doc, 'p1', 'Home', ['child']);
    rawPage(doc, 'child', 'Nested');
    rawPage(doc, COMPONENT_EDITOR_PAGE_ID, 'scratch');
    doc.getArray('rootPages').push(['p1']);
    adoptOrphanPages(doc);
    adoptOrphanPages(doc);
    expect(roots(doc)).toEqual(['p1']);
  });
});
