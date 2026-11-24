// A site still on Astro ≤6 file shapes moves to the shared runtime's Astro once, before a boot: its pins (+ the
// @astrojs/tailwind override), its content config (loaders, src/content.config.*) and the APIs Astro removed in its
// pages. The rewrite is kept only when it builds to the same pages WITHOUT our compat shim and its package.json
// resolves on npm the way Pages/Vercel install it; otherwise nothing changes, the site keeps deploying on its own
// Astro (the canvas renders it through the compat shim), and .sq/astro-upgrade.json remembers why until its files change.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { parse } from '@babel/parser';
import { NO_TITLE, astroPackage, major } from './deps.mjs';
import { buildSite } from './site-build.mjs';

const run = promisify(execFile);
const CONTENT_CONFIG = /^src\/content\/config\.(ts|js|mjs|mts)$/;
const MODERN_CONFIG = /^src\/content\.config\.(ts|js|mjs|mts)$/;
const SOURCE = /^src\/.+\.(astro|ts|tsx|js|jsx|mjs|mts)$/;
const OTHER_LOCKS = ['pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock'];
const SKIP = new Set(['node_modules', '.sq', '.git', 'dist', '.astro']);

/** What a legacy collection folder holds: entries (markdown) or data (json/yaml). */
const loaderFor = (name, kind) => `loader: glob({ pattern: ${kind === 'data' ? "'**/*.{json,yaml,yml}'" : "'**/[^_]*.{md,mdx,markdown}'"}, base: './src/content/${name}' })`;
const keyFor = name => /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
const splice = (text, edits) => [...edits].sort((a, b) => b[0] - a[0]).reduce((t, [s, e, r]) => t.slice(0, s) + r + t.slice(e), text);

/** The legacy config rewritten for src/content.config.*: every collection gets a glob loader, folders Astro 4
 *  auto-generated are declared, relative imports re-based. null = a shape this does not rewrite (spread, computed…). */
export function upgradeContentConfig(text, dirs) {
  let ast; try { ast = parse(text, { sourceType: 'module', plugins: ['typescript'] }); } catch { return null; }
  const consts = new Map(); const edits = []; let defineImported = false;
  for (const node of ast.program.body) {
    if (node.type === 'ImportDeclaration') {
      if (node.source.value === 'astro:content' && node.specifiers.some(s => s.imported?.name === 'defineCollection')) defineImported = true;
      if (node.source.value.startsWith('.')) {
        const moved = path.posix.relative('src', path.posix.join('src/content', node.source.value));
        edits.push([node.source.start, node.source.end, JSON.stringify(moved.startsWith('.') ? moved : `./${moved}`)]);
      }
    }
    const decl = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
    if (decl?.type === 'VariableDeclaration') for (const v of decl.declarations) if (v.id.type === 'Identifier' && v.init) consts.set(v.id.name, v.init);
  }
  const collections = consts.get('collections');
  if (collections?.type !== 'ObjectExpression') return null;
  const declared = new Set();
  for (const prop of collections.properties) {
    if (prop.type !== 'ObjectProperty' || prop.computed) return null;
    const key = prop.key.type === 'Identifier' ? prop.key.name : prop.key.type === 'StringLiteral' ? prop.key.value : null;
    const call = prop.value.type === 'Identifier' ? consts.get(prop.value.name) : prop.value;
    const arg = call?.type === 'CallExpression' && call.callee.name === 'defineCollection' ? call.arguments[0] : null;
    if (!key || arg?.type !== 'ObjectExpression') return null;
    declared.add(key);
    const named = name => arg.properties.find(p => p.type === 'ObjectProperty' && !p.computed && p.key.name === name);
    if (named('loader')) continue;
    const type = named('type');
    const kind = type ? type.value.value : 'content';
    if (kind !== 'content' && kind !== 'data') return null;
    edits.push(type ? [type.start, type.end, loaderFor(key, kind)] : [arg.start + 1, arg.start + 1, ` ${loaderFor(key, kind)},`]);
  }
  const missing = dirs.filter(d => !declared.has(d.name));
  if (missing.length) {
    const last = collections.properties.at(-1);
    const comma = last && !text.slice(last.end, collections.end - 1).includes(',') ? ',' : '';
    const added = missing.map(d => `${keyFor(d.name)}: defineCollection({ ${loaderFor(d.name, d.kind)} })`).join(', ');
    edits.push([collections.end - 1, collections.end - 1, `${comma}${last ? ' ' : ''}${added}${last ? '' : ' '}`]);
  }
  const imports = `import { glob } from 'astro/loaders';\n${missing.length && !defineImported ? "import { defineCollection } from 'astro:content';\n" : ''}`;
  return imports + splice(text, edits);
}

