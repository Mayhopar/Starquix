# Text Editing Flow

How inline text editing works: enter edit mode → user types → exit → save to Yjs + source file.

## Overview

```
Enter edit mode (double-click / Enter key)
        ↓
bridge.js enables contentEditable + registers handlers
        ↓
User types (native browser editing)
        ↓
Exit (blur / Escape / click outside / window blur)
        ↓
bridge exitEditModeCleanup() → EDIT_MODE_EXITED message → React
        ↓
takeSnapshot() → Yjs update (instance or source) + file write via Vite plugin
```

## Step-by-Step

### 1. Enter edit mode

**File:** `app/src/components/Canvas/ViewportFrame.tsx`

Three entry paths, all converging on `sendEnterEditMode(key)` (~line 511):

```typescript
const sendEnterEditMode = useCallback((key: string) => {
  enterEditMode();
  iframeRef.current?.focus();  // Focus iframe BEFORE posting message
  iframeRef.current?.contentWindow?.postMessage({
    type: 'ENTER_EDIT_MODE',
    payload: { key }
  }, '*');
}, [enterEditMode]);
```

**Entry path A — Double-click** (~line 726): Double-click already-selected leaf element (no children, not already editing).

**Entry path B — Enter key from iframe** (~line 1032): Bridge sends KEYBOARD_EVENT with Enter key on a selected leaf element.

**Entry path C — Enter key from parent** (~line 570): `useKeyboardShortcuts` dispatches `sq:request-edit-mode` CustomEvent, ViewportFrame listens and calls `sendEnterEditMode`.

Note: `takeSnapshot()` is NOT called here. It's called later on exit, before the Yjs mutation.

### 2. Bridge enables contentEditable

**File:** `preview-template/public/scripts/bridge.js` (~line 1554)

```javascript
IFrameBridge.prototype.handleEnterEditMode = function(payload) {
  var key = payload && payload.key;
  var element = this.findElementByKey(key);
  if (!element || this.editingElement) return;

  // Setup state
  this._editGraceUntil = Date.now() + 300;  // Grace period for stray clicks
  this.editingElement = element;
  this.originalTextContent = element.textContent;
  if (key && !this.originalTextByKey[key]) {
    this.originalTextByKey[key] = element.textContent;
  }
  element.contentEditable = 'true';

  // Registers: selectionchange (for link editing), input (content height + rect),
  // blur (200ms delay + activeElement check), window blur (300ms + hasFocus check)
  // ... handler setup ...

  // Focus and select all text
  element.focus();
  var range = document.createRange();
  range.selectNodeContents(element);
  var sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
};
```

### 3. User types

Native browser contentEditable handles all text editing:
- Typing, backspace, delete
- Arrow key navigation
- Cut/copy/paste
- Selection (reported to parent via TEXT_SELECTION_CHANGED for link editing)

### 4. Exit edit mode

Four exit paths, all converging on `exitEditModeCleanup()` (~line 974):

**A) Blur** (~line 1607): 200ms delay + `document.activeElement !== element` check. Tolerates transient blur during cross-frame focus settling.

**B) Escape key** (~line 3573): Immediate exit via `exitEditModeCleanup()`.

**C) Click outside** (~line 3764): `handleClick` detects click on non-editing element. Respects `_editGraceUntil` (300ms from enter) to avoid exits from stray clicks.

**D) Window blur** (~line 1618): 300ms delay + `document.hasFocus()` check. Skipped when `linkInteracting` is true (focus left iframe for LinkBlock editing).

### 5. exitEditModeCleanup sends EDIT_MODE_EXITED

**File:** `preview-template/public/scripts/bridge.js` (~line 974)

```javascript
IFrameBridge.prototype.exitEditModeCleanup = function() {
  if (!this.editingElement) return;
  this._editGraceUntil = 0;
  var element = this.editingElement;
  var editKey = element.getAttribute('data-key') || element.getAttribute('data-sq-source');
  var newText = element.textContent;

  // Remove all event listeners (blur, selectionchange, input, window blur)
  // ... cleanup ...

  element.contentEditable = 'false';
  element.blur();
  window.getSelection().removeAllRanges();

  this.sendToParent({
    type: 'EDIT_MODE_EXITED',
    payload: { key: editKey, textContent: newText, originalText: this.originalTextContent }
  });

  this.editingElement = null;
  this.originalTextContent = null;
};
```

### 6. React receives EDIT_MODE_EXITED

**File:** `app/src/components/Canvas/ViewportFrame.tsx` (~line 822)

```typescript
case 'EDIT_MODE_EXITED': {
  const payload = event.data.payload as EditModeExitedPayload;
  exitEditMode();
  clearTextSelection();

  if (payload.textContent !== payload.originalText) {
    takeSnapshot();  // Snapshot taken HERE, before Yjs mutation
    const parsed = parseSourceKey(payload.key);

    if (parsed.type === 'instance') {
      dispatch({
        type: 'UPDATE_INSTANCE_OVERRIDE',
        instanceId: parsed.instanceId,
        childId: parsed.childId,
        updates: { text: payload.textContent }
      });
    } else {
      // Source-tracked and drawn elements
      dispatch({
        type: 'UPDATE_SOURCE_TEXT',
        sourceKey: payload.key,
        textContent: payload.textContent,
        originalText: payload.originalText,
      });
    }

    // Persist to source file when available
    const element = scannedElements.find(el => el.key === payload.key);
    if (element?.sourceLocation) {
      viteTextWriter.writeTextUpdate(element.sourceLocation, payload.textContent);
    }
  }
}
```

