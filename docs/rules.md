# Rules & Anti-Patterns

Things to avoid when working on Starquix V2.

## Critical Rules

### Never duplicate existing functionality

Before adding any new function, hook, or utility:
1. Search the codebase for existing implementations
2. Check `src/core/`, `src/hooks/`, `src/utils/` for similar patterns
3. Extend existing code instead of creating parallel implementations

**Why:** Duplicate code diverges over time, causes bugs, and confuses developers.

### Always use commands pattern for Yjs mutations

```typescript
// BAD - direct mutation
const meta = doc.getMap('meta');
meta.set('selectedSourceKey', key);

// GOOD - use dispatch
dispatch({ type: 'SELECT_SOURCE_ELEMENT', sourceKey: key });
```

**Why:** Commands are tracked by undo system. Direct mutations break undo/redo.

### Always call takeSnapshot() BEFORE undoable actions

```typescript
// GOOD
takeSnapshot();
dispatch({ type: 'UPDATE_SOURCE_CLASSES', ... });

// BAD - snapshot after change captures wrong state
dispatch({ type: 'UPDATE_SOURCE_CLASSES', ... });
takeSnapshot();
```

**Why:** Snapshots capture state for undo. Wrong order = undo restores wrong state.

### Never mutate React state directly

```typescript
// BAD
state.elements.push(newElement);
setState(state);

// GOOD
setState(prev => [...prev, newElement]);
```

**Why:** React won't detect mutations. Use immutable updates.

### Always check for existing source location before file writes

```typescript
// GOOD
if (element?.sourceLocation) {
  viteClassWriter.writeClassUpdate(element.sourceLocation, classes);
}

// BAD - will crash
viteClassWriter.writeClassUpdate(element.sourceLocation, classes);
```

**Why:** Some elements (dynamic, slot children) don't have source locations.

## Bridge Communication Rules

### Always include timestamp in messages

```javascript
this.sendToParent({
  type: 'ELEMENT_CLICK',
  payload: { ... },
  timestamp: Date.now()  // Required
});
```

### Use both data-element-key AND data-sq-source for lookups

```javascript
// In bridge.js
var key = element.getAttribute('data-element-key') ||
          element.getAttribute('data-sq-source');
```

**Why:** Different elements have different attributes. Check both.

### Don't assume iframe is ready

```typescript
// GOOD
if (iframeRef.current?.contentWindow) {
  iframe.contentWindow.postMessage(...);
}

// BAD - may be null during initialization
iframeRef.current.contentWindow.postMessage(...);
```

## Class Management Rules

### Never parse classes without handling empty strings

```typescript
// GOOD
const tokens = (classes || '').split(/\s+/).filter(Boolean);

// BAD - crashes on undefined
const tokens = classes.split(/\s+/);
```

### Always get fresh classes from Yjs in handlers

```typescript
// In DesignBar handleClassesChange:
const freshClasses = getClassesFromYjs(key);  // Read from Yjs
const baseStorage = freshClasses ? parseClasses(freshClasses) : storageRef.current;

// Don't rely on React state - it may be stale
```

**Why:** React state can be stale. The Yjs doc is the live working copy; the project files are the truth (see `docs/architecture.md`).

## Testing Rules

### Co-locate tests with source

```
Component.tsx
Component.test.tsx  // Same directory
```

### Run tests before committing

```bash
npm test
```

### Use TDD for new features

Write test first, then implementation.

## File Structure Rules

### Don't create new directories without need

Use existing structure:
- `src/components/` - React components
- `src/context/` - React contexts
- `src/hooks/` - Custom hooks
- `src/core/` - Business logic
- `src/store/` - Yjs state management

### Don't create utility files for one-off functions

Put helper functions in the file that uses them, unless shared.

## Performance Rules

### Don't observe entire Yjs document

```typescript
// BAD - fires on every change
doc.on('update', handler);

// GOOD - observe specific map
doc.getMap('sourceClasses').observeDeep(handler);
```

### Use refs for values needed in callbacks

```typescript
// GOOD - ref doesn't cause re-renders
const scannedElementsRef = useRef(scannedElements);
scannedElementsRef.current = scannedElements;

// In callback:
const element = scannedElementsRef.current.find(...);
```

---

## Add Your Rules Here

<!-- When you discover a new rule or anti-pattern, add it here -->
