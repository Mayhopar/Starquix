// Frame-by-frame record of editor journeys (owner 2026-11-08: "things are moving all
// around the place"): every compositor frame of the window while a journey runs, as
// PNGs + meta.json, for scripts/filmstrip-steps.mjs.
//   node scripts/filmstrip.mjs <packaged executable | unpacked> <outDir>
//   SQ_FILM=delete,duplicate,…  picks journeys (others run only their setup)
//   unpacked = this checkout's Electron + the editor at SQ_EDITOR_URL (default :3071)
// Isolated like profile.mjs: temp user data, projects root, downloads and MCP home.
import { _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { journeys as base } from './journeys.mjs';

const [exe, out] = process.argv.slice(2);
if (!exe || !out) { console.error('usage: node scripts/filmstrip.mjs <executable|unpacked> <outDir>'); process.exit(2); }
const only = (process.env.SQ_FILM ?? 'select,type,class-edit,page-switch,duplicate,delete,undo,redo,reorder-layers,reorder-canvas,draw-frame').split(',');
const root = path.resolve(import.meta.dirname, '..');
const fixture = path.resolve(root, '../app/e2e/fixtures/release-project');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A user's canvas drag holds before letting go: past the bridge's 500 ms rescan
// throttle (the 2026-11-08 one-slot-off drop only showed on such drags).
const rc = base.find(j => j.name === 'reorder-canvas');
const held = { name: 'held-reorder-canvas', before: rc.before, after: rc.after, run: async ctx => {
  const p = ctx.preview(), page = ctx.page;
  const from = await p.getByText('Release widget', { exact: true }).boundingBox(), to = await p.getByText('Hello post', { exact: true }).boundingBox();
  await page.mouse.move(from.x + 20, from.y + from.height / 2); await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + from.height / 2 + 10, { steps: 5 });
  await page.mouse.move(to.x + 20, to.y + to.height - 2, { steps: 40 });
  await sleep(1200);
  await page.mouse.up();
} };
const journeys = base.flatMap(j => (j.name === 'reorder-canvas' ? [j, held] : [j]));

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-film-'));
const env = { ...process.env, SQ_USER_DATA: path.join(temp, 'profile'), SQ_PROJECTS_ROOT: path.join(temp, 'projects'),
  SQ_DOWNLOADS: path.join(temp, 'downloads'), STARQUIX_MCP_HOME: path.join(temp, 'mcp-home') };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch(exe === 'unpacked'
  ? { args: [root], env: { ...env, SQ_EDITOR_URL: process.env.SQ_EDITOR_URL ?? 'http://127.0.0.1:3071/' } }
  : { executablePath: exe, env });
try {
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor({ timeout: 60_000 });
  const cdp = await page.context().newCDPSession(page);
  const preview = () => page.locator('iframe[title$=" preview"]:visible').first().contentFrame();
  const select = async el => { const b = await el.boundingBox(); await page.keyboard.down('ControlOrMeta');
    try { await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); } finally { await page.keyboard.up('ControlOrMeta'); } };
  const ctx = { page, cdp, preview, select, sleep, fixture, BOOT: 180_000,
    projectDir: () => path.join(temp, 'projects', new URL(page.url()).pathname.split('/').pop()) };
  let frames = [];
  cdp.on('Page.screencastFrame', f => { frames.push({ t: f.metadata.timestamp * 1000, data: f.data });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); });
  for (const j of journeys) {
    const step = async (hook) => { try { await hook?.(ctx); return ''; } catch (e) { return String(e.message ?? e).split('\n')[0]; } };
    if (!only.includes(j.name)) { const e = await step(j.setup); if (e) console.error(`[film] ${j.name} setup: ${e}`); continue; }
    const be = await step(j.before); if (be) { console.error(`[film] ${j.name} before: ${be}`); continue; }
    await sleep(400); frames = [];
    await cdp.send('Page.startScreencast', { format: 'png', maxWidth: 1440, maxHeight: 900, everyNthFrame: 1 });
    await sleep(200);
    const t0 = Date.now(); const err = await step(j.run); const runMs = Date.now() - t0;
    await sleep(1500); // the write → refresh lands after the gesture's own end condition
    await cdp.send('Page.stopScreencast'); await sleep(100);
    const dir = path.join(out, j.name); await fs.mkdir(dir, { recursive: true });
    for (const f of frames) await fs.writeFile(path.join(dir, `${String(Math.round(f.t - t0) + 1000).padStart(6, '0')}.png`), Buffer.from(f.data, 'base64'));
    await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ runMs, offset: 1000, error: err || null }));
    const ae = await step(j.after);
    console.error(`[film] ${j.name} run ${runMs} ms, ${frames.length} frames${err ? ` ERROR ${err}` : ''}${ae ? ` AFTER ${ae}` : ''}`);
  }
} finally {
  await app.close().catch(() => {});
  await fs.rm(temp, { recursive: true, force: true });
}
