#!/usr/bin/env node

/**
 * Builds a snapshot of the preview-template source files for the editor
 * (app/src/services/snapshotLoader.ts). Excludes node_modules.
 *
 * Output: app/public/astro-snapshot.json
 *
 * Run: node scripts/build-snapshot.js
 */

import { readdir, readFile, writeFile } from 'fs/promises';
import { createHash } from 'crypto';
import { join, relative, sep } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const TEMPLATE_DIR = join(ROOT, 'preview-template');
const OUTPUT = join(ROOT, 'app', 'public', 'astro-snapshot.json');

// Directories to always skip.
// `.starquix` is a gitignored SCRATCH dir (generated wrapper configs, export
// diffs). Three stale files of it were once force-added and rode into the
// snapshot as dead weight — carrying hardcoded host absolute paths. Skipping it
// keeps a contributor's local copy out.
const SKIP = new Set(['.git', '.astro', '.starquix', 'dist', 'node_modules', '__tests__']);

// Individual files that live under preview-template/ but are NOT preview code.
// `.sq-folders.json` is the Assets-panel folder manifest — editor metadata the
// iframe never reads. Shipping it would churn the snapshot version on every
// folder drag. Keep in sync with SNAPSHOT_IGNORE_RE in
// app/src/vite-plugin/snapshot-shared.ts.
const SKIP_FILES = new Set(['.sq-folders.json']);

async function collectFiles(dir, base = dir) {
  const files = {};
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;

    const fullPath = join(dir, entry.name);
    const relPath = relative(base, fullPath).split(sep).join('/'); // POSIX keys (and hash) on Windows too

    if (entry.isDirectory()) {
      const subFiles = await collectFiles(fullPath, base);
      Object.assign(files, subFiles);
    } else {
      if (SKIP_FILES.has(entry.name)) continue;
      const content = await readFile(fullPath);
      files[relPath] = content.toString('base64');
    }
  }

  return files;
}

async function main() {
  const checkMode = process.argv.includes('--check');

  // bridge.js is GENERATED from app/src/bridge/parts/ — regenerate before
  // collecting so the snapshot always ships the current parts. In --check
  // mode, compare in memory instead (no tree mutation in pre-push hooks).
  const { generateBridge } = await import('./build-bridge.mjs');
  const bridgeOut = join(TEMPLATE_DIR, 'public', 'scripts', 'bridge.js');
  const generatedBridge = await generateBridge();
  if (checkMode) {
    const committedBridge = await readFile(bridgeOut, 'utf-8').catch(() => null);
    if (committedBridge !== generatedBridge) {
      console.error('[snapshot --check] STALE: bridge.js does not match the TS parts.');
      console.error('Fix: node scripts/build-snapshot.js && git add preview-template/public/scripts/bridge.js app/public/astro-snapshot.json');
      process.exit(1);
    }
  } else {
    await writeFile(bridgeOut, generatedBridge);
    console.log('Regenerated bridge.js from app/src/bridge/parts/');
  }

  console.log('Collecting preview-template source files (no node_modules)...');
  // Paths in code-unit order: a directory listing's order differs by OS (APFS vs NTFS); the version must not
  // (same algorithm as app/src/vite-plugin/snapshot-shared.ts computeSnapshotVersion).
  const files = Object.fromEntries(Object.entries(await collectFiles(TEMPLATE_DIR)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

  // Generate content hash for cache invalidation
  const contentHash = createHash('md5')
    .update(JSON.stringify(files))
    .digest('hex')
    .slice(0, 12);

  let existingVersion = null;
  try {
    existingVersion = JSON.parse(await readFile(OUTPUT, 'utf-8')).version ?? null;
  } catch {
    // missing or unparsable snapshot → treated as stale
  }

  if (checkMode) {
    if (existingVersion === contentHash) {
      console.log(`[snapshot --check] fresh (version ${contentHash})`);
      return;
    }
    console.error(
      `[snapshot --check] STALE: app/public/astro-snapshot.json (version ${existingVersion}) ` +
      `does not match preview-template/ (${contentHash}).`
    );
    console.error('Fix: node scripts/build-snapshot.js && git add app/public/astro-snapshot.json');
    process.exit(1);
  }

  if (existingVersion === contentHash) {
    console.log(`Snapshot already up to date (version ${contentHash}) — skipping write.`);
    return;
  }

  const output = JSON.stringify({ version: contentHash, files });
  console.log(`Collected ${Object.keys(files).length} files (hash: ${contentHash})`);
  await writeFile(OUTPUT, output);
  const size = (Buffer.byteLength(output) / 1024).toFixed(1);
  console.log(`Written to ${OUTPUT} (${size} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
