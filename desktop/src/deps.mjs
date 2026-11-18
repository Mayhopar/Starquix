// A project's packages: the ONE shared runtime (Astro, MDX, Tailwind…) plus, for an imported
// site that declares more, its own extras installed once into <project>/.sq/deps with the
// bundled npm. node_modules is then a merged folder of links (shared first, extras after), so
// both Node and Vite (preserveSymlinks) resolve every package from inside the project.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

/** Preload for every spawned npm: keeps it out of the macOS Dock (see no-title.cjs). */
export const NO_TITLE = fileURLToPath(new URL('./no-title.cjs', import.meta.url));

const run = promisify(execFile);
const MERGED = '.sq-merged'; // marks a node_modules we built (a user's own real one is kept)
const absent = error => { if (error.code === 'ENOENT') return null; throw error; };
// Windows: a file symlink needs admin rights or Developer Mode. npm's .cmd/.ps1 shims find ..\<pkg> from their own
// folder, so a copy (first one wins, like the links) runs the same package.
const linkBin = (from, to) => (process.platform === 'win32' ? fs.copyFile(from, to, fs.constants.COPYFILE_EXCL) : fs.symlink(from, to));

/** Declared packages (dependencies + devDependencies) the shared runtime lacks: [[name, range]]. */
export async function missingPackages(projectDir, sharedDir) {
  const manifest = JSON.parse(await fs.readFile(path.join(projectDir, 'package.json'), 'utf8').catch(() => '{}'));
  const declared = { ...manifest.devDependencies, ...manifest.dependencies };
  const missing = [];
  for (const [name, range] of Object.entries(declared)) {
    if (name.startsWith('@types/') || typeof range !== 'string') continue; // types never run
    if (!await fs.stat(path.join(sharedDir, name)).catch(absent)) missing.push([name, range]);
  }
  return missing.sort(([a], [b]) => a.localeCompare(b));
}

/** Installs `packages` ([[name, range]]) into <project>/.sq/deps once per list; returns its node_modules (or null). */
export async function installPackages(projectDir, packages, { npmCli, signal, timeoutMs = 300_000 }) {
  const root = path.join(projectDir, '.sq', 'deps');
  if (!packages.length) return null;
  const specs = packages.map(([name, range]) => `${name}@${range}`);
  const key = createHash('sha256').update(JSON.stringify(packages)).digest('hex');
  const stamp = path.join(root, 'installed.json');
  if (JSON.parse(await fs.readFile(stamp, 'utf8').catch(() => '{}')).key === key) return path.join(root, 'node_modules');
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ private: true, dependencies: Object.fromEntries(packages) }, null, 2));
  try {
    // No lifecycle scripts (imported code never runs at install); peers (astro…) come from the shared runtime.
    await run(process.execPath, ['--require', NO_TITLE, npmCli, 'install', '--install-links', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund', '--omit=dev', '--loglevel=error'],
      { cwd: root, signal, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', npm_config_update_notifier: 'false' } });
  } catch (error) {
    if (signal?.aborted) throw error;
    console.error('[desktop deps]', String(error.stderr || error.message));
    throw new Error(`This site needs packages that could not be installed (${specs.join(', ')}). Check the internet connection and reopen the project.`);
  }
  await fs.writeFile(stamp, JSON.stringify({ key, specs }));
  return path.join(root, 'node_modules');
}

async function packageEntries(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.name.startsWith('.')) continue;
    if (e.name.startsWith('@')) for (const s of await fs.readdir(path.join(dir, e.name)).catch(() => [])) out.push(`${e.name}/${s}`);
    else out.push(e.name);
  }
  return out;
}

/** <project>/node_modules: a link to the shared runtime, or — with extras — a merged folder of
 *  per-package links (shared wins: one Astro for every project). A real node_modules the
 *  project brought itself is kept as is. Rebuilt on every open (self-healing, cheap). */
export async function linkNodeModules(projectDir, sharedDir, extrasDir) {
  const link = path.join(projectDir, 'node_modules');
  const stat = await fs.lstat(link).catch(absent);
  if (stat?.isDirectory() && !await fs.stat(path.join(link, MERGED)).catch(absent)) return; // the user's own
  if (!extrasDir) {
    if (stat?.isSymbolicLink() && await fs.realpath(link).catch(() => null) === await fs.realpath(sharedDir)) return;
    await fs.rm(link, { recursive: true, force: true });
    await fs.symlink(sharedDir, link, 'junction'); // 'junction' = no admin rights on Windows
    return;
  }
  const staging = `${link}.sq-${process.pid}-${Date.now()}`;
  await fs.mkdir(staging);
  const linked = new Set();
  for (const [dir, names] of [[sharedDir, await packageEntries(sharedDir)], [extrasDir, await packageEntries(extrasDir)]]) {
    for (const name of names) {
      if (linked.has(name)) continue; linked.add(name);
      await fs.mkdir(path.dirname(path.join(staging, name)), { recursive: true });
      await fs.symlink(path.join(dir, name), path.join(staging, name), 'junction');
    }
  }
  // CLIs as well: without .bin, `npx astro` in the project ran whatever Astro the machine had globally.
  await fs.mkdir(path.join(staging, '.bin'));
  for (const dir of [sharedDir, extrasDir]) {
    for (const name of await fs.readdir(path.join(dir, '.bin')).catch(() => [])) {
      await linkBin(path.join(dir, '.bin', name), path.join(staging, '.bin', name)).catch(e => { if (e.code !== 'EEXIST') throw e; });
    }
  }
  await fs.writeFile(path.join(staging, MERGED), '');
  await fs.rm(link, { recursive: true, force: true });
  await fs.rename(staging, link);
}
