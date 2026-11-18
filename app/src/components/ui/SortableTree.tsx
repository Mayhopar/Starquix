/**
 * Sortable tree primitives for Row-based trees (moved from components/common).
 *
 * Provides:
 *  - SortableTreeProvider  – DndContext + move logic for a tree of items
 *  - useTreeNodeDnd        – hook for making a node sortable with drop indicators
 *  - TreeDropIndicator     – visual drop line
 *  - ROW_HEIGHT / getDropZone / useTreePointerY – utilities
 *
 * Row wires these automatically via its `dnd` prop; use the hook directly only
 * for non-Row draggables.
 */

import { useCallback, useContext, useState, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { useDndContext } from '@dnd-kit/core';
import { stableContext } from '@/utils/stableContext';

// ── Constants ──────────────────────────────────────────────────────────

export const ROW_HEIGHT = 28;

// ── Drop zone helpers ──────────────────────────────────────────────────

export type DropZone = 'above' | 'inside' | 'below';

export function getDropZone(pointerY: number, targetRect: { top: number }): DropZone {
  const relativeY = pointerY - targetRect.top;
  const percentage = relativeY / ROW_HEIGHT;
  if (percentage < 0.3) return 'above';
  if (percentage > 0.7) return 'below';
  return 'inside';
}

// ── Pointer Y context ──────────────────────────────────────────────────

const PointerYContext = stableContext<number>('PointerYContext', 0);

export function useTreePointerY(): number {
  return useContext(PointerYContext);
}

// ── Tree item interface ────────────────────────────────────────────────

export interface TreeItemBase {
  id: string;
  children: string[];
}

// ── SortableTreeProvider ───────────────────────────────────────────────

/** Handlers for a drag whose type is NOT this tree's `dragType` — lets a tree
 *  rendered inside this provider's DndContext (e.g. the master-editor's nested
 *  ElementsTree) handle its own drags instead of having them silently swallowed. */
export interface ForeignDragHandlers {
  onDragStart?: (event: DragStartEvent) => void;
  onDragMove?: (event: DragMoveEvent) => void;
  onDragEnd?: (event: DragEndEvent) => void;
  onDragCancel?: () => void;
}

interface SortableTreeProviderProps<T extends TreeItemBase> {
  items: T[];
  rootIds: string[];
  dragType: string;
  onMove: (itemId: string, newParentId: string | null, insertIndex: number) => void;
  /** Delegate drags of a different type to these handlers (default: ignored). */
  foreignDrag?: ForeignDragHandlers;
  children: ReactNode;
}

export function SortableTreeProvider<T extends TreeItemBase>({
  items,
  rootIds,
  dragType,
  onMove,
  foreignDrag,
  children,
}: SortableTreeProviderProps<T>) {
  const [pointerY, setPointerY] = useState(0);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    if (event.active.data.current?.type !== dragType) {
      foreignDrag?.onDragStart?.(event);
    }
  }, [dragType, foreignDrag]);

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    if (event.active.data.current?.type !== dragType) {
      foreignDrag?.onDragMove?.(event);
      return;
    }
    const activatorEvent = event.activatorEvent as PointerEvent;
    setPointerY(activatorEvent.clientY + (event.delta?.y ?? 0));
  }, [dragType, foreignDrag]);

  const handleDragCancel = useCallback(() => {
    foreignDrag?.onDragCancel?.();
  }, [foreignDrag]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      // Foreign drag (e.g. element rows of a nested ElementsTree) → delegate.
      if (active.data.current?.type !== dragType) {
        foreignDrag?.onDragEnd?.(event);
        return;
      }
      if (!over || active.id === over.id) return;

      const draggedId = String(active.id);
      const targetId = String(over.id);
      if (draggedId === targetId) return;

      // Check circular nesting
      const isDescendant = (parentId: string, childId: string): boolean => {
        const parent = items.find(p => p.id === parentId);
        if (!parent) return false;
        if (parent.children.includes(childId)) return true;
        return parent.children.some(cid => isDescendant(cid, childId));
      };

      // Find parent of an item
      const findParentId = (itemId: string): string | null => {
        if (rootIds.includes(itemId)) return null;
        for (const item of items) {
          if (item.children.includes(itemId)) return item.id;
        }
        return null;
      };

      const targetItem = items.find(p => p.id === targetId);
      if (!targetItem) return;

      const dropZone = over.rect ? getDropZone(pointerY, over.rect) : 'inside';

      if (dropZone === 'inside') {
        // Nest: make dragged item a child of target
        if (isDescendant(draggedId, targetId)) return;
        if (targetItem.children.includes(draggedId)) return;
        onMove(draggedId, targetId, targetItem.children.length);
      } else {
        // Reorder: place above or below target
        const targetParentId = findParentId(targetId);
        const targetSiblings =
          targetParentId === null
            ? rootIds
            : items.find(p => p.id === targetParentId)?.children || [];
        const targetIndex = targetSiblings.indexOf(targetId);

        const draggedParentId = findParentId(draggedId);
        const draggedIndex = targetSiblings.indexOf(draggedId);
        const sameParent = targetParentId === draggedParentId;

        let newIndex: number;
        if (dropZone === 'above') {
          newIndex = targetIndex;
        } else {
          newIndex = targetIndex + 1;
          if (sameParent && draggedIndex < targetIndex) {
            newIndex = targetIndex;
          }
        }

        if (targetParentId !== null && isDescendant(draggedId, targetParentId)) return;

        onMove(draggedId, targetParentId, newIndex);
      }
    },
    [items, rootIds, dragType, onMove, pointerY, foreignDrag],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <PointerYContext.Provider value={pointerY}>
        {children}
      </PointerYContext.Provider>
      <DragOverlay dropAnimation={null} />
    </DndContext>
  );
}

// ── useTreeNodeDnd hook ────────────────────────────────────────────────

export function useTreeNodeDnd(id: string, dragType: string, disabled?: boolean) {
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({
    id,
    disabled,
    animateLayoutChanges: () => false,
    data: { type: dragType },
  });

  const { active, over } = useDndContext();
  const pointerY = useTreePointerY();

  const isBeingDraggedOver = over?.id === id && active?.id !== id;
  const isDragActive = active?.data.current?.type === dragType;

  const dropZone: DropZone | null =
    isDragActive && isBeingDraggedOver && over?.rect
      ? getDropZone(pointerY, over.rect)
      : null;

  return { setNodeRef, attributes, listeners, isDragging, dropZone };
}

// ── TreeDropIndicator ──────────────────────────────────────────────────

export function TreeDropIndicator({ position }: { position: 'above' | 'below' }) {
  return (
    <div
      className="absolute left-0 right-0 h-0.5 bg-accent-strong rounded-full mx-2 pointer-events-none z-10 shadow-[0_0_4px_var(--color-accent-strong)]"
      style={{
        top: position === 'above' ? 0 : 'auto',
        bottom: position === 'below' ? 0 : 'auto',
      }}
    />
  );
}
