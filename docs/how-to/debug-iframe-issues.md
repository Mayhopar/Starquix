# How to Debug Iframe Issues

Troubleshooting guide for cross-iframe communication problems.

## Quick Diagnosis

| Symptom | Likely Cause | Jump To |
|---------|--------------|---------|
| Click does nothing | Message not sent or received | [Message Flow](#check-message-flow) |
| Element not found | Key mismatch or scan timing | [Element Lookup](#element-lookup-failures) |
| Classes not updating | DOM update failed | [Class Updates](#class-updates-not-working) |
| Text edit broken | contentEditable issue | [Text Editing](#text-editing-issues) |
| Selection overlay wrong | Rect calculation issue | [Selection Rect](#selection-rect-issues) |

## Architecture Quick Reference

```
Editor (localhost:3061)
    ↓ postMessage
ViewportFrame.tsx
    ↓ postMessage
Astro iframe (the project's dev server port)
    ↓ handled by
bridge.js (injected script)
```

## Check Message Flow

### Step 1: Is the message being sent?

**In bridge.js** (iframe side):
```javascript
// Add at start of sendToParent():
console.log('[Bridge→Parent]', message.type, message.payload);
```

**In ViewportFrame.tsx** (parent side):
```typescript
// Add in message handler:
console.log('[Parent←Bridge]', event.data.type, event.data.payload);
```

### Step 2: Is the message being received?

**Check iframe is ready:**
```typescript
// ViewportFrame.tsx
console.log('isAstroReadyRef:', isAstroReadyRef.current);
```

If `false`, iframe hasn't sent `IFRAME_READY` yet.

### Step 3: Is the handler registered?

Messages are handled in `ViewportFrame.tsx` in the `useEffect` with message listener:

```typescript
useEffect(() => {
  const handleMessage = (event: MessageEvent) => {
    // Check origin
    if (!event.origin.includes('localhost')) return;

    switch (event.data.type) {
      case 'ELEMENT_CLICK':
        // Handler here
        break;
      // ...
    }
  };

  window.addEventListener('message', handleMessage);
  return () => window.removeEventListener('message', handleMessage);
}, [/* deps */]);
```

**Common issue:** Missing case in switch statement.

## Element Lookup Failures

### Symptom: "Element not found" in logs

**Check 1: Does element have the right attribute?**

In browser DevTools on iframe:
```javascript
// Check for data-element-key
document.querySelector('[data-element-key="your-key"]')

// Check for data-sq-source
document.querySelector('[data-sq-source="src/components/Hero.astro:5:1"]')
```

**Check 2: Has element scan completed?**

```javascript
// In bridge.js handleMessage
case 'ELEMENTS_SCANNED':
  console.log('Scanned elements:', payload.elements.length);
```

If 0, elements haven't been scanned yet.

**Check 3: Key format mismatch**

Bridge.js tries multiple lookup methods:

```javascript
IFrameBridge.prototype.findElementByKey = function(key) {
  // Try 1: data-element-key exact match
  var el = document.querySelector('[data-element-key="' + key + '"]');
  if (el) return el;

  // Try 2: data-sq-source exact match
  el = document.querySelector('[data-sq-source="' + key + '"]');
  if (el) return el;

  // Try 3: Parse and fuzzy match by file:line
  // ...
};
```

**Common issue:** Key has instance suffix (`#1`, `#2`) but lookup doesn't.

### Fix: Add logging to findElementByKey

```javascript
IFrameBridge.prototype.findElementByKey = function(key) {
  console.log('[Bridge] findElementByKey:', key);

  var el = document.querySelector('[data-element-key="' + key + '"]');
  console.log('[Bridge] data-element-key match:', el ? 'found' : 'not found');

  // ... continue with other methods
};
```

## Class Updates Not Working

### Symptom: Class changes in UI but not in iframe DOM

**Check 1: Is UPDATE_CLASSES message received?**

```javascript
// In bridge.js handleUpdateClasses
console.log('[Bridge] UPDATE_CLASSES received:', payload.key, payload.classes);
```

**Check 2: Is element found?**

```javascript
var targetElement = this.findElementByKey(payload.key);
console.log('[Bridge] Target element:', targetElement ? targetElement.tagName : 'NOT FOUND');
```

**Check 3: Is className actually changing?**

```javascript
console.log('[Bridge] Before:', targetElement.className);
targetElement.className = payload.classes;
console.log('[Bridge] After:', targetElement.className);
```

**Check 4: Browser repaint happening?**

```javascript
// Force repaint
targetElement.style.transform = 'translateZ(0)';
void targetElement.offsetWidth;  // Force synchronous layout
targetElement.style.transform = '';
```

### Symptom: Class changes in iframe but not written to file

**Check 1: Is ViteClassWriter available?**

```typescript
console.log('ViteClassWriter available:', viteClassWriter.isAvailable());
```

If `false`, Astro dev server isn't running.

**Check 2: Is iframe ref set?**

```typescript
// After IFRAME_READY:
viteClassWriter.setIframeRef(iframeRef.current);
console.log('Iframe ref set:', !!iframeRef.current);
```

**Check 3: Is write request sent?**

```typescript
// ViteClassWriter.ts
console.log('[ViteClassWriter] Sending SQ_WRITE_CLASSES:', sourceLocation);
```

**Check 4: Is Vite plugin receiving?**

```typescript
// vite-plugin/index.ts
server.ws.on('sq:write-classes', (data) => {
  console.log('[Vite] Received sq:write-classes:', data.sourceLocation);
});
```

## Text Editing Issues

### Symptom: Double-click doesn't enter edit mode

**Check 1: Is double-click detected?**

```typescript
// ViewportFrame.tsx ELEMENT_CLICK handler
console.log('isDoubleClick:', payload.isDoubleClick);
console.log('selectedKey:', selectedKey);
console.log('hasChildren:', payload.hasChildren);
console.log('isEditingText:', isEditingText);
```

Double-click enters edit mode only if:
- `isDoubleClick === true`
- `payload.key === selectedKey` (already selected)
- `!hasChildren` (text element, not container)
- `!isEditingText` (not already editing)

**Check 2: Is ENTER_EDIT_MODE sent?**

```typescript
console.log('Sending ENTER_EDIT_MODE for:', payload.key);
iframeRef.current.contentWindow.postMessage({
  type: 'ENTER_EDIT_MODE',
  payload: { key: payload.key }
}, '*');
```

**Check 3: Is contentEditable set?**

```javascript
// In bridge.js ENTER_EDIT_MODE handler
console.log('[Bridge] Setting contentEditable on:', element.tagName);
element.contentEditable = 'true';
console.log('[Bridge] contentEditable:', element.contentEditable);
```

### Symptom: Text not saving after edit

**Check 1: Is EDIT_MODE_EXITED sent?**

```javascript
// In bridge.js blur handler
console.log('[Bridge] EDIT_MODE_EXITED:', { key, textContent, originalText });
```

**Check 2: Did text actually change?**

```typescript
// ViewportFrame.tsx
if (payload.textContent !== payload.originalText) {
  console.log('Text changed, saving...');
} else {
  console.log('Text unchanged, skipping save');
}
```

**Check 3: Is source location found?**

```typescript
const element = scannedElements.find(el => el.key === payload.key);
console.log('Found element:', element);
console.log('Source location:', element?.sourceLocation);
```

## Selection Rect Issues

### Symptom: Selection overlay in wrong position

**Check 1: Is rect being sent?**

```javascript
// In bridge.js ELEMENT_CLICK
var rect = target.getBoundingClientRect();
console.log('[Bridge] Sending rect:', rect);
```

**Check 2: Is iframe scroll accounted for?**

The rect is relative to iframe viewport. Parent needs to add iframe offset:

```typescript
// ViewportFrame.tsx
const iframeRect = iframeRef.current.getBoundingClientRect();
const absoluteRect = {
  top: payload.rect.top + iframeRect.top,
  left: payload.rect.left + iframeRect.left,
  // ...
};
```

**Check 3: Is RECT_UPDATED being sent after changes?**

```javascript
// In bridge.js handleUpdateClasses
requestAnimationFrame(function() {
  var rect = el.getBoundingClientRect();
  self.sendToParent({
    type: 'RECT_UPDATED',
    payload: { key: payload.key, rect: rect }
  });
});
```

## Debug Logging Checklist

Add these logs systematically:

### bridge.js
```javascript
// At top of file
var DEBUG = true;
function log(...args) { if (DEBUG) console.log('[Bridge]', ...args); }

// In sendToParent
log('→', message.type, message.payload?.key || '');

// In handleMessage
log('←', message.type, message.payload?.key || '');

// In findElementByKey
log('findElementByKey:', key, '→', result ? 'found' : 'NOT FOUND');

// In handleUpdateClasses
log('UPDATE_CLASSES:', payload.key, '→', payload.classes?.slice(0, 50));
```

### ViewportFrame.tsx
```typescript
// In message handler
console.log('[ViewportFrame] ←', event.data.type, event.data.payload?.key);

// In dispatches
console.log('[ViewportFrame] dispatch:', command.type);

// In postMessage sends
console.log('[ViewportFrame] →', message.type, message.payload?.key);
```

## Common Causes Summary

| Issue | Common Cause | Fix |
|-------|--------------|-----|
| Message not received | Wrong origin check | Check `event.origin` includes correct port |
| Element not found | Key mismatch | Log keys on both sides, check for `#1` suffix |
| Class not updating | Missing slot pattern | Add to `isTokenForSlot()` |
| File not written | Astro not running | Start `npm run dev` in preview-template |
| Edit mode stuck | Blur handler removed | Check for JS errors in iframe |
| Rect wrong | Iframe scroll offset | Account for iframe position |

## Nuclear Option: Full Trace

When nothing works, add this to get full message trace:

```typescript
// In ViewportFrame.tsx
useEffect(() => {
  const trace = (e: MessageEvent) => {
    console.log('=== MESSAGE ===');
    console.log('Origin:', e.origin);
    console.log('Type:', e.data?.type);
    console.log('Payload:', JSON.stringify(e.data?.payload, null, 2));
    console.log('===============');
  };
  window.addEventListener('message', trace);
  return () => window.removeEventListener('message', trace);
}, []);
```

```javascript
// In bridge.js constructor
var self = this;
var originalPostMessage = window.parent.postMessage.bind(window.parent);
window.parent.postMessage = function(message, origin) {
  console.log('=== OUTGOING ===');
  console.log('Type:', message?.type);
  console.log('Payload:', JSON.stringify(message?.payload, null, 2));
  console.log('================');
  return originalPostMessage(message, origin);
};
```
