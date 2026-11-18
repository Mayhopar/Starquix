// src/store/createEditorDoc.ts
import * as Y from 'yjs';
import type { Breakpoint, ClassData, LinkAttributes } from './types';
import { BREAKPOINTS } from './types';

export const BREAKPOINT_STORAGE_KEY = 'starquix:breakpoint';

/** Get saved breakpoint from localStorage */
function getSavedBreakpoint(): Breakpoint {
  try {
    const saved = localStorage.getItem(BREAKPOINT_STORAGE_KEY);
    if (saved && saved in BREAKPOINTS) {
      return saved as Breakpoint;
    }
  } catch {
    // localStorage may not be available
  }
  return 'base';
}

export function createEditorDoc(): Y.Doc {
  const doc = new Y.Doc();

  // Initialize top-level structures
  const meta = doc.getMap('meta');
  meta.set('projectId', '');
  meta.set('projectName', '');
  meta.set('currentPageId', null);
  meta.set('currentBreakpoint', getSavedBreakpoint());

  doc.getMap('pages');
  doc.getMap('elements');
  doc.getMap('templates');  // Component templates
  doc.getArray('rootPages');  // Root-level page IDs in order

  // Source-keyed class data for unified undo
  // Keys are source tracking keys like "src/components/Hero.astro:5:1"
  // Values are Y.Map with breakpoint → Y.Array<string> (class tokens)
  doc.getMap('sourceClasses');

  doc.getMap('variableCollections');

  doc.getMap('contentCollections');
  doc.getMap('blogSlotBindings');

  // Project fonts: family → { source, css, assetIds } (task-112)
  doc.getMap('fonts');

  return doc;
}

export function classDataToYMap(classes: ClassData): Y.Map<Y.Array<string>> {
  const yClasses = new Y.Map<Y.Array<string>>();

  for (const bp of ['base', 'sm', 'md', 'lg', 'xl', '2xl'] as Breakpoint[]) {
    const arr = new Y.Array<string>();
    arr.push(classes[bp]);
    yClasses.set(bp, arr);
  }

  return yClasses;
}

/** Convert a Y.Map with link attribute keys to a LinkAttributes object. */
export function yMapToLinkAttributes(yMap: Y.Map<unknown>): LinkAttributes {
  return {
    href: (yMap.get('href') as string) || '',
    target: yMap.get('target') as LinkAttributes['target'],
    rel: yMap.get('rel') as string | undefined,
    title: yMap.get('title') as string | undefined,
    ariaLabel: yMap.get('ariaLabel') as string | undefined,
  };
}

export function yMapToClassData(yClasses: Y.Map<Y.Array<string>>): ClassData {
  return {
    base: yClasses.get('base')?.toArray() || [],
    sm: yClasses.get('sm')?.toArray() || [],
    md: yClasses.get('md')?.toArray() || [],
    lg: yClasses.get('lg')?.toArray() || [],
    xl: yClasses.get('xl')?.toArray() || [],
    '2xl': yClasses.get('2xl')?.toArray() || [],
  };
}

