// src/store/commands.test.ts
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { createEditorDoc } from './createEditorDoc';
import { applyCommand } from './commands';
import { emptyClassData } from './types';

describe('UPDATE_INSTANCE_OVERRIDE', () => {
  it('should store override for a template child', () => {
    const doc = createEditorDoc();
    const elements = doc.getMap('elements');

    // Create a page and an element with overrides map
    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: {
        id: 'page-home',
        name: 'Home',
        rootElementIds: [],
        children: []
      }
    });

    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'instance-001',
        pageId: 'page-home',
        parentId: null,
        index: 0,
        type: 'instance',
        instanceType: 'local',
        classes: emptyClassData(),
      }
    });

    // Then add an override
    applyCommand(doc, {
      type: 'UPDATE_INSTANCE_OVERRIDE',
      instanceId: 'instance-001',
      childId: 'hero-h1',
      updates: { text: 'Custom Title' }
    });

    const instance = elements.get('instance-001') as Y.Map<unknown>;
    const overrides = instance.get('overrides') as Y.Map<unknown>;
    const childOverride = overrides.get('hero-h1') as Y.Map<unknown>;
    expect(childOverride.get('text')).toBe('Custom Title');
  });
});

describe('DELETE_INSTANCE_CHILD', () => {
  it('should add selector to deletedSelectors array', () => {
    const doc = createEditorDoc();
    const elements = doc.getMap('elements');

    // Create a page and a theme instance
    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'page-1', name: 'Home', rootElementIds: [], children: [] }
    });
    applyCommand(doc, {
      type: 'ADD_THEME_INSTANCE',
      element: {
        id: 'el-hero',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'instance',
        instanceType: 'theme',
        themeId: 'theme-1',
        componentPath: 'src/Hero.astro',
        classes: emptyClassData(),
        staticMarkup: '<section><h1 data-key="el-hero:h1-0">Title</h1><p data-key="el-hero:p-0">Text</p></section>',
      }
    });

    applyCommand(doc, {
      type: 'DELETE_INSTANCE_CHILD',
      instanceId: 'el-hero',
      selector: 'h1-0',
    });

    const instance = elements.get('el-hero') as Y.Map<unknown>;
    const deleted = instance.get('deletedSelectors') as Y.Array<string>;
    expect(deleted.toArray()).toEqual(['h1-0']);
  });

  it('should not duplicate selector if already deleted', () => {
    const doc = createEditorDoc();

    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'page-1', name: 'Home', rootElementIds: [], children: [] }
    });
    applyCommand(doc, {
      type: 'ADD_THEME_INSTANCE',
      element: {
        id: 'el-hero',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'instance',
        instanceType: 'theme',
        themeId: 'theme-1',
        componentPath: 'src/Hero.astro',
        classes: emptyClassData(),
        staticMarkup: '<section><h1>Title</h1></section>',
      }
    });

    applyCommand(doc, { type: 'DELETE_INSTANCE_CHILD', instanceId: 'el-hero', selector: 'h1-0' });
    applyCommand(doc, { type: 'DELETE_INSTANCE_CHILD', instanceId: 'el-hero', selector: 'h1-0' });

    const instance = doc.getMap('elements').get('el-hero') as Y.Map<unknown>;
    const deleted = instance.get('deletedSelectors') as Y.Array<string>;
    expect(deleted.toArray()).toEqual(['h1-0']);
  });

  it('should do nothing if instance not found', () => {
    const doc = createEditorDoc();
    // Should not throw
    applyCommand(doc, { type: 'DELETE_INSTANCE_CHILD', instanceId: 'nonexistent', selector: 'h1-0' });
  });
});


describe('RESET_THEME_INSTANCE_OVERRIDE clears deletedSelectors', () => {
  it('should clear deletedSelectors for the given selector', () => {
    const doc = createEditorDoc();

    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'page-1', name: 'Home', rootElementIds: [], children: [] }
    });
    applyCommand(doc, {
      type: 'ADD_THEME_INSTANCE',
      element: {
        id: 'el-hero',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'instance',
        instanceType: 'theme',
        themeId: 'theme-1',
        componentPath: 'src/Hero.astro',
        classes: emptyClassData(),
        staticMarkup: '<section><h1>Title</h1><p>Text</p></section>',
      }
    });

    // Delete two children
    applyCommand(doc, { type: 'DELETE_INSTANCE_CHILD', instanceId: 'el-hero', selector: 'h1-0' });
    applyCommand(doc, { type: 'DELETE_INSTANCE_CHILD', instanceId: 'el-hero', selector: 'p-0' });

    // Reset h1-0 — should restore it
    applyCommand(doc, { type: 'RESET_THEME_INSTANCE_OVERRIDE', instanceId: 'el-hero', selector: 'h1-0' });

    const instance = doc.getMap('elements').get('el-hero') as Y.Map<unknown>;
    const deleted = instance.get('deletedSelectors') as Y.Array<string>;
    expect(deleted.toArray()).toEqual(['p-0']);
  });
});

describe('ADD_ELEMENT astroSource', () => {
  it('should store astroSource when provided', () => {
    const doc = createEditorDoc();
    const elements = doc.getMap('elements');

    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'page-1', name: 'Home', rootElementIds: [], children: [] },
    });

    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'el-test-001',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'component',
        instanceType: 'local',
        componentType: 'hero',
        classes: emptyClassData(),
        staticMarkup: '<section>Hello</section>',
        classOverrides: {},
        astroSource: 'src/components/library/Hero.astro',
      },
    });

    const el = elements.get('el-test-001') as Y.Map<unknown>;
    expect(el.get('astroSource')).toBe('src/components/library/Hero.astro');
  });

  it('should not set astroSource when not provided', () => {
    const doc = createEditorDoc();
    const elements = doc.getMap('elements');

    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'page-1', name: 'Home', rootElementIds: [], children: [] },
    });

    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'el-test-002',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'component',
        instanceType: 'local',
        componentType: 'hero',
        classes: emptyClassData(),
        staticMarkup: '<section>Hello</section>',
        classOverrides: {},
      },
    });

    const el = elements.get('el-test-002') as Y.Map<unknown>;
    expect(el.get('astroSource')).toBeUndefined();
  });
});

