import { describe, it, expect } from 'vitest';
import { buildMessageHandlers } from '../registry';

describe('viewport message registry', () => {
  it('returns a handler map', () => {
    expect(typeof buildMessageHandlers()).toBe('object');
  });

  it('covers exactly the registered bridge message types (kept in sync with registry.ts)', () => {
    expect(Object.keys(buildMessageHandlers()).sort()).toEqual([
      'AI_ACTIVE_RECTS',
      'AI_PREVIEW_RECT',
      'ASSETS_OWNED',
      'BG_IMAGE_PREVIEW',
      'CANVAS_FILE_DROP',
      'CONTENT_HEIGHT',
      'DRAG_ELEMENT_DROP',
      'DRAG_ELEMENT_EXIT_IFRAME',
      'DRAG_MODE_CHANGED',
      'EDIT_MODE_EXITED',
      'ELEMENTS_SCANNED',
      'ELEMENT_CLICK',
      'ELEMENT_CLICKED',
      'ELEMENT_HOVER',
      'ELEMENT_HOVERED',
      'ELEMENT_HOVER_END',
      'ELEMENT_RECT',
      'ELEMENT_RECT_RESPONSE',
      'FONT_FAMILIES',
      'GRID_GEOMETRY_RESPONSE',
      'IFRAME_READY',
      'IMAGE_PREVIEW_REFRESH',
      'KEYBOARD_EVENT',
      'MARKUP_CHANGED',
      'PAGE_CHANGED',
      'PREVIEW_NAVIGATE',
      'READY',
      'RECTS_UPDATED',
      'RECT_UPDATED',
      'SLOT_PLACEHOLDER_CLICK',
      'SOURCE_CHANGED',
      'SOURCE_ERROR',
      'SOURCE_OK',
      'TEXT_DRAFT',
      'TEXT_SELECTION_CHANGED',
      'WHEEL',
    ]);
  });

  it('every handler is a function', () => {
    for (const [, handler] of Object.entries(buildMessageHandlers())) {
      expect(typeof handler).toBe('function');
    }
  });
});
