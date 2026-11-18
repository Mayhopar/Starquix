// Probe fixtures. Generated ones (make-fixtures / make-comp-fixture / make-compbig-fixture; python3 + PIL for the images) are built into a scratch dir
// when missing and only the missing ones are copied in: a fixture that exists is never touched. The owner fixture is PRIVATE (a copy of the owner's
// real project): it is never generated, only prepared from --owner-copy (prep-owner-copy.mjs) or found in the fixtures dir.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const probeDir = import.meta.dirname;
const script = name => path.join(probeDir, name);
export const GENERATED = ['tiny', 'big', 'huge', 'bigpage', 'comp', 'comp2', 'compbig'];
export const PRIVATE = ['owner'];

export const defaultRun = (file, args) => new Promise((resolve, reject) => {
  execFile(process.execPath, [file, ...args], { maxBuffer: 1 << 26 }, (error, stdout, stderr) => {
    if (error) reject(new Error(`${path.basename(file)} failed: ${error.message}\n${String(stderr).slice(-1500)}`)); else resolve(stdout);
  });
});

const isDir = p => fs.stat(p).then(s => s.isDirectory(), () => false);

async function buildGenerated(missing, { fixturesDir, run }) {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'sqprobe-fx-'));
  try {
    await run(script('make-fixtures.mjs'), [scratch]); // tiny, big, huge, bigpage: the bases of the component fixtures
    if (missing.includes('comp')) await run(script('make-comp-fixture.mjs'), [scratch, 'comp']);
    if (missing.includes('comp2') || missing.includes('compbig')) await run(script('make-comp-fixture.mjs'), [scratch, 'comp2']);
    if (missing.includes('compbig')) await run(script('make-compbig-fixture.mjs'), [scratch]);
    await fs.mkdir(fixturesDir, { recursive: true });
    for (const name of missing) await fs.cp(path.join(scratch, name), path.join(fixturesDir, name), { recursive: true });
  } finally { await fs.rm(scratch, { recursive: true, force: true }); }
}

/** names -> { name: { dir } | { skipped } } (dryRun: missing ones come back as { dir, missing: true } and nothing is built). */
export async function resolveFixtures(names, { fixturesDir, ownerCopy, ownerPage = 'src/pages/index.astro', run = defaultRun, dryRun = false }) {
  for (const name of names) if (![...GENERATED, ...PRIVATE].includes(name)) throw new Error(`unknown fixture ${name} (known: ${[...GENERATED, ...PRIVATE].join(', ')})`);
  const out = {}; const missing = [];
  for (const name of names) {
    const dir = path.join(fixturesDir, name);
    if (await isDir(dir)) out[name] = { dir };
    else if (name === 'owner' && !ownerCopy) out[name] = { skipped: `private owner fixture missing: pass --owner-copy <dir> (or put it at ${dir})` };
    else if (dryRun) out[name] = { dir, missing: true };
    else if (name === 'owner') { await run(script('prep-owner-copy.mjs'), [ownerCopy, dir, ownerPage]); out[name] = { dir }; }
    else { missing.push(name); out[name] = { dir }; }
  }
  if (missing.length) await buildGenerated(missing, { fixturesDir, run });
  return out;
}
