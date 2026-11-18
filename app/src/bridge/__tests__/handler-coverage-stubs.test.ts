/**
 * Test-coverage stubs (bridge handlers).
 *
 * Each `it.todo(...)` below references an `IFrameBridge.prototype.handleX`
 * defined in `src/bridge/parts/*.ts` that does not yet have a real
 * test. The names are present here so that
 * `scripts/lint-test-coverage.mjs` passes — and so the gaps remain
 * tracked. Replace any of these with a real `it(...)` when you write
 * the test, ideally using the harness at
 * `src/bridge/parts/__tests__/harness.ts`.
 *
 * RULE (CLAUDE.md "Bug → regression test"): when adding a new
 * `IFrameBridge.prototype.handleX`, either add a real test or move its
 * `it.todo` here.
 */
import { describe, it } from 'vitest';

describe('bridge handler coverage stubs (todo)', () => {
  it.todo('handleCaptureScreenshot');
  it.todo('handleClick');
  it.todo('handleDrillDown');
  it.todo('handleGetElementSectionHtml');
  it.todo('handleHighlightElement');
  it.todo('handleInsertDrawnElement');
  it.todo('handleKeyDown');
  it.todo('handleMessage');
  it.todo('handleMouseDown');
  it.todo('handleMouseLeave');
  it.todo('handleMouseMove');
  it.todo('handleMouseUp');
  it.todo('handleNativeClick');
  it.todo('handleNavigation');
  it.todo('handlePickElementAtPoint');
  it.todo('handleRemoveDrawnElement');
  it.todo('handleRemoveElementFromDOM');
  it.todo('handleRenderCollection');
  it.todo('handleReparentElementDom');
  it.todo('handleRequestElementRect');
  it.todo('handleRequestGridGeometry');
  it.todo('handleRequestPreviewRefresh');
  it.todo('handleSetAIActiveHighlights');
  it.todo('handleSetElementStyle');
  it.todo('handleSetVariablesCSS');
  it.todo('handleSimulateClick');
  it.todo('handleUnwrapLink');
  it.todo('handleUpdateImageAttribute');
  it.todo('handleUpdateSlotPlaceholder');
  it.todo('handleWheel');
  it.todo('handleWrapSelectionInLink');
  it.todo('handleWriteImage');
  it.todo('handleWriteText');
});
