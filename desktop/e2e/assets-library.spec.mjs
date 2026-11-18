// HN report 2026-11-09 on the real surface: in a new project, every library
// component opened from Assets after the first one showed Astro's 404
// ("Path: /__sq_component_view/src/components/Hero3.astro"), and
// Dynamic › Pages › BlogPost only ever answered with a refusal toast.
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BOOT, fail, launch, preview, setupEnv } from './helpers.mjs';

test('Assets: every library component opens after the first one; no unopenable BlogPost row', async ({}, info) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-electron-assets-'));
  let app;
  try {
    let page; ({ app, page } = await launch(setupEnv(temp)));
    await page.getByRole('button', { name: 'New Project', exact: true }).click();
    await page.getByRole('link').filter({ hasText: 'New Project' }).first().click();
    await expect(page).toHaveURL(/\/editor\/browser_/, { timeout: BOOT }); // a cold dev editor compiles the route first
    await expect(page.getByText('No elements on page', { exact: true })).toBeVisible({ timeout: BOOT });
    await page.getByRole('tab', { name: 'Assets', exact: true }).click();
    const row = name => page.locator(`input[readonly][value="${name}"]`);
    await row('Hero').first().click(); // the category folder: expand
    // First view: copies Hero2 in and computes the component-view route.
    await row('Hero2').click();
    await expect(preview(page).locator('[data-sq-source^="src/components/Hero2.astro"]').first()).toBeVisible({ timeout: BOOT });
    // Second view: the copy lands after that — it 404'd until the project reopened.
    await row('Hero3').click();
    await expect(preview(page).getByRole('heading', { name: 'Publish Astro sites from your Mac', exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(preview(page).getByText('404', { exact: false })).toHaveCount(0);
    // BlogPost was the only built-in in Pages: the dead folder is gone with it.
    await expect(row('BlogPost')).toHaveCount(0);
    await expect(row('Pages')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('assets-hero3.png') });
  } catch (error) { await fail(app, temp, info, error); }
  finally { await app?.close(); await fs.rm(temp, { recursive: true, force: true, maxRetries: 10 }); }
});
