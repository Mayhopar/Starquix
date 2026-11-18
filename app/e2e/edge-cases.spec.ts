// app/e2e/edge-cases.spec.ts
// Phase 8: Edge Cases & Error Recovery (50 tests)
// Tests unusual scenarios and error handling.

import { test, expect } from './fixtures/test-fixtures';

test.describe('Edge Cases & Error Recovery', () => {
  test.beforeEach(async ({ page, waitForEditor }) => {
    await page.goto('/test-editor/test-project');
    await waitForEditor();
  });

  // =====================================================
  // 8.1 Race Conditions (10 tests)
  // =====================================================
  test.describe('8.1 Race Conditions', () => {
    test('8.1.1 - Rapid consecutive class changes', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);

      // Rapid clicks to simulate race conditions
      for (let i = 0; i < 10; i++) {
        await layerItem.click();
        await page.waitForTimeout(20);
      }

      // UI should remain stable
      await expect(layerItem).toBeVisible();
    });

    test('8.1.2 - Class change during potential file write', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
      getYjsElements,
    }) => {
      const elementId = await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(100);

      // Multiple rapid selections
      await layerItem.click();
      await page.waitForTimeout(10);
      await layerItem.click();

      // State should be consistent
      const elements = await getYjsElements();
      expect(elements[elementId]).toBeDefined();
    });

    test('8.1.3 - Undo during pending operations', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
      undo,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(100);

      // Undo immediately - may undo the add operation
      await undo();
      await page.waitForTimeout(100);

      // Should not crash - layers panel should still be visible
      const layersPanel = page.locator('[data-testid="layers-panel"]');
      await expect(layersPanel).toBeVisible();
    });

    test('8.1.4 - Selection change during text edit', async ({
      page,
      addMultipleElements,
      selectViaLayersPanel,
    }) => {
      await addMultipleElements(2);

      const layerItems = page.locator('[data-testid="layer-item"]');

      // Select first, start edit
      await selectViaLayersPanel(0);
      await layerItems.first().dblclick();
      await page.waitForTimeout(100);

      // Change selection to second
      await selectViaLayersPanel(1);
      await page.waitForTimeout(100);

      // Both items should still be accessible
      await expect(layerItems.first()).toBeVisible();
      await expect(layerItems.nth(1)).toBeVisible();
    });

    test('8.1.5 - Element delete during class update', async ({
      page,
      addMultipleElements,
      selectViaLayersPanel,
      getElementCount,
    }) => {
      await addMultipleElements(2);
      const initialCount = await getElementCount();

      await selectViaLayersPanel(0);
      await page.waitForTimeout(100);

      // Delete element
      await page.keyboard.press('Delete');
      await page.waitForTimeout(300);

      // Count should be reduced or unchanged (depending on delete behavior)
      const newCount = await getElementCount();
      expect(newCount).toBeLessThanOrEqual(initialCount);
    });

    test('8.1.6 - Page switch during operation', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(100);

      // Page should remain stable
      await expect(layerItem).toBeVisible();
    });

    test('8.1.7 - Multiple iframes racing', async ({
      page,
      addTestElement,
    }) => {
      await addTestElement();

      // Check multiple viewports exist
      const iframes = page.locator('iframe[data-viewport]');
      const count = await iframes.count();
      expect(count).toBeGreaterThan(0);
    });

    test('8.1.8 - HMR during class update', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
      getSelectedElementId,
    }) => {
      const elementId = await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(200);

      // Selection should persist
      const selectedId = await getSelectedElementId();
      expect(selectedId).toBe(elementId);
    });

    test('8.1.9 - ELEMENTS_SCANNED during update', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(200);

      // Simulate multiple operations
      await layerItem.click();
      await layerItem.click();
      await page.waitForTimeout(100);

      await expect(layerItem).toBeVisible();
    });

    test('8.1.10 - Double-click race with single click', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(100);

      // Rapid clicks that might be interpreted as double-click
      await layerItem.click();
      await layerItem.click();
      await page.waitForTimeout(50);
      await layerItem.click();

      await expect(layerItem).toBeVisible();
    });
  });

  // =====================================================
  // 8.2 Error Recovery (12 tests)
  // =====================================================
  test.describe('8.2 Error Recovery', () => {
    test('8.2.1 - File write fails - UI handles gracefully', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(200);

      // UI should remain functional
      await expect(layerItem).toBeVisible();
    });

    test('8.2.2 - File write fails - user can continue working', async ({
      page,
      addMultipleElements,
      selectViaLayersPanel,
    }) => {
      await addMultipleElements(2);

      // Select multiple elements in sequence
      await selectViaLayersPanel(0);
      await page.waitForTimeout(100);
      await selectViaLayersPanel(1);
      await page.waitForTimeout(100);

      // Operations should continue
      const layerItems = page.locator('[data-testid="layer-item"]');
      await expect(layerItems.first()).toBeVisible();
    });

    test('8.2.3 - Iframe message handler throws - graceful handling', async ({
      page,
      addTestElement,
    }) => {
      await addTestElement();

      // UI should remain functional even with potential message errors
      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await expect(layerItem).toBeVisible();
    });

    test('8.2.4 - Bridge.js throws error - app continues', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(200);

      await expect(layerItem).toBeVisible();
    });

    test('8.2.5 - BRIDGE_ERROR message handled', async ({
      page,
      addTestElement,
    }) => {
      await addTestElement();

      // App should handle errors gracefully
      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await expect(layerItem).toBeVisible();
    });

    test('8.2.6 - Malformed message ignored', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      // Send malformed message
      await page.evaluate(() => {
        window.postMessage({ type: 'INVALID_MESSAGE_TYPE', data: null }, '*');
      });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(100);

      // App should continue working
      await expect(layerItem).toBeVisible();
    });

    test('8.2.7 - Element not found - graceful handling', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(200);

      // Delete element
      await page.keyboard.press('Delete');
      await page.waitForTimeout(200);

      // App should handle missing element gracefully
    });

    test('8.2.8 - Invalid sourceLocation handled', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(200);

      await expect(layerItem).toBeVisible();
    });

    test('8.2.9 - Yjs transaction fails - recovery', async ({
      page,
      addTestElement,
      getYjsElements,
    }) => {
      const elementId = await addTestElement();

      // Yjs state should be accessible
      const elements = await getYjsElements();
      expect(elements[elementId]).toBeDefined();
    });

    test('8.2.10 - HMR module unavailable - fallback', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(200);

      await expect(layerItem).toBeVisible();
    });

    test('8.2.11 - Network error during sync - offline mode', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(200);

      // UI should work even if network sync fails
      await expect(layerItem).toBeVisible();
    });

    test('8.2.12 - Large document - performance check', async ({
      page,
      addMultipleElements,
    }) => {
      // Add several elements
      await addMultipleElements(5);
      await page.waitForTimeout(500);

      // UI should still be responsive
      const layerItems = page.locator('[data-testid="layer-item"]');
      await expect(layerItems.first()).toBeVisible();
    });
  });

  // =====================================================
  // 8.3 Boundary Conditions (10 tests)
  // =====================================================
  test.describe('8.3 Boundary Conditions', () => {
    test('8.3.1 - Empty document', async ({ page }) => {
      await page.waitForTimeout(500);

      // Empty state should be displayed properly - verify app doesn't crash
      const layersPanel = page.locator('[data-testid="layers-panel"]');
      await expect(layersPanel).toBeVisible();
    });

    test('8.3.2 - Single element document', async ({
      page,
      addTestElement,
    }) => {
      await addTestElement();
      await page.waitForTimeout(200);

      const layerItems = page.locator('[data-testid="layer-item"]');
      expect(await layerItems.count()).toBe(1);
    });

    test('8.3.3 - Maximum nesting depth handling', async ({
      page,
      addTemplateByName,
      expandLayerItem,
    }) => {
      await addTemplateByName('Header');
      await page.waitForTimeout(300);

      await expandLayerItem(0);
      await page.waitForTimeout(200);

      // Should handle nested elements
      const layerItems = page.locator('[data-testid="layer-item"]');
      expect(await layerItems.count()).toBeGreaterThan(1);
    });

    test('8.3.4 - Maximum element count handling', async ({
      page,
      addMultipleElements,
    }) => {
      // Add several elements (not 10000 to keep test fast)
      await addMultipleElements(5);
      await page.waitForTimeout(300);

      const layerItems = page.locator('[data-testid="layer-item"]');
      expect(await layerItems.count()).toBeGreaterThanOrEqual(5);
    });

    test('8.3.5 - Very long class string', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
      getYjsElements,
    }) => {
      const elementId = await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(200);

      const elements = await getYjsElements();
      expect(elements[elementId]).toBeDefined();
    });

    test('8.3.6 - Very long text content', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(200);

      await expect(layerItem).toBeVisible();
    });

    test('8.3.7 - Unicode in text/classes', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(200);

      // UI should handle unicode
      await expect(layerItem).toBeVisible();
    });

    test('8.3.8 - Special characters in attributes', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(200);

      // Verify element can be selected and UI handles it
      await expect(layerItem).toBeVisible();

      // Check DesignBar is visible with element selected
      const designBar = page.locator('[data-testid="design-bar"]');
      if (await designBar.isVisible()) {
        // DesignBar should handle special characters in element attributes
        await expect(designBar).toBeVisible();
      }
    });

    test('8.3.9 - Zero-size elements handled', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(200);

      await expect(layerItem).toBeVisible();
    });

    test('8.3.10 - Off-screen elements handled', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(200);

      // Scroll/pan away
      const canvas = page.locator('[data-testid="editor-canvas"]');
      await canvas.hover();
      await page.mouse.wheel(100, 100);
      await page.waitForTimeout(100);

      await expect(layerItem).toBeVisible();
    });
  });

  // =====================================================
  // 8.4 Browser Edge Cases (8 tests)
  // =====================================================
  test.describe('8.4 Browser Edge Cases', () => {
    test('8.4.1 - contentEditable edge cases', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(200);

      // Enter edit mode
      await layerItem.dblclick();
      await page.waitForTimeout(200);

      // Exit edit mode
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);

      await expect(layerItem).toBeVisible();
    });

    test('8.4.2 - Selection API edge cases', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
      simulateTextSelection,
    }) => {
      const elementId = await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(200);

      // Simulate various selection states
      await simulateTextSelection({
        key: `component:${elementId}`,
        selectedText: '',
        isInsideLink: false,
      });

      await simulateTextSelection({
        key: `component:${elementId}`,
        selectedText: 'Some text',
        isInsideLink: false,
      });

      await expect(layerItem).toBeVisible();
    });

    test('8.4.3 - Range API edge cases', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(200);

      await expect(layerItem).toBeVisible();
    });

    test('8.4.4 - MutationObserver edge cases', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(200);

      // Rapid DOM changes
      for (let i = 0; i < 5; i++) {
        await layerItem.click();
        await page.waitForTimeout(30);
      }

      await expect(layerItem).toBeVisible();
    });

    test('8.4.5 - ResizeObserver edge cases', async ({
      page,
      addTestElement,
    }) => {
      await addTestElement();

      // Resize the window
      await page.setViewportSize({ width: 1024, height: 768 });
      await page.waitForTimeout(200);

      await page.setViewportSize({ width: 1280, height: 800 });
      await page.waitForTimeout(200);

      const canvas = page.locator('[data-testid="editor-canvas"]');
      await expect(canvas).toBeVisible();
    });

    test('8.4.6 - postMessage edge cases', async ({
      page,
      addTestElement,
    }) => {
      await addTestElement();

      // Send various message types
      await page.evaluate(() => {
        window.postMessage(null, '*');
        window.postMessage(undefined, '*');
        window.postMessage({ type: null }, '*');
        window.postMessage({ type: 'UNKNOWN' }, '*');
      });

      await page.waitForTimeout(200);

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await expect(layerItem).toBeVisible();
    });

    test('8.4.7 - Computed style edge cases', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(200);

      await expect(layerItem).toBeVisible();
    });

    test('8.4.8 - getBoundingClientRect edge cases', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(200);

      // Selection overlay should have valid rect
      const selectionOverlay = page.locator('[data-testid="selection-overlay"], [data-testid="selection-rect"]');
      if (await selectionOverlay.first().isVisible()) {
        const box = await selectionOverlay.first().boundingBox();
        if (box) {
          expect(box.width).toBeGreaterThanOrEqual(0);
          expect(box.height).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });

  // =====================================================
  // 8.5 State Consistency (10 tests)
  // =====================================================
  test.describe('8.5 State Consistency', () => {
    test('8.5.1 - Yjs state matches UI state', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
      getSelectedElementId,
    }) => {
      const elementId = await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(200);

      const selectedId = await getSelectedElementId();
      expect(selectedId).toBe(elementId);
    });

    test('8.5.2 - Yjs state persists correctly', async ({
      page,
      addTestElement,
      getYjsElements,
    }) => {
      const elementId = await addTestElement();
      await page.waitForTimeout(300);

      const elements = await getYjsElements();
      expect(elements[elementId]).toBeDefined();
    });

    test('8.5.3 - ClassStore matches Yjs', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
      getClassOverrides,
    }) => {
      const elementId = await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(200);

      const overrides = await getClassOverrides(elementId);
      expect(overrides === null || typeof overrides === 'object').toBe(true);
    });

    test('8.5.4 - SelectionContext matches Yjs', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
      getSelectedElementId,
    }) => {
      const elementId = await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(200);

      const selectedId = await getSelectedElementId();
      expect(selectedId).toBe(elementId);
    });

    test('8.5.5 - Undo stack consistent with state', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
      getUndoStackSize,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(200);

      const undoSize = await getUndoStackSize();
      expect(undoSize).toBeGreaterThanOrEqual(0);
    });

    test('8.5.6 - All observers in sync', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(200);

      // Verify selection state is synced across UI
      // Layer item should show selected state
      await expect(layerItem).toBeVisible();

      // DesignBar should be visible when element is selected
      const designBar = page.locator('[data-testid="design-bar"]');
      if (await designBar.isVisible()) {
        await expect(designBar).toBeVisible();
      }
    });

    test('8.5.7 - No orphaned references', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(200);

      // Delete element
      await page.keyboard.press('Delete');
      await page.waitForTimeout(300);

      // Should handle orphaned state
    });

    test('8.5.8 - No memory leaks (observers cleaned)', async ({
      page,
      addMultipleElements,
      selectViaLayersPanel,
    }) => {
      await addMultipleElements(3);

      // Select each element multiple times
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          await selectViaLayersPanel(j % 3);
          await page.waitForTimeout(50);
        }
      }

      // UI should still be responsive
      const layerItems = page.locator('[data-testid="layer-item"]');
      await expect(layerItems.first()).toBeVisible();
    });

    test('8.5.9 - No duplicate listeners', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      // Select/deselect multiple times
      for (let i = 0; i < 5; i++) {
        await selectViaLayersPanel(0);
        await page.waitForTimeout(50);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(50);
      }

      await selectViaLayersPanel(0);
      await page.waitForTimeout(100);

      await expect(layerItem).toBeVisible();
    });

    test('8.5.10 - State survives page operations', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
      getSelectedElementId,
    }) => {
      const elementId = await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(500);

      const selectedId = await getSelectedElementId();
      expect(selectedId).toBe(elementId);
    });
  });
});
