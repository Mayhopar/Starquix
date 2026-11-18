// scripts/profile.mjs (the perf harness): it launches the real app, so these check its pure parts and its env.
import { expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { cpuTimes, cpuDelta } from '../scripts/cpu-times.mjs';

const root = path.resolve(import.meta.dirname, '..');
const tempKeys = src => [...src.matchAll(/(\w+): path\.join\(temp, /g)].map(m => m[1]);

it('isolates the profiled app like an e2e launch (a run never repoints the real ~/.starquix-mcp launcher)', async () => {
  const helpers = await fs.readFile(path.join(root, 'e2e/helpers.mjs'), 'utf8');
  const e2e = tempKeys(helpers.slice(helpers.indexOf('export function setupEnv')).split('\n}\n')[0]);
  const profile = tempKeys(await fs.readFile(path.join(root, 'scripts/profile.mjs'), 'utf8'));
  expect(e2e).toContain('STARQUIX_MCP_HOME');
  for (const key of e2e) expect(profile, key).toContain(key);
});

it('labels CPU time per process of the app and sums the deltas per label', () => {
  const ps = (main, editor, runner, esbuild, born) => [
    `  100     1 ${main} /x/Starquix.app/Contents/MacOS/Starquix`,
    `  101   100 0:02.00 /x/Starquix Helper (GPU) --type=gpu-process`,
    `  102   100 ${editor} /x/Starquix Helper (Renderer) --type=renderer --renderer-client-id=4`,
    '  103   100 0:00.50 /x/Starquix Helper (Renderer) --type=renderer --renderer-client-id=7',
    '  104   100 0:00.10 /x/Starquix Helper (Renderer) --type=renderer --renderer-client-id=9',
    '  105   100 0:00.20 /x/Starquix Helper --type=utility --utility-sub-type=network.mojom.NetworkService',
    '  106   100 0:03.00 /x/Starquix Helper --type=utility --utility-sub-type=tracing.mojom.TracingService',
    `  107   100 ${runner} /x/Starquix /x/Resources/app/src/runner.mjs`,
    `  108   107 ${esbuild} /x/node_modules/@esbuild/darwin-arm64/bin/esbuild --service=0.25.0 --ping`,
    ...born ? ['  109   100 0:00.30 /usr/bin/git status'] : ['  110   100 0:09.00 /x/exits-mid-step'],
    '  200     1 1:02:03.50 /usr/bin/unrelated',
    '  201   200 0:01.00 /usr/bin/unrelated-child',
  ].join('\n');
  const frames = [[102, 'starquix://app/editor/browser_x'], [103, 'http://127.0.0.1:4321/'], [102, 'about:blank']];
  const a = cpuTimes(ps('0:01.00', '1:59.99', '0:04.00', '0:00.00'), 100, frames);
  expect(Object.fromEntries([...a].map(([pid, v]) => [pid, v.k]))).toEqual({
    100: 'main', 101: 'gpu', 102: 'editor', 103: 'preview', 104: 'renderer', 105: 'utility', 106: 'tracing', 107: 'astro', 108: 'astro', 110: 'other' });
  expect(a.get(102).s).toBeCloseTo(119.99); // m:ss.cc
  expect(cpuTimes(ps('0:01.00', '0:01.00', '0:00.00', '0:00.00'), 200, []).get(200).s).toBeCloseTo(3723.5); // h:mm:ss.cc
  const b = cpuTimes(ps('0:01.25', '2:00.49', '0:04.70', '0:00.30', true), 100, frames);
  expect(cpuDelta(a, b)).toEqual({ main: 250, gpu: 0, editor: 500, preview: 0, renderer: 0, utility: 0, tracing: 0, astro: 1000, other: 300 });
});
