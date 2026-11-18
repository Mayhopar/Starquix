// app/e2e/utils/iframe-helpers.ts
import { Page, FrameLocator } from '@playwright/test';

/**
 * Wait for iframe to be ready and have content loaded.
 */
export async function waitForIframeReady(
  page: Page,
  iframeSelector: string,
  timeout = 10000
): Promise<FrameLocator> {
  await page.waitForSelector(iframeSelector, { timeout });
  const frame = page.frameLocator(iframeSelector);
  // Wait for body to have content
  await frame.locator('body').waitFor({ state: 'attached', timeout });
  return frame;
}

/**
 * Send a message to the iframe and wait for response.
 */
export async function sendMessageToIframe(
  page: Page,
  iframeSelector: string,
  message: { type: string; payload?: unknown }
): Promise<void> {
  await page.evaluate(
    ({ selector, msg }) => {
      const iframe = document.querySelector(selector) as HTMLIFrameElement;
      if (iframe?.contentWindow) {
        iframe.contentWindow.postMessage(msg, '*');
      }
    },
    { selector: iframeSelector, msg: message }
  );
}

/**
 * Get computed style of an element inside iframe.
 */
export async function getIframeElementStyle(
  frame: FrameLocator,
  selector: string,
  property: string
): Promise<string> {
  return frame.locator(selector).evaluate(
    (el, prop) => getComputedStyle(el).getPropertyValue(prop),
    property
  );
}
