// app/e2e/mcp-mocks.js
// Standalone mock setup for Playwright MCP usage
// Usage: Load this via browser_run_code before navigating to /test-editor/*

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
 * Sets up API mocks for Playwright MCP testing.
 * Call this function with the page object before navigating.
 */
async function setupMocks(page) {
  await page.route('**/localhost:3000/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    // Themes endpoints
    if (url.includes('/themes')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
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

  return 'Mocks configured successfully';
}

// Export for use in test fixtures if needed
if (typeof module !== 'undefined') {
  module.exports = { setupMocks, MOCK_PROJECT };
}
