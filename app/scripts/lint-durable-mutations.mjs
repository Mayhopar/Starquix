#!/usr/bin/env node
/**
 * Durable-mutation lint.
 *
 * Every project mutation is accepted by the durable journal
 * (src/services/durableEdits) before it becomes editor state. The retired
 * save coordinator must not come back under a new owner: production code may
 * not register save participants, track pending mutations, or call a
 * project-level save. Run from `app/`: `node scripts/lint-durable-mutations.mjs`
 */
import { execSync } from 'node:child_process';
const forbidden = [/registerProjectSaveParticipant/, /trackProjectMutation/, /\bsaveProject\s*\(/, /ProjectSaveStatus/, /services\/projectSave/];
const files = execSync("find src -type f \\( -name '*.ts' -o -name '*.tsx' \\) -not -path '*/__tests__/*' -not -name '*.test.*'", { encoding: 'utf8' }).split('\n').filter(Boolean);
const { readFileSync } = await import('node:fs');
const hits = [];
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => { for (const rx of forbidden) if (rx.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`); });
}
if (hits.length) { console.error('lint-durable-mutations: retired save-coordinator API in production code:\n' + hits.join('\n')); process.exit(1); }
console.log(`lint-durable-mutations: ok (${files.length} files)`);

// Every direct Yjs mutation site is classified (services/durableEdits/directMutationOwners.ts). The inventory is a
// whole-app TypeScript walk: inside the parallel vitest pool it timed the gate out at 60 s on a loaded machine
// (2026-11-11), so it runs here, alone, after the tests. Node runs the .ts modules natively (type stripping).
const { directMutationInventory } = await import('../src/test/directMutationInventory.ts');
const { DIRECT_MUTATION_OWNERS } = await import('../src/services/durableEdits/directMutationOwners.ts');
const expected = {};
for (const [file, owner] of Object.entries(DIRECT_MUTATION_OWNERS)) {
  if (!owner.reason) { console.error(`lint-durable-mutations: ${file} has no reason in directMutationOwners.ts`); process.exit(1); }
  for (const kind of ['transactions', 'writes']) if (owner[kind] !== undefined) expected[`${file}:${kind}`] = owner[kind];
}
const actual = directMutationInventory(process.cwd());
const drift = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()
  .filter(k => expected[k] !== actual[k]).map(k => `  ${k}: listed ${expected[k] ?? 0}, found ${actual[k] ?? 0}`);
if (drift.length) {
  console.error('lint-durable-mutations: direct Yjs mutation sites differ from services/durableEdits/directMutationOwners.ts\n' + drift.join('\n'));
  process.exit(1);
}
console.log(`lint-durable-mutations: ${Object.keys(actual).length} direct mutation sites classified`);
