# Undo/Redo Flow

How Cmd+Z and Cmd+Shift+Z work to restore previous states.

## Overview

Starquix uses **snapshot-based undo** (not Yjs's Y.UndoManager). Each undoable action captures the full editor state before making changes.

```
takeSnapshot() captures state
        ↓
User makes change (class, text, page)
        ↓
User presses Cmd+Z
        ↓
applySnapshot() restores previous state
        ↓
Yjs observers sync to iframe and files
```

## Semantics: checkpoint model

Undo restores the **whole checkpoint**, not a scoped slice. Implications:

- **Granularity = one snapshot per user action.** Every undoable action calls
  `takeSnapshot()` immediately BEFORE its Yjs mutation; one Cmd+Z rewinds to
  that checkpoint.
- **Mutations without `takeSnapshot()` fold into the previous undo step** —
  the next undo silently reverts them too. This is the one way the model
  bites; in dev, `UndoProvider` watches `afterTransaction` and
  `console.warn`s (`[undo] user mutation without takeSnapshot`) when a
  `'user'`-origin transaction commits without a preceding snapshot.
- **Wrap/unwrap-link snapshots are deferred to `MARKUP_CHANGED`.** The
  `sq:wrap-link` / `sq:unwrap-link` dispatch sites post fire-and-forget
  bridge messages and do NOT snapshot; the snapshot happens in the
  `MARKUP_CHANGED` handler right before the actual Yjs mutation. Successful
  wrap = exactly one undo entry; silent bridge failure = stack untouched.
- **Completeness is compiler-enforced.** The fixtures in
  `app/src/context/__tests__/UndoContext.completeness.test.tsx` are typed
  `Required<Omit<PageData|ElementData, EXEMPT>>` — adding a field to either
  type without deciding its snapshot fate is a compile error.

## Snapshot Structure

**File:** `app/src/context/UndoContext.tsx` (interface `UndoSnapshot`)

```typescript
interface UndoSnapshot {
  sourceClasses: Record<string, SourceClassEntry>;                 // classes + sourceLocation per source key
  sourceText: Record<string, string>;                              // text content per source key
  sourceImageAttributes: Record<string, Record<string, string>>;   // image attrs per source key
  sourceLinkAttributes: Record<string, Record<string, string>>;    // link attrs per source key
  pageOrder: Record<string, string[]>;                             // rootElementIds per page
  pages: Record<string, PageData>;                                 // FULL PageData: name, rootElementIds,
                                                                   // children, childOrders, seo, pageType,
                                                                   // collectionId, routePrefix, layoutName, layoutProps
  rootPages: string[];                                             // top-level page order
  elements: Record<string, ElementData>;                           // every element, all override maps, plus the
                                                                   // optional scalars in ELEMENT_OPTIONAL_SNAPSHOT_FIELDS
                                                                   // (isWrapperLink, originalType, bindingType,
                                                                   //  originalThemeId, originalComponentPath, originalTemplateId)
  unifiedOverrides: Record<string, SerializedOverrides>;           // Override API snapshot per element (incl. href)
  variableCollections: Record<string, VariableCollection>;         // design variables
  assetSideEffect?: AssetSideEffect;                               // reverse/forward callbacks for asset ops
  fileRecords?: FileUndoRecord[];                                  // AI-batch file changes
}
```

Optional page scalars (`pageType`, `collectionId`, `routePrefix`,
`layoutName`, `layoutProps`, `seo`) and the element fields in
`ELEMENT_OPTIONAL_SNAPSHOT_FIELDS` (`store/types.ts`) restore with
**delete-when-absent** semantics: undoing the action that SET the field
removes it. New optional scalar fields go into those lists, not as one-off
lines in UndoContext.

## Creating Snapshots

**File:** `app/src/context/UndoContext.tsx` (line 59)

```typescript
const createSnapshot = useCallback((): UndoSnapshot => {
  const sourceClasses: Record<string, SourceClassEntry> = {};
  const sourceText: Record<string, string> = {};

  // Read from Yjs
  doc.getMap('sourceClasses').forEach((value, key) => {
    const entry = value as Y.Map<unknown>;
    sourceClasses[key] = {
      classes: entry.get('classes') as string || '',
      sourceLocation: extractSourceLocation(entry)
    };
  });

  doc.getMap('sourceText').forEach((value, key) => {
    const entry = value as Y.Map<unknown>;
    sourceText[key] = (entry.get('textContent') as string) || '';
  });

  // ... pages, rootPages

  return { sourceClasses, sourceText, pageOrder, pages, rootPages };
}, [doc]);
```

## Where takeSnapshot() is Called

Before any undoable action — ~90 call sites across ~30 files. By category
(grep `takeSnapshot()` for the exact list):

| Category | Representative files |
|----------|----------------------|
| Class/style edits | `ClassStoreContext.tsx`, DesignBar blocks |
| Text/markup edits | `ViewportFrame.tsx` (edit-mode entry, MARKUP_CHANGED) |
| Page ops (create/delete/rename/move/layout) | `PagesContext.tsx`, `LocalPagesContext.tsx` |
| SEO edits | `SeoPanel/useSeoData.ts` |
| Element ops (add/remove/reorder/reparent/draw) | `ViewportFrame.tsx`, `useReorderElements.ts`, LayersPanel |
| Link ops | `ViewportFrame.tsx` MARKUP_CHANGED handler (deferred — see Semantics) |
| Instance lifecycle (push/reset/update-to-master) | DesignBar, Assets |
| Images/assets | image upload + DesignBar image blocks (with `assetSideEffect`) |
| AI batch tools | batch executor (with `fileRecords`) |
| Variables/collections | variable editors |

Example from ClassStoreContext:
```typescript
const setClasses = useCallback((key, classes) => {
  takeSnapshot();  // BEFORE the change
  dispatch({ type: 'UPDATE_SOURCE_CLASSES', sourceKey: key, classes });
}, [dispatch, takeSnapshot]);
```

## Triggering Undo/Redo

**File:** `app/src/hooks/useKeyboardShortcuts.ts` (line 64)

```typescript
const handleKeyDown = useCallback((e: KeyboardEvent) => {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

  // Skip if in contentEditable (let browser handle it)
  if ((e.target as HTMLElement).isContentEditable) return;

  // Undo: Cmd/Ctrl + Z
  if (cmdOrCtrl && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    undo();
    return;
  }

  // Redo: Cmd/Ctrl + Shift + Z or Cmd/Ctrl + Y
  if (cmdOrCtrl && ((e.key === 'z' && e.shiftKey) || e.key === 'y')) {
    e.preventDefault();
    redo();
    return;
  }
}, [undo, redo]);
```

## Applying Snapshots

**File:** `app/src/context/UndoContext.tsx` (line 111)

`applySnapshot` runs inside `doc.transact(..., 'undo')` and is
**diff-on-apply**: every section deletes keys missing from the snapshot,
skips equal values, and only writes real changes (Yjs treats every `set` as
delete+insert and notifies observers, so blanket clear+rebuild made the
RENDER pipeline cascade after undo even for untouched maps). Semantics are
unchanged — post-apply state is byte-identical to the snapshot.

```typescript
const applySnapshot = useCallback((snapshot: UndoSnapshot) => {
  doc.transact(() => {
    // For each top-level map: delete missing keys, skip equal entries,
    // write only changed ones. Same pattern per-element and per-page.
  }, 'undo');  // Transaction origin marks this as undo
}, [doc]);
```

## Undo/Redo Functions

**File:** `app/src/context/UndoContext.tsx` (line 201)

```typescript
const undo = useCallback(() => {
  if (past.length === 0) return;

  // Capture current state for redo
  const currentSnapshot = createSnapshot();
  const previous = past[past.length - 1];

  // Move to future stack
  setFuture(prev => [currentSnapshot, ...prev]);
  setPast(prev => prev.slice(0, -1));

  // Flag that undo is happening
  isUndoingRef.current = true;
  applySnapshot(previous);
  isUndoingRef.current = false;
}, [past, createSnapshot, applySnapshot]);

const redo = useCallback(() => {
  if (future.length === 0) return;

  const currentSnapshot = createSnapshot();
  const next = future[0];

  setPast(prev => [...prev, currentSnapshot]);
  setFuture(prev => prev.slice(1));

  isUndoingRef.current = true;
  applySnapshot(next);
  isUndoingRef.current = false;
}, [future, createSnapshot, applySnapshot]);
```

## Syncing to Iframe and Files

When `applySnapshot()` runs, Yjs observers detect changes and sync:

### Classes sync (ClassStoreContext)

**File:** `app/src/context/ClassStoreContext.tsx` (line 271)

```typescript
// During undo/redo, persist immediately (don't debounce)
if (isUndoingOrRedoing()) {
  viteClassWriter.writeClassUpdate(entry.sourceLocation, entry.classes);
}
```

### Text sync (ViewportFrame)

**File:** `app/src/components/Canvas/ViewportFrame.tsx` (line 110)

```typescript
const syncText = () => {
  const isUndoing = isUndoingRef.current;

  sourceText.forEach((entry, key) => {
    const textContent = entry.get('textContent') as string;

    if (isUndoing && textContent !== prevText) {
      // Update iframe
      iframeRef.current?.contentWindow?.postMessage({
        type: 'UPDATE_TEXT',
        payload: { key, textContent }
      }, '*');

      // Write to source file
      viteTextWriter.writeTextUpdate(element.sourceLocation, textContent);
    }
  });
};
```

## Why Not Y.UndoManager?

This project uses custom snapshots instead of Yjs's built-in UndoManager because:

1. **Full-state capture** - Snapshots include sourceClasses, sourceText, AND pages together
2. **Multi-step grouping** - One "class change" is one undo unit, not individual Yjs operations
3. **Page operations** - Create/delete/rename pages are undoable
4. **File integration** - Observers handle file persistence differently during undo

## Key Design Points

**Transaction origin:** `'undo'` marks the transaction so observers can detect it:
```typescript
doc.transact(() => { ... }, 'undo');
```

**isUndoingRef flag:** Components check this to handle undo differently:
```typescript
if (isUndoingOrRedoing()) {
  // Write immediately, don't debounce
}
```

**Max undo steps:** 20 (see `MAX_UNDO_STEPS` constant)

## Key Files

| File | Role |
|------|------|
| `context/UndoContext.tsx` | Snapshot management, undo/redo logic |
| `hooks/useKeyboardShortcuts.ts` | Cmd+Z/Cmd+Shift+Z handlers |
| `context/ClassStoreContext.tsx` | Class sync during undo |
| `components/Canvas/ViewportFrame.tsx` | Text sync during undo |

## Debugging

```typescript
// UndoContext.tsx - on undo
console.log('[UndoContext] undo() called, past.length:', past.length);

// ClassStoreContext.tsx - detecting undo
console.log('[ClassStore] isUndoingOrRedoing:', isUndoingOrRedoing());

// ViewportFrame.tsx - text sync
console.log('[ViewportFrame] syncText called, isUndoing:', isUndoing);
```

## Common Issues

**Undo not working:**
- Check `takeSnapshot()` was called BEFORE the action
- Check `past.length > 0` when undo is triggered

**File not updating on undo:**
- Check `isUndoingRef.current` is true during apply
- Check observer is detecting the change

**Cmd+Z doing native browser undo:**
- Check event target isn't contentEditable
- Check `e.preventDefault()` is being called
