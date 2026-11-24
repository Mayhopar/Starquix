# Architecture Decisions

Why we made certain choices in Starquix V2.

## Why Yjs for State Management?

**Decision:** Use a Yjs CRDT document as the session working copy. The project files stay the source of truth: the doc is rebuilt from them on every open.

**Reasons:**
- **Unified undo/redo** - All operations (classes, text, pages) can be tracked together
- **Future collaborative editing** - CRDTs handle concurrent edits naturally
- **Reactive updates** - Yjs observers trigger React re-renders automatically

**Trade-off:** More complex than plain React state, but pays off for undo and future features.

## Why Source Keys (file:line:column)?

**Decision:** Identify elements by their location in source files, not generated IDs.

**Reasons:**
- **Direct source editing** - Can write changes back to exact file location
- **Survives HMR** - Elements keep same identity after hot reload
- **No ID generation** - Don't need to inject IDs into user's code
- **Component instances** - Same source location = same component, update all together

**Trade-off:** Column numbers can drift after edits. We use file:line as primary lookup.

## Why 6 Breakpoint Viewports?

**Decision:** Show all Tailwind breakpoints (base, sm, md, lg, xl, 2xl) simultaneously.

**Reasons:**
- **See responsive design at once** - No switching between viewport sizes
- **Immediate feedback** - Changes show on all breakpoints instantly
- **Tailwind alignment** - Matches Tailwind's responsive system exactly

**Trade-off:** More iframes = more memory. Worth it for the workflow.

## Why Custom Undo Instead of Y.UndoManager?

**Decision:** Use snapshot-based undo instead of Yjs's built-in UndoManager.

**Reasons:**
- **Full-state snapshots** - Capture classes + text + pages together
- **Logical grouping** - One "class change" = one undo step (not individual Y.Map operations)
- **Page operations** - Create/delete/rename pages are undoable
- **File write timing** - Can write files differently during undo vs normal edits

**Trade-off:** More code than using Y.UndoManager, but needed for our use case.

## Why postMessage for Iframe Communication?

**Decision:** Use window.postMessage for React app ↔ Astro iframe communication.

**Reasons:**
- **Cross-origin safe** - Works even if preview is on different port
- **No shared state** - Clean separation between editor and preview
- **Simple protocol** - Just JSON messages with type/payload

**Trade-off:** Async only, can't do synchronous DOM reads. We work around this.

## Why Vite Plugin for File Writes?

**Decision:** Write to files via Vite's dev server WebSocket, not direct filesystem access.

**Reasons:**
- **Browser can't write files** - Web apps don't have filesystem access
- **HMR integration** - Can suppress HMR reloads after our writes
- **Same dev server** - Reuse existing Astro/Vite infrastructure

**Trade-off:** More hops (React → iframe → Vite plugin → file), but necessary.

## Why Tailwind 4.1?

**Decision:** Use Tailwind CSS v4 for styling.

**Reasons:**
- **CSS-first config** - No tailwind.config.js needed
- **Faster builds** - New oxide engine
- **Modern CSS** - Uses CSS variables, cascade layers

**Note:** Some v3 patterns don't work. Check Tailwind v4 docs.

## Why Debounce File Writes (5 seconds)?

**Decision:** Buffer class changes for 5 seconds before writing to file.

**Reasons:**
- **Prevent file thrashing** - Rapid edits don't write 10x per second
- **Better HMR** - Fewer file changes = fewer reload triggers
- **Immediate DOM feedback** - User sees changes instantly in iframe

**Trade-off:** If app crashes, last 5 seconds of changes may be lost.

## Why React 19?

**Decision:** Use React 19 (latest stable).

**Reasons:**
- **Compiler ready** - Prepared for React Compiler
- **Improved Suspense** - Better async patterns
- **Modern hooks** - Latest hook patterns

---

## Questions for Future Decisions

<!-- Add decisions as they come up -->

- Why no collaborative editing yet?
- Why not use Astro's Content Collections?
