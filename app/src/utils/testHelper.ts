// src/utils/testHelper.ts
// Exposes Yjs state to window for E2E testing

import * as Y from 'yjs';
import { selectElement, selectAllPageElements, selectCurrentPageId, selectPage, selectResolvedStaticMarkup } from '@/store/selectors';
import type { Breakpoint, ClassData } from '@/store/types';
import { emptyClassData } from '@/store/types';
import type { TextSelectionState } from '@/context/SelectionContext';

export interface TestHelper {
  getElement: (id: string) => unknown;
  getElements: () => Record<string, unknown>;
  getSelectedElementId: () => string | null;
  getCurrentPageId: () => string | null;
  getRootElementOrder: () => string[];
  getElementCount: () => number;
  // Deep state access for verification
  getElementClasses: (elementId: string, breakpoint: Breakpoint) => string[];
  getElementAllClasses: (elementId: string) => ClassData | null;
  getClassOverrides: (elementId: string) => Record<string, ClassData> | null;
  getLinkOverrides: (elementId: string) => Record<string, Record<string, unknown>> | null;
  getSourceClasses: (key: string) => string | null;
  getResolvedMarkup: (elementId: string) => string | null;
  // Undo/redo stack sizes are set by UndoContext
  getUndoStackSize: () => number;
  getRedoStackSize: () => number;
  // Text selection for E2E testing (set by SelectionContext)
  setTextSelection: (selection: TextSelectionState) => void;
  clearTextSelection: () => void;
  getTextSelectionState: () => TextSelectionState | null;
  // Edit mode for E2E testing (set by SelectionContext)
  enterEditMode: () => void;
  exitEditMode: () => void;
  isEditingText: () => boolean;
  // Internal: set by UndoContext
  _setUndoStackSize?: (size: number) => void;
  _setRedoStackSize?: (size: number) => void;
  _undoStackSize?: number;
  _redoStackSize?: number;
  // Internal: set by SelectionContext
  _setTextSelectionFn?: (selection: TextSelectionState) => void;
  _clearTextSelectionFn?: () => void;
  _getTextSelectionStateFn?: () => TextSelectionState | null;
  _enterEditModeFn?: () => void;
  _exitEditModeFn?: () => void;
  _isEditingTextFn?: () => boolean;
  _getSelectedElementIdFn?: () => string | null;
}

declare global {
  interface Window {
    __STARQUIX_TEST__?: TestHelper;
  }
}

/**
 * Expose Yjs state to window for E2E testing.
 * Only active in development/test mode.
 */
