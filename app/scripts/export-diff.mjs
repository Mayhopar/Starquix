#!/usr/bin/env node
/**
 * export-diff — snapshot the current export output and diff against
 * the last snapshot. The review equivalent for "what changes did my
 * Yjs tweak make to the exported site?"
 *
 * Usage:
 *   npm run export-diff            # diff against last snapshot
 *   npm run export-diff -- --save  # save current as new baseline
 *   npm run export-diff -- --reset # delete the baseline
 *
 * Stores snapshots under .starquix/last-good-export/ (gitignored).
 *
 * This script deliberately does NOT run a live editor Yjs doc — it
 * operates on the fixture doc from src/render/blog/__fixtures__/
 * because that's deterministic. Swap in a different fixture path via
 * --fixture=path/to/module if you need to diff against a real export.
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { execSync } from 'node:child_process';

const SNAPSHOT_DIR = resolve(process.cwd(), '.starquix/last-good-export');
const mode = process.argv.includes('--save')
  ? 'save'
  : process.argv.includes('--reset')
    ? 'reset'
    : 'diff';

if (mode === 'reset') {
  if (existsSync(SNAPSHOT_DIR)) {
    rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
    console.log(`Deleted ${SNAPSHOT_DIR}`);
  } else {
    console.log('No snapshot to reset.');
  }
  process.exit(0);
}

// Generate the current export into a temp dir using vitest — the
// fixture-based generator in src/render/blog/__fixtures__/basic-blog-slot
// already knows how to build a valid doc + call generateAstroProject.
const tmp = execSync('mktemp -d -t starquix-export-diff-XXXXXX').toString().trim();
process.on('exit', () => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* already gone */ }
});

// Build a tiny node script that calls generateAstroProject with the
// basic fixture and writes the files into tmp.
const runnerSrc = `
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateAstroProject } from './dist/export/generateAstro.js';
import { buildBasicBlogSlotDoc } from './dist/render/blog/__fixtures__/basic-blog-slot.js';

const { files } = generateAstroProject({ doc: buildBasicBlogSlotDoc(), projectName: 'test' });
for (const f of files) {
  const abs = join('${tmp}', f.path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, f.content, 'utf-8');
}
`;

// Rather than shelling out for a transpile step, use vitest's inline
// test runner: spawn vitest with a throwaway spec that emits the files.
const specPath = join(tmp, '.runner.test.ts');
writeFileSync(
  specPath,
  `
import { it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateAstroProject } from '${resolve('src/export/generateAstro.ts')}';
import { buildBasicBlogSlotDoc } from '${resolve('src/render/blog/__fixtures__/basic-blog-slot.ts')}';

it('emits export', () => {
  const { files } = generateAstroProject({ doc: buildBasicBlogSlotDoc(), projectName: 'test' });
  for (const f of files) {
    const abs = join('${tmp}', 'export', f.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, f.content, 'utf-8');
  }
  expect(files.length).toBeGreaterThan(0);
});
`,
);

try {
  execSync(`npx vitest run --no-coverage '${specPath}'`, { stdio: 'inherit' });
} catch (err) {
  console.error('export generation failed');
  process.exit(1);
}

const currentRoot = join(tmp, 'export');

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function filesByRelPath(root) {
  const map = new Map();
  for (const abs of walk(root)) {
    const rel = abs.slice(root.length + 1);
    map.set(rel, readFileSync(abs, 'utf-8'));
  }
  return map;
}

if (mode === 'save') {
  rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  for (const abs of walk(currentRoot)) {
    const rel = abs.slice(currentRoot.length + 1);
    const dest = join(SNAPSHOT_DIR, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(abs));
  }
  console.log(`Saved baseline snapshot: ${SNAPSHOT_DIR}`);
  process.exit(0);
}

// mode === 'diff'
if (!existsSync(SNAPSHOT_DIR)) {
  console.log('No baseline yet. Run `npm run export-diff -- --save` first to capture one.');
  process.exit(0);
}

const current = filesByRelPath(currentRoot);
const baseline = filesByRelPath(SNAPSHOT_DIR);

const added = [];
const removed = [];
const changed = [];

for (const [rel, content] of current) {
  if (!baseline.has(rel)) added.push(rel);
  else if (baseline.get(rel) !== content) changed.push(rel);
}
for (const rel of baseline.keys()) {
  if (!current.has(rel)) removed.push(rel);
}

if (added.length === 0 && removed.length === 0 && changed.length === 0) {
  console.log('No changes since last snapshot.');
  process.exit(0);
}

const fmt = (arr, label, marker) => {
  if (arr.length === 0) return;
  console.log(`\n${label}:`);
  for (const r of arr.sort()) console.log(`  ${marker} ${r}`);
};
fmt(added, 'Added', '+');
fmt(removed, 'Removed', '-');
fmt(changed, 'Changed', '~');

console.log(`\nRun \`npm run export-diff -- --save\` to accept the new baseline.`);
process.exit(changed.length + added.length + removed.length > 0 ? 1 : 0);
