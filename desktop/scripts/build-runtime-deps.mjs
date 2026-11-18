// Builds desktop/runtime-deps/node_modules from desktop/runtime/ (package.json + lock):
// the ONE node_modules every project links to (design: "Bundled + shared") = the preview
// template's dependencies, unchanged, plus what imported sites commonly need (Tailwind's
// official plugins — an imported portfolio 500'd on '@tailwindcss/typography').
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const template = path.resolve(here, '../../preview-template');
const out = path.resolve(here, '../runtime-deps');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const runtime = path.resolve(here, '../runtime');
const templateDeps = JSON.parse(readFileSync(path.join(template, 'package.json'), 'utf8')).dependencies;
const runtimeDeps = JSON.parse(readFileSync(path.join(runtime, 'package.json'), 'utf8')).dependencies;
const drift = Object.entries(templateDeps).filter(([name, range]) => runtimeDeps[name] !== range);
if (drift.length) throw new Error(`desktop/runtime/package.json drifted from preview-template: ${drift.map(([n, r]) => `${n}@${r}`).join(', ')} — update it and run \`npm install --package-lock-only\` there`);
cpSync(path.join(runtime, 'package.json'), path.join(out, 'package.json'));
cpSync(path.join(runtime, 'package-lock.json'), path.join(out, 'package-lock.json'));
// `--arch x64` fetches that CPU's natives (esbuild, rollup) for a cross-arch package.
// ponytail: same OS only; Windows packages build on Windows.
const arch = process.argv.includes('--arch') ? process.argv[process.argv.indexOf('--arch') + 1] : process.arch;
// Cross-arch: install scripts would run the foreign binaries on this host (esbuild's
// postinstall version check fails); natives come from the per-arch optional packages.
const cross = arch !== process.arch ? ['--ignore-scripts'] : [];
execFileSync('npm', ['ci', '--omit=dev', `--cpu=${arch}`, `--os=${process.platform}`, ...cross], { cwd: out, stdio: 'inherit', shell: process.platform === 'win32' });
console.log(`runtime deps → ${path.join(out, 'node_modules')}`);