/** A config for a site whose folders Astro 4 auto-generated (it had none, or our empty one). */
const generatedConfig = dirs => `import { defineCollection } from 'astro:content';\nimport { glob } from 'astro/loaders';\n\nexport const collections = {\n${
  dirs.map(d => `  ${keyFor(d.name)}: defineCollection({ ${loaderFor(d.name, d.kind)} }),\n`).join('')}};\n`;

/** Receivers whose `.slug` is a route param or frontmatter, never a collection entry's. */
const NOT_ENTRY = new Set(['params', 'props', 'data', 'frontmatter', 'Astro', 'query', 'searchParams', 'url', 'route']);
const ASTRO_GLOB = /\bAstro\.glob(?:<[^(]*>)?\(\s*('[^']*'|"[^"]*"|`[^`$]*`)\s*\)/g;

/** Removed Astro APIs replaced in one page/component/module. Unchanged text = nothing to do. */
export function upgradeSource(text, rel) {
  let used = false;
  let t = text.replace(/\bgetEntryBySlug\b/g, 'getEntry').replace(/\bViewTransitions\b/g, 'ClientRouter')
    .replace(ASTRO_GLOB, 'Object.values(import.meta.glob($1, { eager: true }))')
    .replace(/(?<![\w$.])([A-Za-z_$][\w$]*)\.slug\b/g, (m, obj) => NOT_ENTRY.has(obj) ? m : `${obj}.id`)
    .replace(/(?<![\w$.])([A-Za-z_$][\w$]*)\.render\(\s*\)/g, (m, obj) => obj === 'Astro' ? m : (used = true, `render(${obj})`));
  if (!used || /\bimport\s*\{[^}]*\brender\b[^}]*\}\s*from\s*['"]astro:content['"]/.test(t)) return t;
  const existing = /import\s*\{([^}]*)\}\s*from\s*(['"])astro:content\2/.exec(t);
  if (existing) return t.slice(0, existing.index) + `import {${existing[1].replace(/,?\s*$/, '')}, render } from ${existing[2]}astro:content${existing[2]}` + t.slice(existing.index + existing[0].length);
  const line = "import { render } from 'astro:content';\n";
  if (!rel.endsWith('.astro')) return line + t;
  const fence = /^\s*---\r?\n/.exec(t);
  return fence ? t.slice(0, fence[0].length) + line + t.slice(fence[0].length) : `---\n${line}---\n${t}`;
}

/** Pins of every astro/@astrojs package the shared runtime ships, at the runtime's versions; the tailwind override. */
export function upgradePackage(text, versions, { markdownPlugins }) {
  const pkg = JSON.parse(text);
  for (const field of ['dependencies', 'devDependencies']) {
    for (const name of Object.keys(pkg[field] ?? {})) if (astroPackage(name) && versions[name]) pkg[field][name] = `^${versions[name]}`;
  }
  const has = name => pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
  // Satteri renders markdown by default: remark/rehype plugins in the config need the unified pipeline installed.
  if (markdownPlugins && !has('@astrojs/markdown-remark')) pkg.dependencies = { ...pkg.dependencies, '@astrojs/markdown-remark': `^${versions['@astrojs/markdown-remark']}` };
  // Its peer range stops at Astro 5; it runs on 7 (the shared runtime proves it), so hosts must install it anyway.
  if (has('@astrojs/tailwind')) pkg.overrides = { ...pkg.overrides, '@astrojs/tailwind': { ...pkg.overrides?.['@astrojs/tailwind'], astro: '$astro' } };
  // Astro 7 needs Node ≥22.23.4: Vercel picks its Node from engines (a lower pin like 20.x would fail the build).
  const nodePin = pkg.engines?.node;
  if (!nodePin || (!/^\s*>/.test(nodePin) && major(nodePin) < 22)) pkg.engines = { ...pkg.engines, node: '>=22.23.4' };
  const indent = /^\{\r?\n([ \t]+)/.exec(text)?.[1] ?? 2;
  return JSON.stringify(pkg, null, indent) + '\n';
}

/** The whole rewrite, pure: { writes: {rel: text}, removes: [rel] } or { skip: reason }. `files` = the site's text files by rel path. */
export function planUpgrade(files, dirs, versions) {
  let pkg; try { pkg = JSON.parse(files['package.json']); } catch { return { skip: 'unreadable package.json' }; }
  const pin = pkg.dependencies?.astro ?? pkg.devDependencies?.astro;
  if (!(major(pin) < major(versions.astro))) return { skip: `astro ${pin ?? 'missing'}` };
  const writes = {}; const removes = [];
  const config = Object.keys(files).find(f => /^astro\.config\.(mjs|js|ts|mts|cjs)$/.test(f));
  writes['package.json'] = upgradePackage(files['package.json'], versions, { markdownPlugins: !!config && /\b(remarkPlugins|rehypePlugins|remarkRehype)\b/.test(files[config]) });
  const legacy = Object.keys(files).find(f => CONTENT_CONFIG.test(f));
  if (!Object.keys(files).some(f => MODERN_CONFIG.test(f))) {
    if (legacy) {
      const empty = /^\s*export\s+const\s+collections\s*=\s*\{\s*\}\s*;?\s*$/.test(files[legacy]);
      const next = empty ? (dirs.length ? generatedConfig(dirs) : null) : upgradeContentConfig(files[legacy], dirs);
      if (next === null && !(empty && !dirs.length)) return { skip: `content config shape (${legacy})` };
      removes.push(legacy);
      if (next !== null) writes[`src/content.config.${legacy.split('.').pop()}`] = next;
    } else if (dirs.length) writes['src/content.config.ts'] = generatedConfig(dirs);
  }
  for (const [rel, text] of Object.entries(files)) {
    if (!SOURCE.test(rel) || rel.startsWith('src/content/') || MODERN_CONFIG.test(rel)) continue;
    const next = upgradeSource(text, rel);
    if (next !== text) writes[rel] = next;
  }
  return { writes, removes };
}

async function readTree(dir, rel = '') {
  const out = [];
  for (const e of await fs.readdir(path.join(dir, rel), { withFileTypes: true })) {
    if (!rel && SKIP.has(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...await readTree(dir, r)); else if (e.isFile()) out.push(r);
  }
  return out;
}

/** Each src/content/<dir> as a collection Astro 4 would have auto-generated. */
function contentDirs(paths) {
  const by = new Map();
  for (const p of paths) {
    const m = /^src\/content\/([^/_.][^/]*)\/(.+)$/.exec(p); if (!m) continue;
    const kinds = by.get(m[1]) ?? new Set(); by.set(m[1], kinds);
    kinds.add(/\.(json|ya?ml)$/i.test(m[2]) ? 'data' : /\.(md|mdx|markdown|mdoc)$/i.test(m[2]) ? 'content' : 'other');
  }
  return [...by].filter(([, k]) => k.has('content') || k.has('data')).map(([name, k]) => ({ name, kind: k.has('content') ? 'content' : 'data' }));
}

/** HTML text with build hashes blanked: image transforms and bundle names differ per build folder, never per site. */
const normalize = html => html.replace(/[._][A-Za-z0-9_-]{5,12}(?=\.(?:css|js|mjs|webp|avif|png|jpe?g|gif|svg|woff2?)\b)/g, '.#');
export function samePages(before, after) {
  const pages = list => new Map(list.filter(f => f.path.endsWith('.html')).map(f => [f.path, normalize(f.bytes.toString())]));
  const a = pages(before); const b = pages(after);
  for (const p of new Set([...a.keys(), ...b.keys()])) if (a.get(p) !== b.get(p)) return p;
  return null;
}

const versionsIn = async depsDir => Object.fromEntries((await Promise.all(['astro', '@astrojs/mdx', '@astrojs/node', '@astrojs/check', '@astrojs/tailwind', '@astrojs/markdown-remark']
  .map(async n => [n, JSON.parse(await fs.readFile(path.join(depsDir, n, 'package.json'), 'utf8').catch(() => 'null'))?.version]))).filter(([, v]) => v));

const npm = (npmCli, args, cwd) => run(process.execPath, ['--require', NO_TITLE, npmCli, ...args, '--no-audit', '--no-fund', '--loglevel=error'],
  { cwd, timeout: 180_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', npm_config_update_notifier: 'false' } });
/** `name`'s range in package.json text, kept in its own field and indentation. */
function withRange(text, name, range) {
  const pkg = JSON.parse(text);
  for (const field of ['dependencies', 'devDependencies']) if (pkg[field]?.[name]) pkg[field][name] = range;
  return JSON.stringify(pkg, null, /^\{\r?\n([ \t]+)/.exec(text)?.[1] ?? 2) + '\n';
}

/** npm resolving the new pins the way a host's `npm install` does (no tarballs). A package whose peer range refuses the
 *  new Astro (an integration pinned for the old one) moves to its latest version and npm tries again. Returns the final
 *  { pkg, lock } (a new lock only when the site had one); throws { transient } on network trouble, a plain error when npm still refuses. */
async function resolveOnNpm(pkgText, lockText, { npmCli, tmpRoot }) {
  const dir = await fs.mkdtemp(path.join(tmpRoot, 'sq-upgrade-npm-'));
  const bumped = new Set(); let pkg = pkgText;
  try {
    for (;;) {
      // Resolved fresh: the old lock pins the old Astro's integrations (npm refuses them against the new one).
      await fs.writeFile(path.join(dir, 'package.json'), pkg);
      const failure = await npm(npmCli, ['install', '--package-lock-only', '--ignore-scripts'], dir).then(() => null, error => String(error.stderr || error.message));
      if (failure === null) break;
      const blocker = /peer astro@\S+ from (@?[^@\s]+)@/.exec(failure)?.[1];
      if (/ERESOLVE/.test(failure) && blocker && !bumped.has(blocker) && bumped.size < 8) {
        const latest = (await npm(npmCli, ['view', `${blocker}@latest`, 'version'], dir).catch(() => ({ stdout: '' }))).stdout.trim();
        if (latest) { bumped.add(blocker); pkg = withRange(pkg, blocker, `^${latest}`); continue; }
      }
      throw Object.assign(new Error(failure.split('\n').find(l => /npm error (code|peer)/.test(l)) ?? failure.slice(0, 200)),
        { transient: !/ERESOLVE|ETARGET|E404|EBADENGINE/.test(failure) });
    }
    return { pkg, lock: lockText === undefined ? null : await fs.readFile(path.join(dir, 'package-lock.json'), 'utf8') };
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

/** Upgrades `projectDir` in place when it is eligible and verified; returns what happened, never throws for a site's reasons. */
export async function upgradeSite(projectDir, { depsDir, tmpRoot = os.tmpdir(), onDetail = () => {}, verify = resolveOnNpm, signal } = {}) {
  const marker = path.join(projectDir, '.sq', 'astro-upgrade.json');
  // Only a site on the shared Astro (linked, or our merged folder with its extras); a site's own install runs its own.
  const own = await fs.realpath(path.join(projectDir, 'node_modules', 'astro')).catch(() => null);
  if (own && own !== await fs.realpath(path.join(depsDir, 'astro'))) return { status: 'skipped', reason: 'own node_modules' };
  const versions = await versionsIn(depsDir);
  const pkg = JSON.parse(await fs.readFile(path.join(projectDir, 'package.json'), 'utf8').catch(() => 'null'));
  const pin = pkg?.dependencies?.astro ?? pkg?.devDependencies?.astro;
  if (!(major(pin) < major(versions.astro))) return { status: 'skipped', reason: `astro ${pin ?? 'missing'}` }; // every later open: one read
  const paths = await readTree(projectDir);
  if (OTHER_LOCKS.some(l => paths.includes(l))) return { status: 'skipped', reason: 'not an npm lockfile' };
  const files = {};
  for (const p of paths) if (p === 'package.json' || p === 'package-lock.json' || /^astro\.config\./.test(p) || CONTENT_CONFIG.test(p) || MODERN_CONFIG.test(p) || SOURCE.test(p)) files[p] = await fs.readFile(path.join(projectDir, p), 'utf8');
  if (!files['package.json']) return { status: 'skipped', reason: 'no package.json' };
  const key = createHash('sha256').update(JSON.stringify([versions.astro, paths, files])).digest('hex');
  const last = JSON.parse(await fs.readFile(marker, 'utf8').catch(() => '{}'));
  if (last.key === key) return { status: 'skipped', reason: last.reason };
  const dirs = contentDirs(paths);
  const plan = planUpgrade(files, dirs, versions);
  if (plan.skip) return { status: 'skipped', reason: plan.skip }; // already current, or not ours to rewrite
  const remember = async reason => { await fs.mkdir(path.dirname(marker), { recursive: true }); await fs.writeFile(marker, JSON.stringify({ key, reason, at: new Date().toISOString() })); return { status: 'kept', reason }; };
  onDetail(`Upgrading the site to Astro ${versions.astro}`);
  const resolved = await verify(plan.writes['package.json'], files['package-lock.json'], { npmCli: path.join(depsDir, 'npm/bin/npm-cli.js'), tmpRoot })
    .catch(error => error);
  if (resolved instanceof Error) return resolved.transient ? { status: 'later', reason: resolved.message } : remember(`npm: ${resolved.message}`);
  plan.writes['package.json'] = resolved.pkg;
  if (resolved.lock) plan.writes['package-lock.json'] = resolved.lock;
  const stage = await fs.mkdtemp(path.join(tmpRoot, 'sq-upgrade-'));
  try {
    const before = await buildSite(projectDir, { tmpRoot }).catch(error => error);
    if (before instanceof Error) return remember(`does not build today: ${before.message}`);
    const site = path.join(stage, 'site');
    await fs.cp(projectDir, site, { recursive: true, filter: src => !SKIP.has(path.relative(projectDir, src).split(path.sep)[0]) });
    await fs.symlink(await fs.realpath(path.join(projectDir, 'node_modules')), path.join(site, 'node_modules'), 'junction');
    for (const [rel, text] of Object.entries(plan.writes)) await fs.writeFile(path.join(site, rel), text);
    for (const rel of plan.removes) await fs.rm(path.join(site, rel));
    const after = await buildSite(site, { tmpRoot, compat: false }).catch(error => error);
    if (after instanceof Error) return remember(`upgraded site does not build: ${after.message}`);
    const differs = samePages(before, after);
    if (differs) return remember(`upgraded site renders ${differs} differently`);
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
  if (signal?.aborted) return { status: 'later', reason: 'project closed' }; // never write under a newer open
  // Rollback: every file this rewrites or removes, as it was, under .sq/ (never mirrored, never deployed).
  const backup = path.join(projectDir, '.sq', 'astro-upgrade-backup', new Date().toISOString().replace(/[:.]/g, '-'));
  for (const rel of [...Object.keys(plan.writes), ...plan.removes]) {
    if (files[rel] === undefined) continue;
    await fs.mkdir(path.dirname(path.join(backup, rel)), { recursive: true });
    await fs.writeFile(path.join(backup, rel), files[rel]);
  }
  for (const [rel, text] of Object.entries(plan.writes)) {
    const full = path.join(projectDir, rel); const tmp = `${full}.sq-upgrade`;
    await fs.writeFile(tmp, text); await fs.rename(tmp, full);
  }
  for (const rel of plan.removes) await fs.rm(path.join(projectDir, rel), { force: true });
  await fs.rm(marker, { force: true });
  return { status: 'upgraded', files: [...Object.keys(plan.writes), ...plan.removes], backup };
}

/** Astro (≥5) creates its content layer only when a content config exists AT BOOT (core/dev/dev.js): a config
 *  written later (the first collection) is never synced until a restart. So a content-layer site boots with one —
 *  the empty, standard file; the first collection is then a config EDIT. true = written. */
export async function ensureContentConfig(projectDir) {
  const pkg = JSON.parse(await fs.readFile(path.join(projectDir, 'package.json'), 'utf8').catch(() => 'null'));
  if (major(pkg?.dependencies?.astro ?? pkg?.devDependencies?.astro) < 5) return false; // Astro 4 reads src/content/config.*
  const has = async dir => (await fs.readdir(path.join(projectDir, dir)).catch(() => []))
    .some(f => (dir === 'src' ? /^content\.config\.(ts|js|mjs|mts)$/ : /^config\.(ts|js|mjs|mts)$/).test(f));
  if (await has('src') || await has('src/content')) return false;
  await fs.mkdir(path.join(projectDir, 'src'), { recursive: true });
  await fs.writeFile(path.join(projectDir, 'src/content.config.ts'), 'export const collections = {};\n');
  return true;
}
