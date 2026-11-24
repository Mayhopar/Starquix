import { createRequire } from 'node:module';
import { afterEach, describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { linkNodeModules, missingPackages, installPackages } from '../src/deps.mjs';

const owned = [];
const tmp = async () => { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-desktop-')); owned.push(dir); return dir; };
afterEach(async () => { await Promise.all(owned.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); });
const TEMPLATE = path.resolve(import.meta.dirname, '../../preview-template');

describe('linkNodeModules (no extras: one link to the shared runtime)', () => {
  it('links a missing node_modules to the shared deps', async () => {
    const deps = await tmp(); const project = await tmp();
    await linkNodeModules(project, deps, null);
    expect(await fs.realpath(path.join(project, 'node_modules'))).toBe(await fs.realpath(deps));
  });

  it('relinks a link that points elsewhere (app moved/updated)', async () => {
    const deps = await tmp(); const old = await tmp(); const project = await tmp();
    await fs.symlink(old, path.join(project, 'node_modules'), 'junction');
    await linkNodeModules(project, deps, null);
    expect(await fs.realpath(path.join(project, 'node_modules'))).toBe(await fs.realpath(deps));
  });

  it('relinks a dangling link (bundle moved away)', async () => {
    const deps = await tmp(); const project = await tmp();
    await fs.symlink(path.join(deps, 'gone'), path.join(project, 'node_modules'), 'junction');
    await linkNodeModules(project, deps, null);
    expect(await fs.realpath(path.join(project, 'node_modules'))).toBe(await fs.realpath(deps));
  });

  it('keeps a real node_modules folder (import installed its own deps)', async () => {
    const deps = await tmp(); const project = await tmp();
    await fs.mkdir(path.join(project, 'node_modules'));
    await fs.writeFile(path.join(project, 'node_modules', 'marker'), 'x');
    await linkNodeModules(project, deps, null);
    expect(await fs.readFile(path.join(project, 'node_modules', 'marker'), 'utf8')).toBe('x');
  });
});


const NPM = path.resolve(import.meta.dirname, '../runtime-deps/node_modules/npm/bin/npm-cli.js');
async function pkg(dir, name, files) {
  await fs.mkdir(path.join(dir, name), { recursive: true });
  await fs.writeFile(path.join(dir, name, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'index.js', ...files.manifest }));
  await fs.writeFile(path.join(dir, name, 'index.js'), files.index);
}

describe('missingPackages', () => {
  it('lists declared packages the shared runtime lacks, never @types', async () => {
    const shared = await tmp(); const project = await tmp();
    await pkg(shared, 'astro', { index: '' });
    await fs.writeFile(path.join(project, 'package.json'), JSON.stringify({
      dependencies: { astro: '^4', 'astro-seo': '^0.8.3' }, devDependencies: { '@tailwindcss/x': '^1', '@types/node': '^20' } }));
    expect(await missingPackages(project, shared)).toEqual([['@tailwindcss/x', '^1'], ['astro-seo', '^0.8.3']]);
  });

  // #13 (audit 2026-11-24): an imported Tailwind 4 site ran on the runtime's Tailwind 3.4 — only @tailwindcss/vite was missing.
  it('also lists a package the runtime carries at an older major than the site declares; Astro\'s own and older majors stay shared', async () => {
    const shared = await tmp(); const project = await tmp();
    for (const [name, version] of [['astro', '7.4.7'], ['@astrojs/mdx', '8.1.3'], ['tailwindcss', '3.4.19'], ['typescript', '6.0.3'], ['zod', '4.6.7']]) {
      await pkg(shared, name, { manifest: { version }, index: '' });
    }
    await fs.writeFile(path.join(project, 'package.json'), JSON.stringify({ dependencies: { astro: '^8.0.0', '@astrojs/mdx': '^9.0.0',
      tailwindcss: '^4.1.11', '@tailwindcss/vite': '^4.1.11', zod: '^3.23.8', typescript: '^5.7.2' } }));
    expect(await missingPackages(project, shared)).toEqual([['@tailwindcss/vite', '^4.1.11'], ['tailwindcss', '^4.1.11']]);
  });
});

describe('installPackages + merged node_modules', () => {
  it('installs extras once, then node resolves shared AND extras (and their deps) from the project', async () => {
    const shared = await tmp(); const project = await tmp(); const local = await tmp();
    await pkg(shared, 'astro', { index: 'module.exports = "shared-astro";' });
    await fs.mkdir(path.join(shared, '.bin')); await fs.symlink('../astro/index.js', path.join(shared, '.bin/astro')); // as npm links a bin
    await pkg(local, 'extra-dep', { index: 'module.exports = "dep";' });
    await pkg(local, 'extra', { manifest: { bin: { 'extra-cli': 'index.js' }, dependencies: { 'extra-dep': `file:${path.join(local, 'extra-dep')}` } }, index: 'module.exports = require("extra-dep") + "+" + require("astro");' });
    const packages = [['extra', `file:${path.join(local, 'extra')}`]];
    const extras = await installPackages(project, packages, { npmCli: NPM });
    await linkNodeModules(project, shared, extras);
    const req = createRequire(path.join(project, 'src/x.js'));
    expect(req('astro')).toBe('shared-astro');
    expect(req('extra')).toBe('dep+shared-astro');
    // CLIs too: `npx astro` in the project must run the shared Astro, never a global one (2026-11-07: Homebrew's 5.7.5).
    if (process.platform === 'win32') { // copies (a file symlink needs admin rights): npm's .cmd shims resolve ..\<pkg> from the folder
      expect(await fs.readFile(path.join(project, 'node_modules/.bin/astro'), 'utf8')).toBe(await fs.readFile(path.join(shared, '.bin/astro'), 'utf8'));
      expect((await fs.readdir(path.join(project, 'node_modules/.bin'))).filter(n => n.startsWith('extra-cli'))).not.toEqual([]);
    } else {
      expect(await fs.realpath(path.join(project, 'node_modules/.bin/astro'))).toBe(await fs.realpath(path.join(shared, 'astro/index.js')));
      expect(await fs.realpath(path.join(project, 'node_modules/.bin/extra-cli'))).toBe(await fs.realpath(path.join(project, '.sq/deps/node_modules/extra/index.js')));
    }
    const stamp = await fs.stat(path.join(project, '.sq/deps/installed.json'));
    await installPackages(project, packages, { npmCli: NPM }); // same list: no reinstall
    expect((await fs.stat(path.join(project, '.sq/deps/installed.json'))).mtimeMs).toBe(stamp.mtimeMs);
    await linkNodeModules(project, shared, null); // extras gone → back to the plain link (our merged dir is ours to replace)
    expect(await fs.realpath(path.join(project, 'node_modules'))).toBe(await fs.realpath(shared));
  }, 120_000);

  it('the site\'s own newer major of a runtime package wins; what the extras pulled in never shadows the runtime (#13)', async () => {
    const shared = await tmp(); const project = await tmp(); const local = await tmp();
    await pkg(shared, 'astro', { index: 'module.exports = "shared-astro";' });
    await pkg(shared, 'tailwindcss', { manifest: { version: '3.4.19' }, index: 'module.exports = "tailwind 3";' });
    await pkg(shared, 'dep', { index: 'module.exports = "shared dep";' });
    await pkg(local, 'dep', { manifest: { version: '2.0.0' }, index: 'module.exports = "extras dep";' });
    await pkg(local, 'tailwindcss', { manifest: { version: '4.1.11', dependencies: { dep: `file:${path.join(local, 'dep')}` } },
      index: 'module.exports = "tailwind 4 + " + require("dep");' });
    const extras = await installPackages(project, [['tailwindcss', `file:${path.join(local, 'tailwindcss')}`]], { npmCli: NPM });
    await linkNodeModules(project, shared, extras);
    const req = createRequire(path.join(project, 'src/x.js'));
    expect(req('tailwindcss')).toBe('tailwind 4 + extras dep'); // its own dependencies still resolve from the extras
    expect(req('dep')).toBe('shared dep');
    expect(req('astro')).toBe('shared-astro');
  }, 120_000);

  it('an install that fails names the packages and says what to do', async () => {
    const project = await tmp(); const saved = { ...process.env };
    Object.assign(process.env, { npm_config_registry: 'http://127.0.0.1:9/', npm_config_fetch_retries: '0', npm_config_cache: path.join(project, 'cache') }); // offline
    try {
      await expect(installPackages(project, [['astro-seo', '^0.8.3']], { npmCli: NPM }))
        .rejects.toThrow('This site needs packages that could not be installed (astro-seo@^0.8.3). Check the internet connection and reopen the project.');
      await expect(fs.stat(path.join(project, '.sq/deps/installed.json'))).rejects.toThrow(); // a failed install is retried next open
    } finally { process.env = saved; }
  }, 120_000);
});
