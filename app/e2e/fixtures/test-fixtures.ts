// app/e2e/fixtures/test-fixtures.ts
import { test as base, expect, Page, FrameLocator } from '@playwright/test';

// Mock project data for E2E tests
const MOCK_PROJECT = {
  id: 'test-project',
  name: 'Test Project',
  description: 'E2E test project',
  pagesTree: {
    rootPageIds: ['page-1'],
    pages: [{ id: 'page-1', name: 'Home', children: [] }],
  },
  pages: [{
    id: 'page-1',
    name: 'Home',
    components: [],
    metadata: null,
  }],
  themes: [],
  templates: [],
  components: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

/**
 * Extended test fixtures for Starquix E2E testing.
 * Provides helpers for Yjs state verification and common operations.
 */
export interface StarquixFixtures {
  /** Get the Astro preview iframe */
  previewFrame: FrameLocator;
  /** Wait for the editor to be fully loaded */
  waitForEditor: () => Promise<void>;
  /** Select an element in the canvas by its data-sq-source key */
  selectElement: (sourceKey: string) => Promise<void>;
  /** Get the design bar container */
  designBar: Page['locator'];
  /** Get the layers panel container */
  layersPanel: Page['locator'];
  /** Setup API mocks for testing */
  mockApi: () => Promise<void>;
  /** Add a test element via component picker and return its ID */
  addTestElement: () => Promise<string>;
  /** Add a specific template by name and return its ID */
  addTemplateByName: (templateName: string) => Promise<string>;
  /** Add multiple test elements and return their IDs */
  addMultipleElements: (count: number) => Promise<string[]>;
  /** Select an element via layers panel by its ID or index */
  selectViaLayersPanel: (indexOrId: number | string) => Promise<void>;
  /** Expand a layer item to show its children */
  expandLayerItem: (indexOrId: number | string) => Promise<void>;
  /** Select a child element within an expanded layer item */
  selectLayerChild: (parentIndex: number, childIndex: number) => Promise<void>;
  /** Get classes from Yjs state for an element at a breakpoint */
  getElementClasses: (elementId: string, breakpoint?: string) => Promise<string[]>;
  /** Get all classes for an element (all breakpoints) */
  getElementAllClasses: (elementId: string) => Promise<Record<string, string[]> | null>;
  /** Get class overrides for a component instance */
  getClassOverrides: (elementId: string) => Promise<Record<string, Record<string, string[]>> | null>;
  /** Get link overrides for a component instance */
  getLinkOverrides: (elementId: string) => Promise<Record<string, Record<string, unknown>> | null>;
  /** Get source classes by key */
  getSourceClasses: (key: string) => Promise<string | null>;
  /** Get resolved static markup for an element */
  getResolvedMarkup: (elementId: string) => Promise<string | null>;
  /** Get all elements from Yjs state */
  getYjsElements: () => Promise<Record<string, unknown>>;
  /** Get selected element ID from Yjs state */
  getSelectedElementId: () => Promise<string | null>;
  /** Get root element IDs in order from Yjs state */
  getRootElementOrder: () => Promise<string[]>;
  /** Get element count on current page */
  getElementCount: () => Promise<number>;
  /** Trigger undo (Cmd+Z) */
  undo: () => Promise<void>;
  /** Trigger redo (Cmd+Shift+Z) */
  redo: () => Promise<void>;
  /** Get undo stack size */
  getUndoStackSize: () => Promise<number>;
  /** Get redo stack size */
  getRedoStackSize: () => Promise<number>;
  /** Drag layer item from one index to another */
  dragLayerItem: (fromIndex: number, toIndex: number) => Promise<void>;
  /** Get classOverrides for a component instance */
  getInstanceClassOverrides: (elementId: string) => Promise<Record<string, Record<string, string[]>> | null>;
  /** Get the link block element if visible */
  getLinkBlock: () => Page['locator'];
  /** Check if LinkBlock is visible */
  isLinkBlockVisible: () => Promise<boolean>;
  /** Set link href in LinkBlock */
  setLinkHref: (href: string) => Promise<void>;
  /** Toggle "open in new tab" in LinkBlock */
  toggleLinkNewTab: () => Promise<void>;
  /** Click unlink button in LinkBlock */
  clickUnlink: () => Promise<void>;
  /** Simulate text selection in iframe via bridge message */
  simulateTextSelection: (options: {
    key: string;
    selectedText: string;
    isInsideLink?: boolean;
    existingHref?: string;
    existingTarget?: '_blank' | '_self';
  }) => Promise<void>;
  /** Clear text selection via bridge message */
  clearTextSelection: (key: string) => Promise<void>;
  /** Get current text selection state */
  getTextSelectionState: () => Promise<{
    hasTextSelection: boolean;
    selectedText: string;
    isInsideLink: boolean;
    existingHref?: string;
    existingTarget?: '_blank' | '_self';
  } | null>;
}

export const test = base.extend<StarquixFixtures>({
  // Auto-setup API mocks before each test
  mockApi: [async ({ page }, use) => {
    // Mock ALL API endpoints on the API server (port 3001)
    await page.route('**/localhost:3000/**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();

      // Themes endpoints
      if (url.includes('/themes')) {
        if (url.includes('/components')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([]),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([]),
          });
        }
      }
      // Projects endpoint
      else if (url.includes('/projects')) {
        if (method === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(MOCK_PROJECT),
          });
        } else if (method === 'PATCH') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true }),
          });
        } else {
          await route.fulfill({ status: 200, body: '{}' });
        }
      }
      // Auth endpoints
      else if (url.includes('/auth')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ accessToken: 'test-token', refreshToken: 'test-refresh' }),
        });
      }
      // Default - return empty success
      else {
        await route.fulfill({ status: 200, body: '[]' });
      }
    });

    await use(async () => {});
  }, { auto: true }],

  previewFrame: async ({ page }, use) => {
    // The preview iframe - Starquix uses ViewportFrame which embeds Astro preview
    const frame = page.frameLocator('iframe[data-viewport]').first();
    await use(frame);
  },

  waitForEditor: async ({ page }, use) => {
    const waitFn = async () => {
      // Wait for main app to load - use state: 'attached' since the element may be empty/hidden
      await page.waitForSelector('[data-testid="editor-canvas"]', { timeout: 30000, state: 'attached' });
      // Wait for the pages panel to be visible (confirms editor is ready)
      await page.waitForSelector('[data-testid="pages-list"]', { timeout: 30000 });
    };
    await use(waitFn);
  },

  selectElement: async ({ page, previewFrame }, use) => {
    const selectFn = async (sourceKey: string) => {
      // Click on element inside iframe
      const element = previewFrame.locator(`[data-sq-source="${sourceKey}"]`);
      await element.click();
      // Wait for selection overlay to appear
      await page.waitForSelector('[data-testid="selection-overlay"]', { timeout: 5000 });
    };
    await use(selectFn);
  },

  designBar: async ({ page }, use) => {
    await use(page.locator('[data-testid="design-bar"]'));
  },

  layersPanel: async ({ page }, use) => {
    await use(page.locator('[data-testid="layers-panel"]'));
  },

  // Add a test element via the component picker modal
  addTestElement: async ({ page }, use) => {
    const addFn = async (): Promise<string> => {
      // Open component picker modal
      await page.locator('[data-testid="add-component-button"]').click();

      // Wait for modal and click first template
      const template = page.locator('[data-testid="template-item"]').first();
      await template.waitFor({ state: 'visible', timeout: 5000 });
      await template.click();

      // Wait for modal to close (element added)
      await expect(template).not.toBeVisible({ timeout: 5000 });

      // Wait a bit for Yjs to sync
      await page.waitForTimeout(200);

      // Get the element ID from Yjs state
      const elementId = await page.evaluate(() => {
        const testHelper = (window as any).__STARQUIX_TEST__;
        if (!testHelper) return null;

        const elements = testHelper.getElements();
        const elementIds = Object.keys(elements);
        return elementIds[elementIds.length - 1] || null;
      });

      return elementId || 'unknown';
    };
    await use(addFn);
  },

  // Add multiple test elements
  addMultipleElements: async ({ page }, use) => {
    const addFn = async (count: number): Promise<string[]> => {
      const elementIds: string[] = [];

      for (let i = 0; i < count; i++) {
        // Open component picker modal
        await page.locator('[data-testid="add-component-button"]').click();

        // Wait for modal and click first template
        const template = page.locator('[data-testid="template-item"]').first();
        await template.waitFor({ state: 'visible', timeout: 5000 });
        await template.click();

        // Wait for modal to close
        await expect(template).not.toBeVisible({ timeout: 5000 });

        // Wait for Yjs to sync
        await page.waitForTimeout(200);

        // Get the new element ID
        const elementId = await page.evaluate(() => {
          const testHelper = (window as any).__STARQUIX_TEST__;
          if (!testHelper) return null;

          const elements = testHelper.getElements();
          const ids = Object.keys(elements);
          return ids[ids.length - 1] || null;
        });

        if (elementId) {
          elementIds.push(elementId);
        }
      }

      return elementIds;
    };
    await use(addFn);
  },

  // Select element via layers panel
  selectViaLayersPanel: async ({ page }, use) => {
    const selectFn = async (indexOrId: number | string) => {
      const layersPanel = page.locator('[data-testid="layers-panel"]');

      if (typeof indexOrId === 'number') {
        // Select by index
        const layerItem = layersPanel.locator('[data-testid="layer-item"]').nth(indexOrId);
        await layerItem.click();
      } else {
        // Select by element ID
        const layerItem = layersPanel.locator(`[data-element-id="${indexOrId}"]`);
        await layerItem.click();
      }

      // Wait a bit for selection to propagate
      await page.waitForTimeout(100);
    };
    await use(selectFn);
  },

  // Get element classes from Yjs state
  getElementClasses: async ({ page }, use) => {
    const getFn = async (elementId: string, breakpoint = 'base'): Promise<string[]> => {
      return await page.evaluate(({ elementId, breakpoint }) => {
        const testHelper = (window as any).__STARQUIX_TEST__;
        if (!testHelper) return [];

        const element = testHelper.getElement(elementId);
        if (!element || !element.classes) return [];

        return element.classes[breakpoint] || [];
      }, { elementId, breakpoint });
    };
    await use(getFn);
  },

  // Get all elements from Yjs state
  getYjsElements: async ({ page }, use) => {
    const getFn = async (): Promise<Record<string, unknown>> => {
      return await page.evaluate(() => {
        const testHelper = (window as any).__STARQUIX_TEST__;
        if (!testHelper) return {};
        return testHelper.getElements();
      });
    };
    await use(getFn);
  },

  // Get selected element ID from Yjs state
  getSelectedElementId: async ({ page }, use) => {
    const getFn = async (): Promise<string | null> => {
      return await page.evaluate(() => {
        const testHelper = (window as any).__STARQUIX_TEST__;
        if (!testHelper) return null;
        return testHelper.getSelectedElementId();
      });
    };
    await use(getFn);
  },

  // Get root element IDs in order
  getRootElementOrder: async ({ page }, use) => {
    const getFn = async (): Promise<string[]> => {
      return await page.evaluate(() => {
        const testHelper = (window as any).__STARQUIX_TEST__;
        if (!testHelper) return [];
        return testHelper.getRootElementOrder?.() || [];
      });
    };
    await use(getFn);
  },

  // Get element count
  getElementCount: async ({ page }, use) => {
    const getFn = async (): Promise<number> => {
      return await page.evaluate(() => {
        const testHelper = (window as any).__STARQUIX_TEST__;
        if (!testHelper) return 0;
        return testHelper.getElementCount?.() || Object.keys(testHelper.getElements()).length;
      });
    };
    await use(getFn);
  },

  // Undo
  undo: async ({ page }, use) => {
    const undoFn = async () => {
      await page.keyboard.press('Meta+z');
      await page.waitForTimeout(100);
    };
    await use(undoFn);
  },

  // Redo
  redo: async ({ page }, use) => {
    const redoFn = async () => {
      await page.keyboard.press('Meta+Shift+z');
      await page.waitForTimeout(100);
    };
    await use(redoFn);
  },

  // Get undo stack size
  getUndoStackSize: async ({ page }, use) => {
    const getFn = async (): Promise<number> => {
      return await page.evaluate(() => {
        const testHelper = (window as any).__STARQUIX_TEST__;
        if (!testHelper) return 0;
        return testHelper.getUndoStackSize?.() || 0;
      });
    };
    await use(getFn);
  },

  // Get redo stack size
  getRedoStackSize: async ({ page }, use) => {
    const getFn = async (): Promise<number> => {
      return await page.evaluate(() => {
        const testHelper = (window as any).__STARQUIX_TEST__;
        if (!testHelper) return 0;
        return testHelper.getRedoStackSize?.() || 0;
      });
    };
    await use(getFn);
  },

  // Drag layer item
  dragLayerItem: async ({ page }, use) => {
    const dragFn = async (fromIndex: number, toIndex: number) => {
      const layersPanel = page.locator('[data-testid="layers-panel"]');
      const fromItem = layersPanel.locator('[data-testid="layer-item"]').nth(fromIndex);
      const toItem = layersPanel.locator('[data-testid="layer-item"]').nth(toIndex);

      // Get bounding boxes
      const fromBox = await fromItem.boundingBox();
      const toBox = await toItem.boundingBox();

      if (!fromBox || !toBox) {
        throw new Error('Could not get bounding boxes for drag operation');
      }

      // Perform drag
      await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(100); // Wait for drag to start

      // Move to target position
      const targetY = toIndex > fromIndex
        ? toBox.y + toBox.height // Below the target
        : toBox.y; // Above the target

      await page.mouse.move(toBox.x + toBox.width / 2, targetY, { steps: 10 });
      await page.waitForTimeout(100);
      await page.mouse.up();

      // Wait for reorder to complete
      await page.waitForTimeout(200);
    };
    await use(dragFn);
  },

  // Get classOverrides for instance (via testHelper deep access)
  getInstanceClassOverrides: async ({ page }, use) => {
    const getFn = async (elementId: string): Promise<Record<string, Record<string, string[]>> | null> => {
      return await page.evaluate((id) => {
        const testHelper = (window as any).__STARQUIX_TEST__;
        if (!testHelper) return null;
        return testHelper.getClassOverrides?.(id) || null;
      }, elementId);
    };
    await use(getFn);
  },

  // Get all classes for an element (all breakpoints)
  getElementAllClasses: async ({ page }, use) => {
    const getFn = async (elementId: string): Promise<Record<string, string[]> | null> => {
      return await page.evaluate((id) => {
        const testHelper = (window as any).__STARQUIX_TEST__;
        if (!testHelper) return null;
        return testHelper.getElementAllClasses?.(id) || null;
      }, elementId);
    };
    await use(getFn);
  },

  // Get class overrides for a component instance (deep Yjs access)
  getClassOverrides: async ({ page }, use) => {
    const getFn = async (elementId: string): Promise<Record<string, Record<string, string[]>> | null> => {
      return await page.evaluate((id) => {
        const testHelper = (window as any).__STARQUIX_TEST__;
        if (!testHelper) return null;
        return testHelper.getClassOverrides?.(id) || null;
      }, elementId);
    };
    await use(getFn);
  },

  // Get link overrides for a component instance
  getLinkOverrides: async ({ page }, use) => {
    const getFn = async (elementId: string): Promise<Record<string, Record<string, unknown>> | null> => {
      return await page.evaluate((id) => {
        const testHelper = (window as any).__STARQUIX_TEST__;
        if (!testHelper) return null;
        return testHelper.getLinkOverrides?.(id) || null;
      }, elementId);
    };
    await use(getFn);
  },

  // Get source classes by key
  getSourceClasses: async ({ page }, use) => {
    const getFn = async (key: string): Promise<string | null> => {
      return await page.evaluate((k) => {
        const testHelper = (window as any).__STARQUIX_TEST__;
        if (!testHelper) return null;
        return testHelper.getSourceClasses?.(k) || null;
      }, key);
    };
    await use(getFn);
  },

  // Get resolved static markup for an element
  getResolvedMarkup: async ({ page }, use) => {
    const getFn = async (elementId: string): Promise<string | null> => {
      return await page.evaluate((id) => {
        const testHelper = (window as any).__STARQUIX_TEST__;
        if (!testHelper) return null;
        return testHelper.getResolvedMarkup?.(id) || null;
      }, elementId);
    };
    await use(getFn);
  },

  // Add a specific template by name
  addTemplateByName: async ({ page }, use) => {
    const addFn = async (templateName: string): Promise<string> => {
      // Open component picker modal
      await page.locator('[data-testid="add-component-button"]').click();

      // Wait for modal to be visible
      await page.locator('[data-testid="template-item"]').first().waitFor({ state: 'visible', timeout: 5000 });

      // Find and click the template by name
      const template = page.locator(`[data-testid="template-item"]:has-text("${templateName}")`);
      await template.click();

      // Wait for modal to close
      await expect(template).not.toBeVisible({ timeout: 5000 });

      // Wait for Yjs to sync
      await page.waitForTimeout(200);

      // Get the element ID
      const elementId = await page.evaluate(() => {
        const testHelper = (window as any).__STARQUIX_TEST__;
        if (!testHelper) return null;

        const elements = testHelper.getElements();
        const elementIds = Object.keys(elements);
        return elementIds[elementIds.length - 1] || null;
      });

      return elementId || 'unknown';
    };
    await use(addFn);
  },

  // Expand a layer item to show its children
  expandLayerItem: async ({ page }, use) => {
    const expandFn = async (indexOrId: number | string) => {
      const layersPanel = page.locator('[data-testid="layers-panel"]');
      let layerItem;

      if (typeof indexOrId === 'number') {
        layerItem = layersPanel.locator('[data-testid="layer-item"]').nth(indexOrId);
      } else {
        layerItem = layersPanel.locator(`[data-element-id="${indexOrId}"]`);
      }

      // Click the expand/collapse toggle (usually a chevron icon)
      const expandToggle = layerItem.locator('[data-testid="layer-expand-toggle"], .expand-toggle, button').first();
      if (await expandToggle.isVisible()) {
        await expandToggle.click();
      } else {
        // Fallback: double-click the layer item to expand
        await layerItem.dblclick();
      }

      await page.waitForTimeout(100);
    };
    await use(expandFn);
  },

  // Select a child element within an expanded layer item
  selectLayerChild: async ({ page }, use) => {
    const selectFn = async (parentIndex: number, childIndex: number) => {
      const layersPanel = page.locator('[data-testid="layers-panel"]');

      // Find nested layer items (children of the parent)
      const parentItem = layersPanel.locator('[data-testid="layer-item"]').nth(parentIndex);
      const childItem = parentItem.locator('[data-testid="layer-item"]').nth(childIndex);

      await childItem.click();
      await page.waitForTimeout(100);
    };
    await use(selectFn);
  },

  // Get the link block
  getLinkBlock: async ({ page }, use) => {
    await use(page.locator('[data-testid="link-block"]'));
  },

  // Check if LinkBlock is visible
  isLinkBlockVisible: async ({ page }, use) => {
    const checkFn = async (): Promise<boolean> => {
      return await page.locator('[data-testid="link-block"]').isVisible();
    };
    await use(checkFn);
  },

  // Set link href in LinkBlock
  setLinkHref: async ({ page }, use) => {
    const setFn = async (href: string) => {
      const linkBlock = page.locator('[data-testid="link-block"]');
      const input = linkBlock.locator('input[placeholder="URL or page"]');
      await input.fill(href);
      await input.press('Enter');
      await page.waitForTimeout(100);
    };
    await use(setFn);
  },

  // Toggle "open in new tab" in LinkBlock
  toggleLinkNewTab: async ({ page }, use) => {
    const toggleFn = async () => {
      const toggle = page.locator('[data-testid="link-newtab-toggle"]');
      await toggle.click();
      await page.waitForTimeout(100);
    };
    await use(toggleFn);
  },

  // Click unlink button in LinkBlock
  clickUnlink: async ({ page }, use) => {
    const clickFn = async () => {
      const unlinkBtn = page.locator('[data-testid="unlink-btn"]');
      await unlinkBtn.click();
      await page.waitForTimeout(100);
    };
    await use(clickFn);
  },

  // Simulate text selection in iframe (uses test helper to set state directly)
  simulateTextSelection: async ({ page }, use) => {
    const simulateFn = async (options: {
      key: string;
      selectedText: string;
      isInsideLink?: boolean;
      existingHref?: string;
      existingTarget?: '_blank' | '_self';
    }) => {
      await page.evaluate((opts) => {
        const testHelper = (window as any).__STARQUIX_TEST__;
        if (testHelper) {
          // First enter edit mode (required for LinkBlock to show)
          if (testHelper.enterEditMode) {
            testHelper.enterEditMode();
          }
          // Then set text selection
          if (testHelper.setTextSelection) {
            testHelper.setTextSelection({
              hasTextSelection: opts.selectedText.length > 0,
              selectedText: opts.selectedText,
              isInsideLink: opts.isInsideLink ?? false,
              existingHref: opts.existingHref,
              existingTarget: opts.existingTarget,
              linkKey: opts.isInsideLink ? opts.key : undefined,
            });
          }
        }
      }, options);
      await page.waitForTimeout(150);
    };
    await use(simulateFn);
  },

  // Clear text selection (uses test helper)
  clearTextSelection: async ({ page }, use) => {
    const clearFn = async (_key: string) => {
      await page.evaluate(() => {
        const testHelper = (window as any).__STARQUIX_TEST__;
        if (testHelper?.clearTextSelection) {
          testHelper.clearTextSelection();
        }
      });
      await page.waitForTimeout(100);
    };
    await use(clearFn);
  },

  // Get current text selection state from context
  getTextSelectionState: async ({ page }, use) => {
    const getFn = async () => {
      return await page.evaluate(() => {
        const testHelper = (window as any).__STARQUIX_TEST__;
        if (testHelper?.getTextSelectionState) {
          return testHelper.getTextSelectionState();
        }
        return null;
      });
    };
    await use(getFn);
  },
});

export { expect };