### 7. ViteTextWriter sends write request

**File:** `app/src/services/ViteTextWriter.ts` (~line 87)

One path (since 2026-10-07): the edit becomes durable text commands accepted into the project journal (`acceptProjectEdit`), then materialized to the source file (`flushDurableSourceWritesThrough`).

### 8. Vite plugin writes file

**File:** `app/src/vite-plugin/index.ts` (~line 221)

```typescript
server.ws.on('sq:write-text', async (data) => {
  const { sourceLocation, newText, requestId } = data;
  const filePath = resolveFilePath(sourceLocation.file);

  await queueFileWrite(filePath, async () => {
    const content = await readFile(filePath, 'utf-8');
    const updated = await updateTextContent(content, filePath, sourceLocation, newText);
    suppressHmrFor(filePath);  // Suppress HMR to prevent reload jank
    await writeFile(filePath, updated, 'utf-8');
  });
});
```

### 9. AST-based text replacement

**File:** `app/src/vite-plugin/ast-updater.ts` (~line 285)

```typescript
export async function updateTextContent(content, filePath, location, newText) {
  // 1. Find opening bracket at line:column
  const bracket = findOpeningBracket(lines, lineIndex, colIndex);

  // 2. Extract tag name and find opening tag end
  const tagName = content.slice(startOffset).match(/^<([a-zA-Z][a-zA-Z0-9.-]*)/)[1];
  const openingTag = extractOpeningTag(content, startOffset);

  // 3. Find matching closing tag
  const closingTagStart = findClosingTagStart(content, openingTag.endOffset, tagName);

  // 4. Replace content between tags
  return content.slice(0, openingTag.endOffset) + newText + content.slice(closingTagStart);
}
```

## Undo Support

`takeSnapshot()` is called in the EDIT_MODE_EXITED handler (Step 6), BEFORE the Yjs mutation. This means the snapshot captures the state before the text change, making the edit undoable.

**File:** `app/src/context/UndoContext.tsx`

When user presses Cmd+Z:
1. `applySnapshot()` restores previous `sourceText` in Yjs
2. Observer in ViewportFrame detects sourceText change during undo (`isUndoingRef`)
3. Sends `UPDATE_TEXT` to iframe for live preview
4. Calls `viteTextWriter.writeTextUpdate()` to revert source file
5. For removed entries, sends `RESTORE_ORIGINAL_TEXT` to iframe

## Key Files

| Step | File | ~Line |
|------|------|-------|
| sendEnterEditMode helper | `ViewportFrame.tsx` | 511 |
| Double-click entry | `ViewportFrame.tsx` | 726 |
| Enter key entry (parent) | `ViewportFrame.tsx` | 570 |
| contentEditable enable | `bridge.js` | 1554 |
| exitEditModeCleanup | `bridge.js` | 974 |
| Escape key handling | `bridge.js` | 3573 |
| Click outside handling | `bridge.js` | 3764 |
| Window blur handling | `bridge.js` | 1618 |
| EDIT_MODE_EXITED handler | `ViewportFrame.tsx` | 822 |
| File write request | `ViteTextWriter.ts` | 87 |
| Vite WebSocket handler | `vite-plugin/index.ts` | 221 |
| AST text replacement | `ast-updater.ts` | 285 |
| Undo snapshot | `UndoContext.tsx` | 617 |

## Debugging

```javascript
// bridge.js - entering edit mode
console.log('[IFrameBridge] ENTER_EDIT_MODE for key:', key);

// bridge.js - exiting edit mode
console.log('[IFrameBridge] exitEditModeCleanup. Key:', editKey);

// ViewportFrame.tsx - receiving exit
console.log('[ViewportFrame] EDIT_MODE_EXITED received:', payload);

// ViteTextWriter.ts - sending write
console.log('[ViteTextWriter] Writing text update:', { sourceLocation, newText });

// vite-plugin/index.ts - writing file
console.log('[sq-source] Wrote text content to:', filePath);
```

## Common Issues

**Text not saving:**
- Check `scannedElements` has the element with `sourceLocation`
- Check ViteTextWriter has local project root or astro server URL set
- Check Vite plugin WebSocket handler is registered

**Edit mode not exiting:**
- Blur handler uses 200ms delay — may feel slow
- Window blur skipped when `linkInteracting` is true
- Grace period (300ms) prevents exits from stray clicks on enter
- Check for JS errors in iframe console

**Wrong element updated:**
- Source key mismatch — check `data-key` vs `data-sq-source`
- Column shift after previous edits — line numbers may have changed
- For instance children, `parseSourceKey()` splits key into instanceId + childId
