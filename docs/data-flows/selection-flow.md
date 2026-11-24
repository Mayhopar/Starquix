# Selection Flow

How clicking an element in the preview selects it in the editor.

## Overview

```
┌─────────────────┐    postMessage    ┌─────────────────┐
│  Astro iframe   │ ───────────────►  │  React App      │
│  (bridge.js)    │                   │  (ViewportFrame)│
└─────────────────┘                   └─────────────────┘
        │                                      │
   User clicks                          Updates Yjs doc
   element                              & SelectionContext
```

## Step-by-Step

### 1. User clicks element in iframe

**File:** `preview-template/public/scripts/bridge.js` (handleClick, ~line 1463)

Bridge.js intercepts all clicks and extracts element info:

```javascript
var key = this.getElementKey(target);           // data-element-key
var sourceLocation = this.parseSourceLocation(target);  // file:line:col
var rect = target.getBoundingClientRect();
var classes = this.getElementClasses(target);

this.sendToParent({
  type: 'ELEMENT_CLICK',
  payload: {
    key: key,
    tagName: target.tagName.toLowerCase(),
    classes: classes,
    sourceLocation: sourceLocation,
    rect: rect,
    parentKey: parentKey,
    parentDisplay: parentDisplay,
    isDoubleClick: isDoubleClick,
    hasChildren: hasChildren,
  }
});
```

### 2. ViewportFrame receives message

**File:** `app/src/components/Canvas/ViewportFrame.tsx` (~line 334)

```typescript
case 'ELEMENT_CLICK': {
  const payload = event.data.payload;

  // Update Yjs for undo support
  dispatch({
    type: 'SELECT_SOURCE_ELEMENT',
    sourceLocation: payload.sourceLocation,
    rect: payload.rect,
    key: payload.key,
    classes: payload.classes,
  });

  // Update SelectionContext for UI
  selectInContext(payload.key, {
    sourceLocation: payload.sourceLocation,
    tagName: payload.tagName,
    classes: payload.classes,
    rect: payload.rect,
  });

  // Register in ClassStore for DesignBar
  registerElement(payload.key, payload.classes, payload.sourceLocation);
}
```

### 3. Yjs document updates

**File:** `app/src/store/commands.ts`

```typescript
case 'SELECT_SOURCE_ELEMENT': {
  meta.set('selectedSourceKey', command.key);
  meta.set('sourceLocation', command.sourceLocation);
  // Classes stored separately in sourceClasses map
}
```

### 4. React UI updates

Components subscribe via hooks:

```typescript
// In DesignBar
const selectedKey = useYjsValue(selectSelectedSourceKey);
const classes = useSelectedClasses();

// Rerenders when selection changes
```

## Double-Click Context Drilling

Double-clicking enters a container (Figma-like behavior):

```javascript
// In bridge.js
var isDoubleClick = (key === this.lastClickKey) &&
  (now - this.lastClickTime < DOUBLE_CLICK_THRESHOLD_MS);

// In ViewportFrame
if (isDoubleClick && hasChildren) {
  enterContext(payload.key);  // Drill into container
}
```

**Context stack:** Tracks nested drill-down path. Clicking outside exits context.

## Right-click menu and Create container

The canvas and the Layers panel share one menu: `components/Editor/LayerContextMenu.tsx`, opened through `layerMenuStore.ts`. It has one item today, **Create container** (`⌘G` on macOS, `Ctrl+Alt+G` elsewhere, because `Ctrl+G` is the grid toggle).

- **Layers:** right-clicking a row keeps the selection if the row is part of it; otherwise the row is selected first.
- **Canvas:** right-clicking inside a selected layer keeps the selection. Elsewhere, `ViewportFrame` posts a plain `SIMULATE_CLICK`, and the menu opens once that click's `ELEMENT_CLICK` has selected the layer (`viewportMessages/selection.ts`). The right button never starts a drag or a left-click selection.
- **Wrap:** every trigger calls `useWrapSelection()` → `wrapLocalElements` (`localStructuralOps.ts`). It writes one source gesture: a class-less `<div>` at the first selected layer, holding the selected layers in document order. Unselected siblings between them stay outside, after the container. It pushes one structural undo record, so `⌘Z` gives back the exact bytes.
- **Key repeat:** the shortcut ignores auto-repeat, also with focus in the preview: the bridge's `KEYBOARD_EVENT` carries `repeat` and the parent's re-dispatched keydown keeps it.
- **Selection:** cleared when the write is accepted, then the container is selected after the next scan.
- **Refusals** show a toast and change nothing: layers with different parents, text or code between them in the source, a `<p>` parent, a list, table or select parent (`ul`, `tr`, `select` …: a `<div>` there is invalid, and in a table the parser hoists it out of the file's place), `html`/`head`/`body`, loop copies, and layers with no source location or inside a component opened from a page. Messages are the `WRAP_*` constants and the existing structural-op feedback.

## Key Files

| File | Role |
|------|------|
| `bridge.js` handleClick() | Captures click, sends message |
| `ViewportFrame.tsx` | Receives message, dispatches command |
| `store/commands.ts` SELECT_SOURCE_ELEMENT | Updates Yjs |
| `context/SelectionContext.tsx` | Provides selection state to UI |

## Debugging

Add logging at each step:

```typescript
// ViewportFrame.tsx
case 'ELEMENT_CLICK':
  console.log('[Selection] Click received:', event.data.payload);
```

```javascript
// bridge.js
console.log('[Bridge] Sending click:', key, sourceLocation);
```
