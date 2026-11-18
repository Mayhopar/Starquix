// src/types/drag.ts
/**
 * Drag-and-drop type constants and utilities.
 * Single source of truth for drag system identification.
 */

export const DRAG_TYPES = {
  GUTTER_HANDLE: 'gutter-handle',
  LAYERS_PANEL: 'layers-panel',
  PAGES_PANEL: 'pages-panel',
  ASSETS_PANEL: 'assets-panel',
} as const;

export type DragType = (typeof DRAG_TYPES)[keyof typeof DRAG_TYPES];

/**
 * Gutter drag IDs are prefixed to distinguish from layers panel drags.
 * Format: "gutter:{elementKey}"
 */
export const GutterId = {
  PREFIX: 'gutter:',

  create(elementKey: string): string {
    return `${this.PREFIX}${elementKey}`;
  },

  parse(id: string): string | null {
    return this.isGutter(id) ? id.slice(this.PREFIX.length) : null;
  },

  isGutter(id: string): boolean {
    return id.startsWith(this.PREFIX);
  },
} as const;
