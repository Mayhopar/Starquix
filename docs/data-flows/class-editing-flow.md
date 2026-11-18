# Class Editing Flow

How changing Tailwind classes in DesignBar updates DOM and source files.

## Overview

```
User changes class in DesignBar
        ↓
setClasses() dispatches UPDATE_SOURCE_CLASSES
        ↓
Yjs sourceClasses map updates
        ↓
ClassStore observer detects change
        ↓
┌───────────────────────┬────────────────────────┐
│ Immediate DOM update  │ Debounced file write   │
│ via UPDATE_CLASSES    │ (5 seconds later)      │
└───────────────────────┴────────────────────────┘
```

## Step-by-Step

### 1. User changes class in DesignBar

**File:** `app/src/components/DesignBar/DesignBar.tsx` (~line 356)

```typescript
const handleClassesChange = useCallback((newBlockClasses: string) => {
  if (!key) return;

  // Get fresh classes from Yjs (avoids stale React state)
  const freshClasses = getClassesFromYjs(key);
  const baseStorage = freshClasses ? parseClasses(freshClasses) : storageRef.current;

  // Update slot for current breakpoint/theme/state
  const newStorage = cloneStorage(baseStorage);
  const slotContent = computeSlotContent(newStorage, currentBreakpoint, currentTheme, currentState, newTokens);
  newStorage[currentBreakpoint][currentTheme][currentState] = slotContent;

  const finalClasses = serializeClasses(newStorage);
  setClasses(key, finalClasses);
}, [/* deps */]);
```

### 2. ClassStore dispatches command

**File:** `app/src/context/ClassStoreContext.tsx` (~line 366)

```typescript
const setClasses = useCallback((key: ElementKey, classes: string) => {
  // Snapshot for undo BEFORE the change
  takeSnapshot();

  // Dispatch to Yjs
  dispatch({
    type: 'UPDATE_SOURCE_CLASSES',
    sourceKey: key,
    classes: safeClasses
  });
}, [dispatch, takeSnapshot]);
```

### 3. Yjs applies command

**File:** `app/src/store/commands.ts` (~line 347)

```typescript
case 'UPDATE_SOURCE_CLASSES': {
  const sourceClasses = doc.getMap('sourceClasses');
  const yEntry = sourceClasses.get(command.sourceKey) as Y.Map<unknown> | undefined;

  if (yEntry) {
    yEntry.set('classes', command.classes);
  } else {
    const newEntry = new Y.Map();
    newEntry.set('classes', command.classes);
    sourceClasses.set(command.sourceKey, newEntry);
  }
  break;
}
```

### 4. ClassStore observer syncs

**File:** `app/src/context/ClassStoreContext.tsx` (~line 218)

Observer detects which keys changed:

```typescript
const syncState = () => {
  const next: ClassStoreState = {};
  sourceClasses.forEach((yEntry, key) => {
    const entry = yEntry as Y.Map<unknown>;
    next[key] = {
      classes: entry.get('classes') as string || '',
      sourceLocation: extractSourceLocation(entry)
    };
  });

  // Find edited keys
  const editedKeys = Object.keys(next).filter(key =>
    prev[key] && prev[key].classes !== next[key].classes
  );

  // For each edited key:
  editedKeys.forEach(key => {
    // 1. Sync to iframe immediately
    window.postMessage({
      type: 'SYNC_CLASSES_TO_IFRAME',
      payload: { key, classes: entry.classes, sourceLocation: entry.sourceLocation }
    }, '*');

    // 2. Mark for file persistence (debounced)
    markDirty(key);
  });
};
```

### 5. DOM updates immediately

**File:** `app/src/components/Canvas/ViewportFrame.tsx` (~line 655)

ViewportFrame catches `SYNC_CLASSES_TO_IFRAME` and forwards to iframe:

```typescript
iframe.contentWindow.postMessage({
  type: 'UPDATE_CLASSES',
  payload: { key, classes, sourceLocation }
}, '*');
```

**File:** `preview-template/public/scripts/bridge.js` (~line 424)

Bridge updates the DOM:

```javascript
IFrameBridge.prototype.handleUpdateClasses = function(payload) {
  var targetElement = this.findElementByKey(payload.key);

  if (targetElement) {
    targetElement.className = payload.classes;

    // Force browser repaint
    targetElement.style.transform = 'translateZ(0)';
    void targetElement.offsetWidth;
    targetElement.style.transform = '';
  }

  // Also update other instances of same component
  if (payload.sourceLocation) {
    var sourceKey = payload.sourceLocation.file + ':' + payload.sourceLocation.line + ':' + payload.sourceLocation.column;
    document.querySelectorAll('[data-sq-source="' + sourceKey + '"]').forEach(function(element) {
      if (element !== targetElement) {
        element.className = payload.classes;
      }
    });
  }

  // Send updated rect back
  requestAnimationFrame(function() {
    self.sendToParent({ type: 'RECT_UPDATED', payload: { key, rect } });
  });
};
```

