import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { observeEditorPageStructure } from '../observeEditorPageStructure';
import { applyCommand } from '@/store/commands';
import { emptyClassData } from '@/store/types';

const EDITOR_PAGE = '__component-editor';
const OTHER_PAGE = 'page-other';

function seedDocWithEditor(doc: Y.Doc, editorId: string) {
  applyCommand(doc, { type: 'ADD_PAGE', page: {
    id: EDITOR_PAGE, name: 'Editor', rootElementIds: [], children: [],
  }});
  applyCommand(doc, { type: 'ADD_PAGE', page: {
    id: OTHER_PAGE, name: 'Other', rootElementIds: [], children: [],
  }});
  applyCommand(doc, { type: 'ADD_ELEMENT', element: {
    id: editorId,
    pageId: EDITOR_PAGE,
    parentId: null,
    index: 0,
    type: 'component',
    astroSource: 'library/BlogPost.astro',
    staticMarkup: '<div data-key="ed:div-0"></div>',
    classes: emptyClassData(),
  }});
}

describe('observeEditorPageStructure — schedules auto-flush for editor-page sibling edits', () => {
  it('fires when a drawn element is added on the editor page', () => {
    // Regression: drawing a slot inside the BlogPost editor produced no
    // auto-flush trigger, so user-built layouts (drawn slot + Header +
    // Footer) silently failed to reach BlogPost.astro source.
    const doc = new Y.Doc();
    seedDocWithEditor(doc, 'ed');
    const onChange = vi.fn();
    const unsub = observeEditorPageStructure(doc, EDITOR_PAGE, 'ed', onChange);

    applyCommand(doc, { type: 'ADD_DRAWN_ELEMENT', element: {
      key: 'drawn-slot-1', tag: 'slot', classes: '', textContent: '',
      parentKey: null, insertIndex: 0, pageId: EDITOR_PAGE, slotType: 'slot',
    }});

    expect(onChange).toHaveBeenCalled();
    unsub();
  });

  it('fires when an override is mutated on an editor-page sibling (e.g. slot-fill class edit)', () => {
    const doc = new Y.Doc();
    seedDocWithEditor(doc, 'ed');
    applyCommand(doc, { type: 'ADD_DRAWN_ELEMENT', element: {
      key: 'drawn-slot-1', tag: 'slot', classes: '', textContent: '',
      parentKey: null, insertIndex: 0, pageId: EDITOR_PAGE, slotType: 'slot',
    }});
    const onChange = vi.fn();
    const unsub = observeEditorPageStructure(doc, EDITOR_PAGE, 'ed', onChange);

    applyCommand(doc, {
      type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE',
      instanceId: 'drawn-slot-1',
      selector: 'h2-0',
      breakpoint: 'base',
      classes: ['text-red-500'],
    });

    expect(onChange).toHaveBeenCalled();
    unsub();
  });

  it('does NOT fire for changes to the editor element itself (covered by other observers)', () => {
    const doc = new Y.Doc();
    seedDocWithEditor(doc, 'ed');
    const onChange = vi.fn();
    const unsub = observeEditorPageStructure(doc, EDITOR_PAGE, 'ed', onChange);

    applyCommand(doc, {
      type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE',
      instanceId: 'ed',
      selector: 'div-0',
      breakpoint: 'base',
      classes: ['bg-blue-500'],
    });

    expect(onChange).not.toHaveBeenCalled();
    unsub();
  });

  it('does NOT fire for adds/changes on OTHER pages', () => {
    const doc = new Y.Doc();
    seedDocWithEditor(doc, 'ed');
    const onChange = vi.fn();
    const unsub = observeEditorPageStructure(doc, EDITOR_PAGE, 'ed', onChange);

    applyCommand(doc, { type: 'ADD_DRAWN_ELEMENT', element: {
      key: 'drawn-other-1', tag: 'div', classes: '', textContent: '',
      parentKey: null, insertIndex: 0, pageId: OTHER_PAGE,
    }});

    expect(onChange).not.toHaveBeenCalled();
    unsub();
  });

  it('unsubscribe stops further fires', () => {
    const doc = new Y.Doc();
    seedDocWithEditor(doc, 'ed');
    const onChange = vi.fn();
    const unsub = observeEditorPageStructure(doc, EDITOR_PAGE, 'ed', onChange);
    unsub();

    applyCommand(doc, { type: 'ADD_DRAWN_ELEMENT', element: {
      key: 'drawn-slot-2', tag: 'slot', classes: '', textContent: '',
      parentKey: null, insertIndex: 0, pageId: EDITOR_PAGE, slotType: 'slot',
    }});

    expect(onChange).not.toHaveBeenCalled();
  });
});
