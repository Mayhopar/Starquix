// Long-lived probe session: one invisible isolated app + a token-guarded loopback eval endpoint, so snippets can poke the live editor without a
// 30 s boot each time.   node probe/session.mjs <editorUrl> <fixtureDir> <stateFile>   (state file = { port, token, temp, id, pid })
// POST http://127.0.0.1:<port>/eval  (header x-token) body = async function body with `ctx` in scope → JSON result.
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { startApp, importProject, preview, select, sleep } from './driver.mjs';
import { recorderInit } from './recorder.mjs';

const [editorUrl, fixtureDir, stateFile] = process.argv.slice(2);
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sqprobe-session-'));
const h = await startApp({ temp, editorUrl });
const { app, page } = h;
page.on('dialog', d => d.accept().catch(() => {}));
const chunks = [];
await page.exposeBinding('__probePush', (src, chunk) => { chunks.push(chunk); });
await page.addInitScript(recorderInit); await page.evaluate(recorderInit);
await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor({ timeout: 60_000 });
const id = await importProject(page, 'Probe session', fixtureDir);
const loc = page.locator('iframe[title$=" preview"]:visible').first().contentFrame();
await loc.locator('img[alt="Probe image 1"]').waitFor({ timeout: 300_000 });
await page.locator('iframe[data-viewport]').first().evaluate(el => new Promise(r => { const t = () => (getComputedStyle(el).opacity === '1' ? r() : setTimeout(t, 20)); t(); }));
const frame = await (await page.locator('iframe[title$=" preview"]:visible').first().elementHandle()).contentFrame();
await frame.evaluate(recorderInit);
const ctx = { app, page, frame, loc, h, chunks, id, temp, projectDir: path.join(temp, 'projects', id), select, sleep, preview, nowE: () => performance.timeOrigin + performance.now(), importProject, recorderInit };
const token = randomBytes(12).toString('hex');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const server = http.createServer((req, res) => {
  if (req.headers['x-token'] !== token) { res.writeHead(403).end(); return; }
  let body = ''; req.on('data', d => { body += d; });
  req.on('end', async () => {
    try { const r = await new AsyncFunction('ctx', body)(ctx); res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(r ?? null)); }
    catch (e) { res.writeHead(500, { 'content-type': 'text/plain' }).end(String(e.stack ?? e)); }
  });
});
server.listen(0, '127.0.0.1', async () => {
  await fs.writeFile(stateFile, JSON.stringify({ port: server.address().port, token, temp, id, pid: process.pid }));
  console.log('[session] ready', server.address().port, temp, id);
});
const bye = async () => { await app.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true, maxRetries: 5 }).catch(() => {}); process.exit(0); };
process.on('SIGTERM', bye); process.on('SIGINT', bye);
