#!/usr/bin/env node
/**
 * Test-coverage lint.
 *
 * Enforces two non-negotiable rules from CLAUDE.md "Bug → regression test":
 *
 *   1. Every command type referenced via `case '<NAME>':` in
 *      `src/store/commands.ts` must appear as a string literal in at
 *      least one test file under `src/store/__tests__/` (or the legacy
 *      `src/store/commands.test.ts`).
 *
 *   2. Every `IFrameBridge.prototype.handleX` defined in
 *      `src/bridge/parts/*.ts` must appear (by name) in at least one
 *      test file under `src/bridge/`.
 *
 * Exits non-zero with the offending list. New commands and handlers
 * therefore can't ship without at least a stub test mentioning them.
 *
 * Run from the `app/` directory: `node scripts/lint-test-coverage.mjs`
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');

function readSafe(rel) {
  const abs = path.join(appRoot, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
}

function listFiles(dir, pattern) {
  const out = execSync(
    `find "${dir}" -type f \\( -name '*.test.ts' -o -name '*.test.tsx' \\) 2>/dev/null || true`,
    { cwd: appRoot, encoding: 'utf8' },
  );
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && (!pattern || pattern.test(l)));
}

function readAll(files) {
  return files
    .map((f) => {
      try {
        return fs.readFileSync(path.resolve(appRoot, f), 'utf8');
      } catch {
        return '';
      }
    })
    .join('\n');
}

let failed = false;

// --- 1. Commands -----------------------------------------------------------
{
  const commandsSrc = readSafe('src/store/commands.ts');
  const commandNames = [
    ...new Set(
      [...commandsSrc.matchAll(/case ['"]([A-Z][A-Z0-9_]*)['"]:/g)].map((m) => m[1]),
    ),
  ].sort();

  const testFiles = listFiles('src/store', /__tests__|commands\.test\./);
  // Also include co-located commands.test.ts that lives at src/store/commands.test.ts
  if (fs.existsSync(path.join(appRoot, 'src/store/commands.test.ts'))) {
    testFiles.push('src/store/commands.test.ts');
  }
  const testCorpus = readAll(testFiles);

  const missing = commandNames.filter((name) => !testCorpus.includes(name));

  if (missing.length) {
    failed = true;
    console.error(`\nCommands without test reference (${missing.length}):`);
    for (const name of missing) console.error('  - ' + name);
  } else {
    console.log(`OK: all ${commandNames.length} commands referenced in tests.`);
  }
}

// --- 2. Bridge handlers ----------------------------------------------------
{
  const partsDir = path.join(appRoot, 'src/bridge/parts');
  const partFiles = fs
    .readdirSync(partsDir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => path.join('src/bridge/parts', f));

  const partsCorpus = partFiles
    .map((f) => fs.readFileSync(path.resolve(appRoot, f), 'utf8'))
    .join('\n');

  const handlerNames = [
    ...new Set(
      [...partsCorpus.matchAll(/IFrameBridge\.prototype\.(handle[A-Z]\w*)\s*=/g)].map(
        (m) => m[1],
      ),
    ),
  ].sort();

  const bridgeTestFiles = listFiles('src/bridge', null);
  const bridgeTestCorpus = readAll(bridgeTestFiles);

  const missing = handlerNames.filter((name) => !bridgeTestCorpus.includes(name));

  if (missing.length) {
    failed = true;
    console.error(`\nBridge handlers without test reference (${missing.length}):`);
    for (const name of missing) console.error('  - ' + name);
  } else {
    console.log(`OK: all ${handlerNames.length} bridge handlers referenced in tests.`);
  }
}

if (failed) {
  console.error(
    '\nFix: add at least one `it(...)` or string-literal mention of each name above\n' +
      'to a test file under src/store/__tests__/ (commands) or src/bridge/ (handlers).',
  );
  process.exit(1);
}