export function setupTestHelper(doc: Y.Doc): void {
  // Only expose in development or test environment
  if (import.meta.env.PROD && !import.meta.env.VITE_E2E_TEST) {
    return;
  }

  const helper: TestHelper = {
    getElement: (id: string) => {
      const el = selectElement(doc, id);
      return el ? JSON.parse(JSON.stringify(el)) : null;
    },

    getElements: () => {
      const currentPageId = selectCurrentPageId(doc);
      if (!currentPageId) return {};

      const elements = selectAllPageElements(doc, currentPageId);
      const result: Record<string, unknown> = {};

      for (const el of elements) {
        result[el.id] = JSON.parse(JSON.stringify(el));
      }

      return result;
    },

    getSelectedElementId: () => {
      // Selection truth lives in SelectionContext (task-075) — the provider
      // injects a ref-backed getter; null before it mounts.
      return window.__STARQUIX_TEST__?._getSelectedElementIdFn?.() ?? null;
    },

    getCurrentPageId: () => {
      return selectCurrentPageId(doc);
    },

    getRootElementOrder: () => {
      const currentPageId = selectCurrentPageId(doc);
      if (!currentPageId) return [];
      const page = selectPage(doc, currentPageId);
      return page?.rootElementIds || [];
    },

    getElementCount: () => {
      const currentPageId = selectCurrentPageId(doc);
      if (!currentPageId) return 0;
      const elements = selectAllPageElements(doc, currentPageId);
      return elements.length;
    },

    getElementClasses: (elementId: string, breakpoint: Breakpoint) => {
      const el = selectElement(doc, elementId);
      if (!el) return [];
      return el.classes[breakpoint] || [];
    },

    getElementAllClasses: (elementId: string) => {
      const el = selectElement(doc, elementId);
      if (!el) return null;
      return JSON.parse(JSON.stringify(el.classes));
    },

    getClassOverrides: (elementId: string) => {
      const elements = doc.getMap('elements');
      const yEl = elements.get(elementId) as Y.Map<unknown> | undefined;
      if (!yEl) return null;

      const classOverrides = yEl.get('classOverrides') as Y.Map<unknown> | undefined;
      if (!classOverrides) return null;

      // Convert Y.Map to plain object
      const result: Record<string, ClassData> = {};
      classOverrides.forEach((value, selector) => {
        const selectorMap = value as Y.Map<Y.Array<string>>;
        const breakpoints: Breakpoint[] = ['base', 'sm', 'md', 'lg', 'xl', '2xl'];
        const classData: ClassData = emptyClassData();
        breakpoints.forEach(bp => {
          const arr = selectorMap.get(bp) as Y.Array<string> | undefined;
          if (arr) {
            classData[bp] = arr.toArray();
          }
        });
        result[selector] = classData;
      });
      return result;
    },

    getLinkOverrides: (elementId: string) => {
      const elements = doc.getMap('elements');
      const yEl = elements.get(elementId) as Y.Map<unknown> | undefined;
      if (!yEl) return null;

      const linkOverrides = yEl.get('linkOverrides') as Y.Map<Y.Map<unknown>> | undefined;
      if (!linkOverrides) return null;

      const result: Record<string, Record<string, unknown>> = {};
      linkOverrides.forEach((value, selector) => {
        const attrs: Record<string, unknown> = {};
        value.forEach((v, k) => {
          attrs[k] = v;
        });
        result[selector] = attrs;
      });
      return result;
    },

    getSourceClasses: (key: string) => {
      const sourceClasses = doc.getMap('sourceClasses');
      const entry = sourceClasses.get(key) as Y.Map<unknown> | undefined;
      if (!entry) return null;
      return (entry.get('classes') as string) || null;
    },

    getResolvedMarkup: (elementId: string) => {
      return selectResolvedStaticMarkup(doc, elementId);
    },

    getUndoStackSize: () => {
      return helper._undoStackSize ?? 0;
    },

    getRedoStackSize: () => {
      return helper._redoStackSize ?? 0;
    },

    _undoStackSize: 0,
    _redoStackSize: 0,

    _setUndoStackSize: (size: number) => {
      helper._undoStackSize = size;
    },

    _setRedoStackSize: (size: number) => {
      helper._redoStackSize = size;
    },

    setTextSelection: (selection: TextSelectionState) => {
      if (helper._setTextSelectionFn) {
        helper._setTextSelectionFn(selection);
      }
    },

    clearTextSelection: () => {
      if (helper._clearTextSelectionFn) {
        helper._clearTextSelectionFn();
      }
    },

    getTextSelectionState: () => {
      if (helper._getTextSelectionStateFn) {
        return helper._getTextSelectionStateFn();
      }
      return null;
    },

    enterEditMode: () => {
      if (helper._enterEditModeFn) {
        helper._enterEditModeFn();
      }
    },

    exitEditMode: () => {
      if (helper._exitEditModeFn) {
        helper._exitEditModeFn();
      }
    },

    isEditingText: () => {
      if (helper._isEditingTextFn) {
        return helper._isEditingTextFn();
      }
      return false;
    },
  };

  window.__STARQUIX_TEST__ = helper;
}

/**
 * Clean up test helper.
 */
export function cleanupTestHelper(): void {
  delete window.__STARQUIX_TEST__;
}