### 6. File writes after 5s debounce

**File:** `app/src/context/ClassStoreContext.tsx` (~line 160)

```typescript
const saveAllDirtyKeys = useCallback(() => {
  const keysToSave = Array.from(dirtyKeysRef.current);

  keysToSave.forEach(key => {
    const entry = stateRef.current[key];
    if (!entry?.sourceLocation) return;

    viteClassWriter.writeClassUpdate(entry.sourceLocation, entry.classes);
  });

  dirtyKeysRef.current = new Set();
}, []);
```

### 7. ViteClassWriter sends to plugin

**File:** `app/src/services/ViteClassWriter.ts` (~line 86)

```typescript
async writeClassUpdate(sourceLocation: SourceLocation, newClasses: string): Promise<boolean> {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  this.iframeRef.contentWindow.postMessage({
    type: 'SQ_WRITE_CLASSES',
    payload: { sourceLocation, newClasses, requestId }
  }, '*');

  // Wait for result...
}
```

### 8. Vite plugin writes file

**File:** `app/src/vite-plugin/index.ts` (~line 111)

```typescript
server.ws.on('sq:write-classes', async (data) => {
  const content = await readFile(sourceLocation.file, 'utf-8');
  const updatedContent = await updateClassAttribute(content, filePath, sourceLocation, newClasses);

  // Suppress HMR to prevent reload jank
  suppressHmrFiles.set(sourceLocation.file, timeout);

  await writeFile(sourceLocation.file, updatedContent, 'utf-8');
});
```

### 9. AST updates class attribute

**File:** `app/src/vite-plugin/ast-updater.ts` (~line 16)

```typescript
function updateClassTextBased(content, filePath, location, newClasses) {
  // Find opening tag at line:column
  const bracket = findOpeningBracket(lines, lineIndex, colIndex);
  const tagInfo = extractOpeningTag(content, tagStartOffset);

  // Replace or add class attribute
  const newTagContent = replaceOrAddClassAttribute(tagContent, filePath, newClasses);

  return content.slice(0, tagStartOffset) + newTagContent + content.slice(tagEndOffset);
}
```

## Class Storage Format

Classes are stored hierarchically to support responsive design:

```typescript
type ClassStorage = {
  [breakpoint: string]: {       // 'base' | 'sm' | 'md' | 'lg' | 'xl' | '2xl'
    [theme: string]: {          // 'light' | 'dark'
      [state: string]: string[] // 'default' | 'hover' | 'focus' etc.
    }
  }
}
```

**Serialization:** `serializeClasses()` flattens to string with prefixes:
```
"p-4 sm:p-6 md:p-8 hover:bg-blue-100 dark:bg-gray-900"
```

## Dual Path Architecture

**Astro mode (dev server running):**
```
ViteClassWriter → iframe → Vite HMR WebSocket → plugin writes file
```

**VS Code extension mode:**
```
ClassStore → postMessageToExtension() → VS Code API writes file
```

## Key Files

| Step | File |
|------|------|
| Class change handler | `DesignBar.tsx` line 356 |
| Dispatch command | `ClassStoreContext.tsx` line 366 |
| Yjs command | `commands.ts` line 347 |
| Observer sync | `ClassStoreContext.tsx` line 218 |
| Forward to iframe | `ViewportFrame.tsx` line 655 |
| DOM update | `bridge.js` line 424 |
| File write client | `ViteClassWriter.ts` line 86 |
| Vite plugin handler | `vite-plugin/index.ts` line 111 |
| AST update | `ast-updater.ts` line 16 |

## Important Notes

**5-second debounce:** File writes are debounced to prevent thrashing during rapid edits. DOM updates are immediate.

**Component instances:** When a class changes, ALL instances of the same component (same `data-sq-source`) are updated together.

**Column drift:** After file writes, column numbers may shift. Lookups use file:line primarily, with column as secondary.

**HMR suppression:** After writing, HMR is suppressed for 5 seconds to prevent unnecessary reloads.

## Debugging

```typescript
// ClassStoreContext.tsx - on class change
console.log('[ClassStore] setClasses:', key, classes);

// ViewportFrame.tsx - forwarding to iframe
console.log('[ViewportFrame] SYNC_CLASSES_TO_IFRAME:', payload.key, payload.classes);

// bridge.js - DOM update
console.log('[IFrameBridge] UPDATE_CLASSES:', payload.key, '→', payload.classes);

// ViteClassWriter.ts - file write
console.log('[ViteClassWriter] writeClassUpdate:', sourceLocation, newClasses);

// vite-plugin/index.ts - writing
console.log('[sq-source] Wrote class update to:', filePath);
```
