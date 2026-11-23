// Dev sandbox: the real desktop app running THIS checkout's editor + bridge, in a throwaway
// profile, with a sample project already imported — then the window is yours. Quit it (⌘Q)
// and everything is cleaned up. Never touches the installed Starquix, ~/Starquix or ~/.starquix-mcp.
//   npm --prefix desktop run sandbox
// The sample is app/e2e/fixtures/release-project with its home page swapped for a measuring
// playground (Option-hover distances); every other page of the fixture is left as is.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { setupEnv, importFixture, launch, fixture, root, BOOT } from '../e2e/helpers.mjs';

const PORT = Number(process.env.SQ_SANDBOX_PORT ?? 3071); // own port: never collides with a :3061 dev editor
const editorUrl = `http://127.0.0.1:${PORT}/`;

const PLAYGROUND = `---
import Layout from '../layouts/Layout.astro';
---
<Layout title="Measure playground">
  <main class="mx-auto max-w-4xl p-12 space-y-12">
    <h1 class="text-3xl font-semibold">Option-hover playground</h1>
    <section class="flex items-start gap-6">
      <div class="h-32 w-40 bg-sky-200 p-4">Side A</div>
      <div class="h-24 w-56 bg-sky-300 p-4">Side B</div>
      <div class="mt-6 h-40 w-32 bg-sky-400 p-4">Side C</div>
    </section>
    <section class="grid grid-cols-3 gap-8">
      <div class="h-20 bg-rose-200 p-4">Grid 1</div>
      <div class="h-20 bg-rose-200 p-4">Grid 2</div>
      <div class="h-20 bg-rose-200 p-4">Grid 3</div>
      <div class="h-20 bg-rose-300 p-4">Grid 4</div>
      <div class="h-20 bg-rose-300 p-4">Grid 5</div>
      <div class="h-20 bg-rose-300 p-4">Grid 6</div>
    </section>
    <section class="relative h-80 bg-amber-100 p-10">
      <div class="h-24 w-48 bg-amber-300 p-4">Nested</div>
      <div class="absolute bottom-8 right-12 h-20 w-40 bg-amber-400 p-4">Diagonal</div>
    </section>
  </main>
</Layout>
`;

async function up(url) {
  try { return (await fetch(url)).ok; } catch { return false; }
}

if (await up(editorUrl)) throw new Error(`:${PORT} is taken — set SQ_SANDBOX_PORT to a free port`);
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-sandbox-'));
// detached → its own process group, so one kill also stops the vite child npm starts
const editor = spawn('npm', ['--prefix', path.resolve(root, '../app'), 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
  { stdio: 'inherit', detached: true });
let app;
let cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  await app?.close().catch(() => {});
  try { process.kill(-editor.pid); } catch {}
  await fs.rm(temp, { recursive: true, force: true }).catch(() => {});
}
process.on('SIGINT', () => cleanup().then(() => process.exit(130)));
process.on('SIGTERM', () => cleanup().then(() => process.exit(143)));

try {
  for (let waited = 0; !(await up(editorUrl)); waited += 500) {
    if (waited > 90_000 || editor.exitCode !== null) throw new Error('editor dev server did not start');
    await sleep(500);
  }
  const sample = path.join(temp, 'sample-project');
  await fs.cp(fixture, sample, { recursive: true, filter: f => !f.includes('node_modules') });
  await fs.writeFile(path.join(sample, 'src/pages/index.astro'), PLAYGROUND);

  let page;
  ({ app, page } = await launch({ ...setupEnv(temp), SQ_EDITOR_URL: editorUrl }));
  await importFixture(page, 'Measure playground', sample);
  await page.locator('iframe[data-viewport]').first().waitFor({ state: 'visible', timeout: BOOT });
  console.log('\n[sandbox] Ready: select a box, hold Option (⌥), hover another box. Quit the app (⌘Q) to clean up.\n');
  await new Promise(resolve => app.process().once('exit', resolve));
} finally {
  await cleanup();
}
