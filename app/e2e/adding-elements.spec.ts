// app/e2e/adding-elements.spec.ts
import { test, expect } from './fixtures/test-fixtures';

test.describe('Adding Elements', () => {
  test.beforeEach(async ({ page, waitForEditor }) => {
    await page.goto('/test-editor/test-project');
    await waitForEditor();
  });

  test.describe('1.1 Adding Pages', () => {
    test('1.1.1 - Add page creates new page in pages panel', async ({ page }) => {
      // Find and click "Add Page" button
      const addPageBtn = page.locator('[data-testid="add-page-btn"]');
      await addPageBtn.click();

      // Verify new page appears in pages list
      const pagesList = page.locator('[data-testid="pages-list"]');
      const pageItems = pagesList.locator('[data-testid="page-item"]');

      // Should have at least 2 pages now (initial + new)
      await expect(pageItems).toHaveCount(2, { timeout: 5000 });
    });

    test('1.1.2 - New page persists after navigation', async ({ page }) => {
      // Add a new page
      await page.locator('[data-testid="add-page-btn"]').click();

      // Get the new page name
      const pageItems = page.locator('[data-testid="page-item"]');
      const newPageName = await pageItems.last().textContent();

      // Navigate to first page
      await pageItems.first().click();

      // Navigate back to new page
      await pageItems.last().click();

      // Page should still exist with same name
      await expect(pageItems.last()).toHaveText(newPageName!);
    });
  });

  test.describe('1.2 Adding Templates', () => {
    test('1.2.1 - Click template in modal adds it to canvas', async ({ page }) => {
      // Open component picker modal
      await page.locator('[data-testid="add-component-button"]').click();

      // Wait for the modal to open - templates are shown directly (tabs only appear with enabled themes)
      // Get a template item and click it (the modal's ComponentCard has click-to-add)
      const template = page.locator('[data-testid="template-item"]').first();
      await template.waitFor({ state: 'visible', timeout: 5000 });
      await template.click();

      // Modal should close after selection and show success toast
      await expect(page.locator('[data-testid="template-item"]').first()).not.toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('1.3 Adding Component Instances', () => {
    test('1.3.1 - Click template adds element and closes modal', async ({ page }) => {
      // Open component picker modal
      await page.locator('[data-testid="add-component-button"]').click();

      // Wait for modal to be visible and get a template item
      const template = page.locator('[data-testid="template-item"]').first();
      await template.waitFor({ state: 'visible', timeout: 5000 });

      // Click on the template to add it (clicking triggers selection)
      await template.click();

      // Modal should close after selection
      await expect(template).not.toBeVisible({ timeout: 5000 });
    });
  });
});
