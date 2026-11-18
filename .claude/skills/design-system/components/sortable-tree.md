# SortableTree — dnd wiring for Row trees

`import { SortableTreeProvider, useTreeNodeDnd, TreeDropIndicator, ROW_HEIGHT } from '@/components/ui'`
(moved from `components/common/SortableTree`)

## Standard usage — Row does the wiring
```tsx
<SortableTreeProvider items={items} rootIds={rootIds} dragType="page"
                      onMove={(id, newParentId, index) => …}
                      foreignDrag={handlers /* for nested trees */}>
  {rows.map(r => <Row key={r.id} dnd={{id: r.id, dragType: 'page'}} depth={r.depth} … />)}
</SortableTreeProvider>
```
- Drop zones: above/below (30%/70% of 28px row) → `TreeDropIndicator` line
  (`bg-accent-strong`); inside → nest (row highlights `bg-info-subtle`).
- Dragged row dims to 40% opacity.
- `foreignDrag` delegates drags of another `dragType` — REQUIRED when a tree
  renders inside another tree's DndContext (nested DndContext swallows drags).
- Trees with CUSTOM drop logic (ElementsTree, PageTreeNode) keep their own
  `useTreeNodeDnd` wiring and pass listeners via Row `rowProps` instead of `dnd`.

## Direct hook (non-Row draggables only)
`useTreeNodeDnd(id, dragType, disabled)` → `{setNodeRef, attributes, listeners, isDragging, dropZone}`.
`disabled` is `boolean | { draggable?, droppable? }` (dnd-kit's own shape). Virtual folders:
`{ draggable: true }` — a drop target that cannot move.
