// Phase 4 of docs/archive/plans/2026-06-10-selection-key-architecture-memo.md:
// DesignBar receives one selection DESCRIPTOR instead of inferring ~6 kind
// booleans inline. deriveSelectionDescriptor is pure — every "what is selected"
// decision DesignBar makes is unit-testable here without the iframe pipeline
// (memo F6/F7). The expected values mirror the previous inline derivations
// exactly; this suite is the behavior-preservation contract.
import { describe, it, expect } from 'vitest';
import {
  deriveSelectionDescriptor,
  type SelectionDescriptorInput,
} from '../selectionDescriptor';

const EDITOR_PAGE = '__component-editor';

const base: SelectionDescriptorInput = {
  key: null,
  currentPageId: 'page-1',
  componentEditorPageId: EDITOR_PAGE,
  tagName: null,
  slotName: undefined,
  elementType: undefined,
  slotType: undefined,
  resolvedSlotType: undefined,
  isRenderedMasterRoot: false,
  isSelfMaster: false,
  isPostRoot: false,
  postRootComponentName: '',
  editorRootName: null,
  layoutLibraryNames: [],
  editorRootIsLayoutPath: false,
};

describe('deriveSelectionDescriptor — kind + layout selection', () => {
  it('classifies the layout-chrome root of the CURRENT page as a layout selection', () => {
    const d = deriveSelectionDescriptor({ ...base, key: 'layoutchrome-page-1' });
    expect(d.kind?.kind).toBe('layout-chrome');
    expect(d.isLayoutSelection).toBe(true);
  });

  it('a layout-chrome key of a DIFFERENT page is not a layout selection', () => {
    const d = deriveSelectionDescriptor({ ...base, key: 'layoutchrome-page-2' });
    expect(d.isLayoutSelection).toBe(false);
  });

  it('the infrastructure wrapper yields kind wrapper and no entity booleans', () => {
    const d = deriveSelectionDescriptor({
      ...base,
      key: 'src/pages/preview/[projectId]/[pageId].astro:17:29',
      tagName: 'div',
    });
    expect(d.kind).toEqual({ kind: 'wrapper' });
    expect(d.isLayoutSelection).toBe(false);
    expect(d.isInstanceChild).toBe(false);
    expect(d.isInstanceRoot).toBe(false);
    expect(d.isSlotElement).toBe(false);
  });
});

describe('deriveSelectionDescriptor — instance child/root', () => {
  it('instance child: child true, root false, names derived from the selector', () => {
    const d = deriveSelectionDescriptor({ ...base, key: 'el-abc:section-0' });
    expect(d.isInstanceChild).toBe(true);
    expect(d.isInstanceRoot).toBe(false);
    expect(d.elementDisplayName).toBe('Section');
    expect(d.effectiveTagName).toBe('section');
  });

  it('a rendered master ROOT with a child-shaped key counts as root, not child', () => {
    const d = deriveSelectionDescriptor({
      ...base,
      key: 'el-abc:section-0',
      isRenderedMasterRoot: true,
    });
    expect(d.isInstanceChild).toBe(false);
    expect(d.isInstanceRoot).toBe(true);
  });

  it('a self-master element key is an instance root', () => {
    const d = deriveSelectionDescriptor({ ...base, key: 'el-abc', isSelfMaster: true });
    expect(d.isInstanceRoot).toBe(true);
    expect(d.isInstanceChild).toBe(false);
  });

  it('no key → no instance booleans, display name falls back to Instance', () => {
    const d = deriveSelectionDescriptor({ ...base, isSelfMaster: true });
    expect(d.isInstanceRoot).toBe(false);
    expect(d.elementDisplayName).toBe('Instance');
  });
});

describe('deriveSelectionDescriptor — slot detection and label precedence', () => {
  it('a literal <slot> (scanned tagName) is a slot and labels "Slot" even in the layout editor', () => {
    const d = deriveSelectionDescriptor({
      ...base,
      currentPageId: EDITOR_PAGE,
      key: 'library/Layout.astro:5:1',
      tagName: 'slot',
      editorRootName: 'Layout',
      layoutLibraryNames: ['Layout'],
    });
    expect(d.isSlotElement).toBe(true);
    expect(d.isLayoutEditor).toBe(true);
    expect(d.displayLabel).toBe('Slot');
  });

  it('a FILLED layout slot (scanned slotName, div tag) is a slot', () => {
    const d = deriveSelectionDescriptor({
      ...base,
      key: 'layoutchrome-page-1:div-0',
      tagName: 'div',
      slotName: '',
    });
    expect(d.isSlotElement).toBe(true);
  });

  it('a blog slot labels "Blog Slot"', () => {
    const d = deriveSelectionDescriptor({
      ...base,
      key: 'el-abc',
      tagName: 'section',
      resolvedSlotType: 'blog',
    });
    expect(d.displayLabel).toBe('Blog Slot');
  });

  it('a post root labels with the BlogCard component name', () => {
    const d = deriveSelectionDescriptor({
      ...base,
      key: 'el-abc:article-0',
      isPostRoot: true,
      postRootComponentName: 'BlogCard',
    });
    expect(d.displayLabel).toBe('BlogCard');
  });

  it('a plain element labels with its capitalized tag', () => {
    const d = deriveSelectionDescriptor({ ...base, key: 'library/Hero.astro:5:1', tagName: 'div' });
    expect(d.displayLabel).toBe('Div');
    expect(d.effectiveTagName).toBe('div');
  });
});

describe('deriveSelectionDescriptor — component/layout editor', () => {
  it('the component editor page id flips isComponentEditor', () => {
    const d = deriveSelectionDescriptor({ ...base, currentPageId: EDITOR_PAGE });
    expect(d.isComponentEditor).toBe(true);
    expect(deriveSelectionDescriptor(base).isComponentEditor).toBe(false);
  });

  it('an editor root matching a library LAYOUT makes a layout editor and labels by layout name', () => {
    const d = deriveSelectionDescriptor({
      ...base,
      currentPageId: EDITOR_PAGE,
      key: 'library/MainLayout.astro:1:1',
      tagName: 'html',
      editorRootName: 'MainLayout',
      layoutLibraryNames: ['MainLayout', 'Other'],
    });
    expect(d.isLayoutEditor).toBe(true);
    expect(d.editorLayoutName).toBe('MainLayout');
    expect(d.displayLabel).toBe('MainLayout');
  });

  it('a layouts/-path editor root with no library match is still a layout editor (defensive), label falls back', () => {
    const d = deriveSelectionDescriptor({
      ...base,
      currentPageId: EDITOR_PAGE,
      key: 'layouts/Unknown.astro:1:1',
      tagName: 'main',
      editorRootName: 'Unknown',
      layoutLibraryNames: ['Other'],
      editorRootIsLayoutPath: true,
    });
    expect(d.isLayoutEditor).toBe(true);
    expect(d.editorLayoutName).toBeNull();
    expect(d.displayLabel).toBe('Main');
  });

  it('a library-name match OUTSIDE the component editor is not a layout editor', () => {
    const d = deriveSelectionDescriptor({
      ...base,
      editorRootName: 'MainLayout',
      layoutLibraryNames: ['MainLayout'],
    });
    expect(d.isLayoutEditor).toBe(false);
  });
});
