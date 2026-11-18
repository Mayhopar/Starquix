// Phase 4 of docs/archive/plans/2026-06-10-selection-key-architecture-memo.md.
//
// One pure derivation of "what is selected and what kind of thing is it" for
// the DesignBar. DesignBar computes this ONCE from its raw signals and reads
// every kind decision (and the heading labels) from the descriptor, instead of
// inferring them in ~6 scattered booleans. Pure data-in/data-out so every
// decision is unit-testable without the instance/iframe pipeline.
//
// The derivations mirror the previous inline DesignBar logic exactly —
// selectionDescriptor.test.ts is the behavior-preservation contract.
import { classifyKey, type KeyKind } from '@/store/keyKind';
import { isSlotSelection } from '@/utils/slotDetection';

export interface SelectionDescriptorInput {
  /** The selected key (SelectionContext.selectedKey). */
  key: string | null;
  currentPageId: string | null;
  /** COMPONENT_EDITOR_PAGE_ID (passed in to keep this module store-constant free). */
  componentEditorPageId: string;
  /** Scanned tag of the selection. */
  tagName: string | null;
  /** Scanned slotName of the selection ('' = default slot; undefined = not a filled slot). */
  slotName: string | undefined;
  /** Yjs element `type` for the key. */
  elementType: string | undefined;
  /** Yjs element `slotType` for the key (raw). */
  slotType: string | undefined;
  /** slotType with the BlogSlot componentType fallback applied ('blog'). */
  resolvedSlotType: string | undefined;
  /** The key is a master rendered at the page root (child-shaped key, root semantics). */
  isRenderedMasterRoot: boolean;
  /** The key's own Yjs entry is a master. */
  isSelfMaster: boolean;
  /** The selection is a blog post root (BlogCard) inside a BlogSlot. */
  isPostRoot: boolean;
  /** BlogCard component name, used as the post root's label. */
  postRootComponentName: string;
  /** Basename of the component editor root's astroSource (null outside the editor). */
  editorRootName: string | null;
  /** Names of known layouts in the layout library. */
  layoutLibraryNames: string[];
  /** isLayoutPath(editorRootAstroSource) — defensive positive for layouts/ paths. */
  editorRootIsLayoutPath: boolean;
  /**
   * task-149 — local mode's lone-component view is the SAME concept as the
   * component editor: the surface IS the component's own file, so you are the
   * source and there is no instance lifecycle to offer.
   *
   * It cannot be recognised from `currentPageId`: local keeps a normal page id
   * selected and only overrides the iframe ROUTE
   * (`/__sq_component_view/{file}`, Editor.tsx). Nor from the selected key —
   * on a component-only page every key is a component file too. So the view
   * state is passed in (services/localComponentView.ts), and `isComponentEditor`
   * covers both runtimes instead of a second, parallel gate.
   */
  isLocalComponentView?: boolean;
}

export interface SelectionDescriptor {
  /** classifyKey(key) — the key's entity kind. */
  kind: KeyKind | null;
  /** The viewport shows the ephemeral component-editor doc. */
  isComponentEditor: boolean;
  /** The current page's layout-chrome ROOT is selected (the "Layout" level). */
  isLayoutSelection: boolean;
  /** The selection is a <slot> in any of its four representations. */
  isSlotElement: boolean;
  /** Instance-child key with child semantics (not a rendered master root). */
  isInstanceChild: boolean;
  /** Instance root: rendered master root, or a self-master element. */
  isInstanceRoot: boolean;
  /** The component editor is editing a LAYOUT document. */
  isLayoutEditor: boolean;
  /** The matched layout-library name when isLayoutEditor came from a match. */
  editorLayoutName: string | null;
  /** Capitalized tag/selector name ('Instance' fallback). */
  elementDisplayName: string;
  /** Lowercase tag, from the selector for instance children ('' fallback). */
  effectiveTagName: string;
  /** The DesignBar heading: Slot > layout name > Blog Slot > post root > element. */
  displayLabel: string;
}

export function deriveSelectionDescriptor(
  input: SelectionDescriptorInput,
): SelectionDescriptor {
  const {
    key, currentPageId, componentEditorPageId,
    tagName, slotName, elementType, slotType, resolvedSlotType,
    isRenderedMasterRoot, isSelfMaster,
    isPostRoot, postRootComponentName,
    editorRootName, layoutLibraryNames, editorRootIsLayoutPath,
    isLocalComponentView = false,
  } = input;

  const kind = classifyKey(key);
  const isComponentEditor =
    currentPageId === componentEditorPageId || isLocalComponentView;

  const isLayoutSelection =
    !!currentPageId && kind?.kind === 'layout-chrome' && kind.pageId === currentPageId;

  const isSlotElement = isSlotSelection({ tagName, slotName, elementType, slotType });

  const isInstanceChildRaw = kind?.kind === 'instance-child';
  const isInstanceChild = isInstanceChildRaw && !isRenderedMasterRoot;
  const isInstanceRoot = !key
    ? false
    : isRenderedMasterRoot
      ? true
      : isInstanceChild
        ? false
        : isSelfMaster;

  // The editor root's path prefix is environment-dependent, so the reliable
  // layout signal is a basename match against the layout library; the layouts/
  // path check stays as a defensive positive.
  const editorLayoutName =
    isComponentEditor && editorRootName && layoutLibraryNames.includes(editorRootName)
      ? editorRootName
      : null;
  const isLayoutEditor = !!editorLayoutName || (isComponentEditor && editorRootIsLayoutPath);

  const selectorTag =
    isInstanceChild && kind?.kind === 'instance-child'
      ? kind.selector.replace(/-\d+$/, '')
      : null;
  const elementDisplayName = selectorTag
    ? selectorTag.replace(/^./, (c) => c.toUpperCase())
    : tagName
      ? tagName.replace(/^./, (c) => c.toUpperCase())
      : 'Instance';
  const effectiveTagName = selectorTag ? selectorTag.toLowerCase() : (tagName?.toLowerCase() || '');

  // A slot is a slot first — even inside the layout editor it reads "Slot",
  // never the layout's name (its panel is the minimal slot one).
  const displayLabel = isSlotElement
    ? 'Slot'
    : isLayoutEditor && editorLayoutName
      ? editorLayoutName
      : resolvedSlotType === 'blog'
        ? 'Blog Slot'
        : isPostRoot
          ? postRootComponentName
          : elementDisplayName;

  return {
    kind,
    isComponentEditor,
    isLayoutSelection,
    isSlotElement,
    isInstanceChild,
    isInstanceRoot,
    isLayoutEditor,
    editorLayoutName,
    elementDisplayName,
    effectiveTagName,
    displayLabel,
  };
}
