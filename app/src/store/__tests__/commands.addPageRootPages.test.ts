// Regression: AI add_page dispatched ADD_PAGE directly and the page never
// appeared in the Pages panel — ADD_PAGE wrote the pages map but not
// rootPages, and the tree renders from rootPages. ADD_PAGE must register
// the page as a root itself (MOVE_PAGE re-homes it when nesting).
import { describe, it, expect } from 'vitest';
import { createEditorDoc } from '../createEditorDoc';
import { applyCommand } from '../commands';
import type { PageData } from '../types';

const page = (id: string, name: string, extra: Partial<PageData> = {}): PageData =>
  ({ id, name, rootElementIds: [], children: [], ...extra } as PageData);

const roots = (doc: ReturnType<typeof createEditorDoc>) =>
  doc.getArray('rootPages').toArray() as string[];

describe('ADD_PAGE registers the page in rootPages', () => {
  it('a bare ADD_PAGE makes the page visible as a root page', () => {
    const doc = createEditorDoc();
    applyCommand(doc, { type: 'ADD_PAGE', page: page('p1', 'Home') });
    expect(roots(doc)).toContain('p1');
  });

  it('does not duplicate an id already present in rootPages', () => {
    const doc = createEditorDoc();
    applyCommand(doc, { type: 'ADD_PAGE', page: page('p1', 'Home') });
    applyCommand(doc, { type: 'ADD_PAGE', page: page('p1', 'Home again') });
    expect(roots(doc).filter(id => id === 'p1')).toHaveLength(1);
  });

  it('ADD_PAGE followed by MOVE_PAGE into a parent leaves no rootPages entry', () => {
    const doc = createEditorDoc();
    applyCommand(doc, { type: 'ADD_PAGE', page: page('parent', 'Parent') });
    applyCommand(doc, { type: 'ADD_PAGE', page: page('child', 'Child') });
    applyCommand(doc, { type: 'MOVE_PAGE', pageId: 'child', newParentId: 'parent', index: 0 });
    expect(roots(doc)).toEqual(['parent']);
    const parent = doc.getMap('pages').get('parent') as { get(k: string): unknown };
    expect((parent.get('children') as { toArray(): string[] }).toArray()).toEqual(['child']);
  });
});
