import type { MessageHandler } from './context';
import { handleBgImagePreview, handleImagePreviewRefresh } from './previews';
import {
  handleElementHover,
  handleElementHoverEnd,
  handleAltKey,
  handleElementHovered,
  handleElementRect,
  handleElementRectResponse,
  handleAIActiveRects,
  handleAIPreviewRect,
  handleRectUpdated,
  handleRectsUpdated,
} from './hoverAndRects';
import { handleGridGeometryResponse } from './grid';
import {
  handleEditModeExited,
  handleTextSelectionChanged,
  handleMarkupChanged,
  handleKeyboardEvent,
} from './textEditing';
import {
  handleWheel,
  handleDragElementExitIframe,
  handleDragElementDrop,
  handleDragModeChanged,
} from './dragAndDrop';
import {
  handleReady,
  handleIframeReady,
  handleAssetsOwned,
  handleContentHeight,
  handlePageChanged,
} from './lifecycle';
import { handleElementsScanned } from './scanning';
import {
  handleElementClick,
  handleElementClicked,
  handleSlotPlaceholderClick,
} from './selection';
import { handlePreviewNavigate } from './previewNavigation';
import { handleCanvasFileDrop } from './mediaDrop';
import { handleTextDraft } from './textDrafts';
import { handleSourceChanged, handleSourceError, handleSourceOk } from './sourceStatus';

/** Built once; modules register their handlers here as they are extracted. */
export function buildMessageHandlers(): Record<string, MessageHandler> {
  return {
    BG_IMAGE_PREVIEW: handleBgImagePreview as MessageHandler,
    IMAGE_PREVIEW_REFRESH: handleImagePreviewRefresh as MessageHandler,
    ELEMENT_HOVER: handleElementHover as MessageHandler,
    ELEMENT_HOVER_END: handleElementHoverEnd as MessageHandler,
    ALT_KEY: handleAltKey as MessageHandler,
    ELEMENT_HOVERED: handleElementHovered as MessageHandler,
    ELEMENT_RECT: handleElementRect as MessageHandler,
    ELEMENT_RECT_RESPONSE: handleElementRectResponse as MessageHandler,
    AI_ACTIVE_RECTS: handleAIActiveRects as MessageHandler,
    AI_PREVIEW_RECT: handleAIPreviewRect as MessageHandler,
    RECT_UPDATED: handleRectUpdated as MessageHandler,
    RECTS_UPDATED: handleRectsUpdated as MessageHandler,
    GRID_GEOMETRY_RESPONSE: handleGridGeometryResponse as MessageHandler,
    EDIT_MODE_EXITED: handleEditModeExited as MessageHandler,
    TEXT_SELECTION_CHANGED: handleTextSelectionChanged as MessageHandler,
    MARKUP_CHANGED: handleMarkupChanged as MessageHandler,
    KEYBOARD_EVENT: handleKeyboardEvent as MessageHandler,
    WHEEL: handleWheel as MessageHandler,
    DRAG_ELEMENT_EXIT_IFRAME: handleDragElementExitIframe as MessageHandler,
    DRAG_ELEMENT_DROP: handleDragElementDrop as MessageHandler,
    DRAG_MODE_CHANGED: handleDragModeChanged as MessageHandler,
    READY: handleReady as MessageHandler,
    IFRAME_READY: handleIframeReady as MessageHandler,
    ASSETS_OWNED: handleAssetsOwned as MessageHandler,
    CONTENT_HEIGHT: handleContentHeight as MessageHandler,
    PAGE_CHANGED: handlePageChanged as MessageHandler,
    ELEMENTS_SCANNED: handleElementsScanned as MessageHandler,
    ELEMENT_CLICK: handleElementClick as MessageHandler,
    ELEMENT_CLICKED: handleElementClicked as MessageHandler,
    SLOT_PLACEHOLDER_CLICK: handleSlotPlaceholderClick as MessageHandler,
    PREVIEW_NAVIGATE: handlePreviewNavigate as MessageHandler,
    CANVAS_FILE_DROP: handleCanvasFileDrop as MessageHandler,
    TEXT_DRAFT: handleTextDraft as MessageHandler,
    SOURCE_ERROR: handleSourceError as MessageHandler,
    SOURCE_OK: handleSourceOk as MessageHandler,
    SOURCE_CHANGED: handleSourceChanged as MessageHandler,
  };
}
