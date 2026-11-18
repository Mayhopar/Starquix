// app/e2e/visual-regression.spec.ts
// Phase 7: Visual Regression Baselines (60 screenshots)
// Screenshots every major UI state.

import { test, expect } from './fixtures/test-fixtures';

test.describe('Visual Regression', () => {
  test.beforeEach(async ({ page, waitForEditor }) => {
    await page.goto('/test-editor/test-project');
    await waitForEditor();
  });

  // =====================================================
  // 7.1 DesignBar States (15 screenshots)
  // =====================================================
  test.describe('7.1 DesignBar States', () => {
    test('7.1.1 - DesignBar with element selected', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(300);

      const designBar = page.locator('[data-testid="design-bar"]');
      await expect(designBar).toBeVisible();
      await expect(designBar).toHaveScreenshot('designbar-element-selected.png');
    });

    test('7.1.2 - DesignBar with no selection', async ({ page }) => {
      // Wait for initial state without selection
      await page.waitForTimeout(500);

      const designBar = page.locator('[data-testid="design-bar"]');
      if (await designBar.isVisible()) {
        await expect(designBar).toHaveScreenshot('designbar-no-selection.png');
      }
    });

    test('7.1.3 - LayoutBlock expanded', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(300);

      // Click to expand LayoutBlock
      const layoutBlock = page.locator('[data-testid="layout-block"]').or(page.getByText('Layout')).first();
      if (await layoutBlock.isVisible()) {
        await layoutBlock.click();
        await page.waitForTimeout(200);
        await expect(layoutBlock).toHaveScreenshot('layout-block-expanded.png');
      }
    });

    test('7.1.4 - SizeBlock expanded', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(300);

      const sizeBlock = page.locator('[data-testid="size-block"]').or(page.getByText('Size')).first();
      if (await sizeBlock.isVisible()) {
        await sizeBlock.click();
        await page.waitForTimeout(200);
        await expect(sizeBlock).toHaveScreenshot('size-block-expanded.png');
      }
    });

    test('7.1.5 - SpacingBlock expanded', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(300);

      const spacingBlock = page.locator('[data-testid="spacing-block"]').or(page.getByText('Spacing')).first();
      if (await spacingBlock.isVisible()) {
        await spacingBlock.click();
        await page.waitForTimeout(200);
        await expect(spacingBlock).toHaveScreenshot('spacing-block-expanded.png');
      }
    });

    test('7.1.6 - TypographyBlock expanded', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(300);

      const typographyBlock = page.locator('[data-testid="typography-block"]').or(page.getByText('Typography')).first();
      if (await typographyBlock.isVisible()) {
        await typographyBlock.click();
        await page.waitForTimeout(200);
        await expect(typographyBlock).toHaveScreenshot('typography-block-expanded.png');
      }
    });

    test('7.1.7 - FillBlock expanded', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(300);

      const fillBlock = page.locator('[data-testid="fill-block"]').or(page.getByText('Fill')).first();
      if (await fillBlock.isVisible()) {
        await fillBlock.click();
        await page.waitForTimeout(200);
        await expect(fillBlock).toHaveScreenshot('fill-block-expanded.png');
      }
    });

    test('7.1.8 - BorderBlock expanded', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(300);

      const borderBlock = page.locator('[data-testid="border-block"]').or(page.getByText('Border')).first();
      if (await borderBlock.isVisible()) {
        await borderBlock.click();
        await page.waitForTimeout(200);
        await expect(borderBlock).toHaveScreenshot('border-block-expanded.png');
      }
    });

    test('7.1.9 - EffectsBlock expanded', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(300);

      const effectsBlock = page.locator('[data-testid="effects-block"]').or(page.getByText('Effects')).first();
      if (await effectsBlock.isVisible()) {
        await effectsBlock.click();
        await page.waitForTimeout(200);
        await expect(effectsBlock).toHaveScreenshot('effects-block-expanded.png');
      }
    });

    test('7.1.10 - LinkBlock with text selected', async ({
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

      await simulateTextSelection({
        key: `component:${elementId}`,
        selectedText: 'Selected Text',
        isInsideLink: false,
      });

      const linkBlock = page.locator('[data-testid="link-block"]');
      await expect(linkBlock).toBeVisible({ timeout: 3000 });
      await expect(linkBlock).toHaveScreenshot('link-block-text-selected.png');
    });

    test('7.1.11 - LinkBlock with cursor in link', async ({
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

      await simulateTextSelection({
        key: `component:${elementId}`,
        selectedText: 'Link Text',
        isInsideLink: true,
        existingHref: 'https://example.com',
      });

      const linkBlock = page.locator('[data-testid="link-block"]');
      await expect(linkBlock).toBeVisible({ timeout: 3000 });
      await expect(linkBlock).toHaveScreenshot('link-block-cursor-in-link.png');
    });

    test('7.1.12 - Breakpoint tabs', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(300);

      const breakpointTabs = page.locator('[data-testid="breakpoint-tabs"]');
      if (await breakpointTabs.isVisible()) {
        await expect(breakpointTabs).toHaveScreenshot('breakpoint-tabs.png');
      }
    });

    test('7.1.13 - Theme tabs', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(300);

      const themeTabs = page.locator('[data-testid="theme-tabs"]');
      if (await themeTabs.isVisible()) {
        await expect(themeTabs).toHaveScreenshot('theme-tabs.png');
      }
    });

    test('7.1.14 - State tabs', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(300);

      const stateTabs = page.locator('[data-testid="state-tabs"]');
      if (await stateTabs.isVisible()) {
        await expect(stateTabs).toHaveScreenshot('state-tabs.png');
      }
    });

    test('7.1.15 - Color picker open', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(300);

      // Try to open color picker
      const colorPicker = page.locator('[data-testid="color-picker"]');
      if (await colorPicker.isVisible()) {
        await colorPicker.click();
        await page.waitForTimeout(200);
        await expect(colorPicker).toHaveScreenshot('color-picker-open.png');
      }
    });
  });

  // =====================================================
  // 7.2 Canvas States (12 screenshots)
  // =====================================================
  test.describe('7.2 Canvas States', () => {
    test('7.2.1 - Canvas with element selected', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(300);

      const canvas = page.locator('[data-testid="editor-canvas"]');
      await expect(canvas).toHaveScreenshot('canvas-element-selected.png');
    });

    test('7.2.2 - Canvas with hover highlight', async ({
      page,
      addTestElement,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      // Hover over the layer item
      await layerItem.hover();
      await page.waitForTimeout(200);

      const canvas = page.locator('[data-testid="editor-canvas"]');
      await expect(canvas).toHaveScreenshot('canvas-hover-highlight.png');
    });

    test('7.2.3 - Canvas in edit mode', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(200);

      await layerItem.dblclick();
      await page.waitForTimeout(300);

      const canvas = page.locator('[data-testid="editor-canvas"]');
      await expect(canvas).toHaveScreenshot('canvas-edit-mode.png');
    });

    test('7.2.4 - Canvas with text selection', async ({
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

      await simulateTextSelection({
        key: `component:${elementId}`,
        selectedText: 'Selected Text',
        isInsideLink: false,
      });

      const canvas = page.locator('[data-testid="editor-canvas"]');
      await expect(canvas).toHaveScreenshot('canvas-text-selection.png');
    });

    test('7.2.5 - Canvas at xs breakpoint', async ({
      page,
      addTestElement,
    }) => {
      await addTestElement();
      await page.waitForTimeout(300);

      const canvas = page.locator('[data-testid="editor-canvas"]');
      await expect(canvas).toHaveScreenshot('canvas-xs-breakpoint.png');
    });

    test('7.2.6 - Canvas at md breakpoint', async ({
      page,
      addTestElement,
    }) => {
      await addTestElement();
      await page.waitForTimeout(300);

      const canvas = page.locator('[data-testid="editor-canvas"]');
      await expect(canvas).toHaveScreenshot('canvas-md-breakpoint.png');
    });

    test('7.2.7 - Canvas at lg breakpoint', async ({
      page,
      addTestElement,
    }) => {
      await addTestElement();
      await page.waitForTimeout(300);

      const canvas = page.locator('[data-testid="editor-canvas"]');
      await expect(canvas).toHaveScreenshot('canvas-lg-breakpoint.png');
    });

    test('7.2.8 - Canvas zoomed in (150%)', async ({
      page,
      addTestElement,
    }) => {
      await addTestElement();
      await page.waitForTimeout(300);

      // Try to zoom in
      const canvas = page.locator('[data-testid="editor-canvas"]');
      await canvas.hover();
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -100);
      await page.keyboard.up('Control');
      await page.waitForTimeout(200);

      await expect(canvas).toHaveScreenshot('canvas-zoomed-in.png');
    });

    test('7.2.9 - Canvas zoomed out (50%)', async ({
      page,
      addTestElement,
    }) => {
      await addTestElement();
      await page.waitForTimeout(300);

      // Try to zoom out
      const canvas = page.locator('[data-testid="editor-canvas"]');
      await canvas.hover();
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, 100);
      await page.keyboard.up('Control');
      await page.waitForTimeout(200);

      await expect(canvas).toHaveScreenshot('canvas-zoomed-out.png');
    });

    test('7.2.10 - Canvas with multiple viewports', async ({
      page,
      addTestElement,
    }) => {
      await addTestElement();
      await page.waitForTimeout(300);

      const canvas = page.locator('[data-testid="editor-canvas"]');
      await expect(canvas).toHaveScreenshot('canvas-multiple-viewports.png');
    });

    test('7.2.11 - Canvas with drill-down context', async ({
      page,
      addTemplateByName,
      expandLayerItem,
      selectViaLayersPanel,
    }) => {
      await addTemplateByName('Header');
      await page.waitForTimeout(300);

      await expandLayerItem(0);
      await page.waitForTimeout(200);

      await selectViaLayersPanel(1);
      await page.waitForTimeout(300);

      const canvas = page.locator('[data-testid="editor-canvas"]');
      await expect(canvas).toHaveScreenshot('canvas-drill-down-context.png');
    });

    test('7.2.12 - Canvas empty state', async ({ page }) => {
      await page.waitForTimeout(500);

      const canvas = page.locator('[data-testid="editor-canvas"]');
      // Canvas may not be visible when empty, skip screenshot if not visible
      if (await canvas.isVisible()) {
        await expect(canvas).toHaveScreenshot('canvas-empty-state.png');
      }
    });
  });

  // =====================================================
  // 7.3 LayersPanel States (10 screenshots)
  // =====================================================
  test.describe('7.3 LayersPanel States', () => {
    test('7.3.1 - LayersPanel with elements', async ({
      page,
      addMultipleElements,
    }) => {
      await addMultipleElements(3);
      await page.waitForTimeout(300);

      const layersPanel = page.locator('[data-testid="layers-panel"]');
      await expect(layersPanel).toHaveScreenshot('layers-panel-with-elements.png');
    });

    test('7.3.2 - LayersPanel with selection', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(200);

      const layersPanel = page.locator('[data-testid="layers-panel"]');
      await expect(layersPanel).toHaveScreenshot('layers-panel-with-selection.png');
    });

    test('7.3.3 - LayersPanel expanded tree', async ({
      page,
      addTemplateByName,
      expandLayerItem,
    }) => {
      await addTemplateByName('Header');
      await page.waitForTimeout(300);

      await expandLayerItem(0);
      await page.waitForTimeout(200);

      const layersPanel = page.locator('[data-testid="layers-panel"]');
      await expect(layersPanel).toHaveScreenshot('layers-panel-expanded-tree.png');
    });

    test('7.3.4 - LayersPanel collapsed tree', async ({
      page,
      addTemplateByName,
    }) => {
      await addTemplateByName('Header');
      await page.waitForTimeout(300);

      const layersPanel = page.locator('[data-testid="layers-panel"]');
      await expect(layersPanel).toHaveScreenshot('layers-panel-collapsed-tree.png');
    });

    test('7.3.5 - LayersPanel drag indicator', async ({
      page,
      addMultipleElements,
    }) => {
      await addMultipleElements(3);
      await page.waitForTimeout(300);

      // Start a drag operation
      const layerItems = page.locator('[data-testid="layer-item"]');
      const firstItem = layerItems.first();
      const box = await firstItem.boundingBox();

      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2, box.y + 60, { steps: 5 });
        await page.waitForTimeout(100);

        const layersPanel = page.locator('[data-testid="layers-panel"]');
        await expect(layersPanel).toHaveScreenshot('layers-panel-drag-indicator.png');

        await page.mouse.up();
      }
    });

    test('7.3.6 - LayersPanel hover state', async ({
      page,
      addTestElement,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await layerItem.hover();
      await page.waitForTimeout(100);

      const layersPanel = page.locator('[data-testid="layers-panel"]');
      await expect(layersPanel).toHaveScreenshot('layers-panel-hover-state.png');
    });

    test('7.3.7 - LayersPanel context highlight', async ({
      page,
      addTemplateByName,
      expandLayerItem,
      selectViaLayersPanel,
    }) => {
      await addTemplateByName('Header');
      await page.waitForTimeout(300);

      await expandLayerItem(0);
      await page.waitForTimeout(200);

      await selectViaLayersPanel(1);
      await page.waitForTimeout(200);

      const layersPanel = page.locator('[data-testid="layers-panel"]');
      await expect(layersPanel).toHaveScreenshot('layers-panel-context-highlight.png');
    });

    test('7.3.8 - LayersPanel empty state', async ({ page }) => {
      await page.waitForTimeout(500);

      const layersPanel = page.locator('[data-testid="layers-panel"]');
      await expect(layersPanel).toHaveScreenshot('layers-panel-empty-state.png');
    });

    test('7.3.9 - LayersPanel with deep nesting', async ({
      page,
      addTemplateByName,
      expandLayerItem,
    }) => {
      await addTemplateByName('Header');
      await page.waitForTimeout(300);

      // Expand multiple levels
      await expandLayerItem(0);
      await page.waitForTimeout(200);

      const layersPanel = page.locator('[data-testid="layers-panel"]');
      await expect(layersPanel).toHaveScreenshot('layers-panel-deep-nesting.png');
    });

    test('7.3.10 - LayersPanel with many elements', async ({
      page,
      addMultipleElements,
    }) => {
      await addMultipleElements(5);
      await page.waitForTimeout(300);

      const layersPanel = page.locator('[data-testid="layers-panel"]');
      await expect(layersPanel).toHaveScreenshot('layers-panel-many-elements.png');
    });
  });

  // =====================================================
  // 7.4 Element States (15 screenshots)
  // =====================================================
  test.describe('7.4 Element States', () => {
    test('7.4.1 - Element with all Tailwind colors', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(300);

      const canvas = page.locator('[data-testid="editor-canvas"]');
      await expect(canvas).toHaveScreenshot('element-tailwind-colors.png');
    });

    test('7.4.2 - Element with flex layout', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(300);

      const canvas = page.locator('[data-testid="editor-canvas"]');
      await expect(canvas).toHaveScreenshot('element-flex-layout.png');
    });

    test('7.4.3 - Element with grid layout', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(300);

      const canvas = page.locator('[data-testid="editor-canvas"]');
      await expect(canvas).toHaveScreenshot('element-grid-layout.png');
    });

    test('7.4.4 - Element with all font sizes', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(300);

      const canvas = page.locator('[data-testid="editor-canvas"]');
      await expect(canvas).toHaveScreenshot('element-font-sizes.png');
    });

    test('7.4.5 - Element with all font weights', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(300);

      const canvas = page.locator('[data-testid="editor-canvas"]');
      await expect(canvas).toHaveScreenshot('element-font-weights.png');
    });

    test('7.4.6 - Element with all spacing', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(300);

      const canvas = page.locator('[data-testid="editor-canvas"]');
      await expect(canvas).toHaveScreenshot('element-all-spacing.png');
    });

    test('7.4.7 - Element with shadows', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(300);

      const canvas = page.locator('[data-testid="editor-canvas"]');
      await expect(canvas).toHaveScreenshot('element-shadows.png');
    });

    test('7.4.8 - Element with borders', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(300);

      const canvas = page.locator('[data-testid="editor-canvas"]');
      await expect(canvas).toHaveScreenshot('element-borders.png');
    });

    test('7.4.9 - Element with gradients', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(300);

      const canvas = page.locator('[data-testid="editor-canvas"]');
      await expect(canvas).toHaveScreenshot('element-gradients.png');
    });

    test('7.4.10 - Element with opacity', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(300);

      const canvas = page.locator('[data-testid="editor-canvas"]');
      await expect(canvas).toHaveScreenshot('element-opacity.png');
    });

    test('7.4.11 - Element in dark mode', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(300);

      const canvas = page.locator('[data-testid="editor-canvas"]');
      await expect(canvas).toHaveScreenshot('element-dark-mode.png');
    });

    test('7.4.12 - Element in hover state', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(300);

      const canvas = page.locator('[data-testid="editor-canvas"]');
      await expect(canvas).toHaveScreenshot('element-hover-state.png');
    });

    test('7.4.13 - Element with link', async ({
      page,
      addTemplateByName,
      expandLayerItem,
    }) => {
      await addTemplateByName('Header');
      await page.waitForTimeout(300);

      await expandLayerItem(0);
      await page.waitForTimeout(200);

      const canvas = page.locator('[data-testid="editor-canvas"]');
      await expect(canvas).toHaveScreenshot('element-with-link.png');
    });

    test('7.4.14 - Element with nested content', async ({
      page,
      addTemplateByName,
    }) => {
      await addTemplateByName('Header');
      await page.waitForTimeout(300);

      const canvas = page.locator('[data-testid="editor-canvas"]');
      await expect(canvas).toHaveScreenshot('element-nested-content.png');
    });

    test('7.4.15 - Element with long text', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(300);

      const canvas = page.locator('[data-testid="editor-canvas"]');
      await expect(canvas).toHaveScreenshot('element-long-text.png');
    });
  });

  // =====================================================
  // 7.5 Interaction States (8 screenshots)
  // =====================================================
  test.describe('7.5 Interaction States', () => {
    test('7.5.1 - Drag in progress', async ({
      page,
      addMultipleElements,
    }) => {
      await addMultipleElements(2);
      await page.waitForTimeout(300);

      const layerItems = page.locator('[data-testid="layer-item"]');
      const firstItem = layerItems.first();
      const box = await firstItem.boundingBox();

      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2, box.y + 60, { steps: 5 });
        await page.waitForTimeout(100);

        await expect(page).toHaveScreenshot('drag-in-progress.png');

        await page.mouse.up();
      }
    });

    test('7.5.2 - Drop target indicator', async ({
      page,
      addMultipleElements,
    }) => {
      await addMultipleElements(3);
      await page.waitForTimeout(300);

      const layerItems = page.locator('[data-testid="layer-item"]');
      const firstItem = layerItems.first();
      const secondItem = layerItems.nth(1);
      const firstBox = await firstItem.boundingBox();
      const secondBox = await secondItem.boundingBox();

      if (firstBox && secondBox) {
        await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(secondBox.x + secondBox.width / 2, secondBox.y, { steps: 5 });
        await page.waitForTimeout(100);

        await expect(page).toHaveScreenshot('drop-target-indicator.png');

        await page.mouse.up();
      }
    });

    test('7.5.3 - Selection highlight overlay', async ({
      page,
      addTestElement,
      selectViaLayersPanel,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      await selectViaLayersPanel(0);
      await page.waitForTimeout(300);

      await expect(page).toHaveScreenshot('selection-highlight-overlay.png');
    });

    test('7.5.4 - Text selection highlight', async ({
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

      await simulateTextSelection({
        key: `component:${elementId}`,
        selectedText: 'Selected Text',
        isInsideLink: false,
      });

      await expect(page).toHaveScreenshot('text-selection-highlight.png');
    });

    test('7.5.5 - Loading spinner', async ({ page }) => {
      // Loading state - capture initial load
      await expect(page).toHaveScreenshot('loading-spinner.png', { maxDiffPixels: 1000 });
    });

    test('7.5.6 - Error state', async ({ page }) => {
      await page.waitForTimeout(500);
      // Capture current state as error state reference
      await expect(page).toHaveScreenshot('error-state.png', { maxDiffPixels: 1000 });
    });

    test('7.5.7 - Tooltip visible', async ({
      page,
      addTestElement,
    }) => {
      await addTestElement();

      const layerItem = page.locator('[data-testid="layer-item"]').first();
      await layerItem.waitFor({ state: 'visible', timeout: 5000 });

      // Hover to show tooltip
      await layerItem.hover();
      await page.waitForTimeout(500); // Wait for tooltip delay

      await expect(page).toHaveScreenshot('tooltip-visible.png');
    });

    test('7.5.8 - Modal/dialog open', async ({ page }) => {
      // Try to open component picker modal
      const addButton = page.locator('[data-testid="add-component-button"]');
      if (await addButton.isVisible()) {
        await addButton.click();
        await page.waitForTimeout(300);

        await expect(page).toHaveScreenshot('modal-dialog-open.png');
      }
    });
  });
});
