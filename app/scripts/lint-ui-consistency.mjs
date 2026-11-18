#!/usr/bin/env node
/**
 * UI-consistency ratchet lint (task-125, design:
 * docs/plans/2026-07-19-design-system-unification-design.md §6).
 *
 * Bans in src/components/** and src/pages/** — OUTSIDE src/components/ui/ —
 * inside non-test .tsx files:
 *   raw-button   : `<button` (use ui/Button / ui/IconButton / ui/MenuItem)
 *   raw-palette  : bg-red-500-style raw palette classes (use semantic tokens)
 *   raw-text-px  : text-[Npx] (use text-3xs/2xs/xs/sm… tokens)
 *   raw-weight   : font-light/semibold/bold… (the chrome has two weights: font-normal 400, font-medium 500;
 *                  a size + medium is ONE class: text-xs-medium / text-sm-medium — theme.css TYPE)
 *   raw-text-size: text-base/xl/2xl/3xl… (the chrome sizes are text-3xs/2xs/xs/sm/lg — theme.css TYPE)
 *   raw-z        : z-[N] (use z-overlay/flyout/modal/debug)
 *   raw-shadow   : shadow-(sm|md|lg|xl|2xl) (use shadow-flyout/shadow-modal)
 *   hand-rolled-row      : `flex items-center justify-between` (use ui/Row +
 *                          typed left/right slot specs — CLAUDE.md rule 8)
 *   hand-rolled-clickable-row : `flex items-center h-10 … cursor-pointer` — a fixed-height clickable header/row built by
 *                          hand (use ui/Row with onClick; section headers are Rows — culture.md)
 *   deprecated-row-slots : Row leftIcons=/rightIcons= (use left=/right=)
 *
 * RATCHET: scripts/ui-consistency-baseline.json snapshots the per-file
 * violation counts at adoption time. A file may never exceed its baseline
 * count per rule; a file that reaches 0 for a rule drops out of the baseline
 * (run with --update-baseline after cleaning a file). New files start at 0.
 *
 * Exemption: files that legitimately GENERATE user-document classes (e.g.
 * DesignBar emitting `bg-[#ff0000]`) may declare, near the top of the file:
 *   // ui-lint-exempt: <reason>
 * Exempt files are skipped entirely — use sparingly, the marker is grep-able.
 *
 * Line-level opt-out for a single legitimate raw value:
 *   ... // ui-lint-line: <reason>
 *
 * Modes:
 *   node scripts/lint-ui-consistency.mjs                  → check (CI)
 *   node scripts/lint-ui-consistency.mjs --update-baseline → rewrite baseline
 *                                                            (counts may only shrink)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'glob';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, '..');
const BASELINE_PATH = join(__dirname, 'ui-consistency-baseline.json');
const UPDATE = process.argv.includes('--update-baseline');

// Palette families whose numbered shades are banned as chrome styling.
const FAMILIES =
  '(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)';
const PREFIXES = '(?:bg|text|border|ring|stroke|fill|outline|decoration|divide|shadow|accent|caret|from|via|to)';

const RULES = {
  'raw-button': /<button\b/g,
  'raw-palette': new RegExp(`(?<![\\w/-])${PREFIXES}-${FAMILIES}-\\d{2,3}(?:\\/\\d+)?(?![\\w-])`, 'g'),
  'raw-text-px': /text-\[\d+px\]/g,
  'raw-weight': /(?<![\w-])font-(?:thin|extralight|light|semibold|bold|extrabold|black)(?![\w-])/g,
  'raw-text-size': /(?<![\w-])text-(?:base|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)(?![\w-])/g,
  'raw-z': /z-\[\d+\]/g,
  'raw-shadow': /(?<![\w-])shadow-(?:sm|md|lg|xl|2xl)(?![\w-])/g,
  'hand-rolled-row': /flex items-center justify-between/g,
  'hand-rolled-clickable-row': /flex items-center h-(?:8|9|10|11|12)\b[^"'`]*cursor-pointer/g,
  'deprecated-row-slots': /\b(?:leftIcons|rightIcons)=/g,
};

const files = globSync('src/{components,pages}/**/*.tsx', { cwd: APP })
  .filter((f) => !f.includes('/ui/'))
  .filter((f) => !f.includes('.test.'))
  .filter((f) => !f.includes('__tests__'))
  .sort();

/** @returns {Record<string, Record<string, number>>} file → rule → count */
function scan() {
  const results = {};
  for (const file of files) {
    const text = readFileSync(join(APP, file), 'utf8');
    if (/\/\/\s*ui-lint-exempt:/.test(text)) continue;
    const lines = text.split('\n');
    const counts = {};
    for (const line of lines) {
      if (/\/\/\s*ui-lint-line:/.test(line)) continue;
      for (const [rule, re] of Object.entries(RULES)) {
        const matches = line.match(re);
        if (matches) counts[rule] = (counts[rule] ?? 0) + matches.length;
      }
    }
    if (Object.keys(counts).length > 0) results[file] = counts;
  }
  return results;
}

const current = scan();

if (UPDATE) {
  const prev = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : null;
  if (prev) {
    // Ratchet: the baseline may only shrink.
    const grew = [];
    for (const [file, counts] of Object.entries(current)) {
      for (const [rule, n] of Object.entries(counts)) {
        const before = prev[file]?.[rule] ?? 0;
        if (n > before) grew.push(`${file} [${rule}] ${before} → ${n}`);
      }
    }
    if (grew.length) {
      console.error('✖ Refusing to update baseline — violations GREW:\n  ' + grew.join('\n  '));
      process.exit(1);
    }
  }
  writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + '\n');
  const total = Object.values(current).reduce((s, c) => s + Object.values(c).reduce((a, b) => a + b, 0), 0);
  console.log(`✓ ui-consistency baseline updated: ${Object.keys(current).length} files, ${total} violations`);
  process.exit(0);
}

if (!existsSync(BASELINE_PATH)) {
  console.error('✖ Missing scripts/ui-consistency-baseline.json — run with --update-baseline first.');
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
const errors = [];

// Doc-freshness guard: every ui/ component must be covered by a design-system
// sub-doc (.claude/skills/design-system/components/*.md mentions its name).
const SKILL_DOCS_DIR = join(APP, '..', '.claude', 'skills', 'design-system', 'components');
const uiComponents = globSync('src/components/ui/*.tsx', { cwd: APP })
  .filter((f) => !f.includes('.test.'))
  .map((f) => f.replace(/^.*\//, '').replace(/\.tsx$/, ''));
const docsText = globSync('*.md', { cwd: SKILL_DOCS_DIR })
  .map((f) => readFileSync(join(SKILL_DOCS_DIR, f), 'utf8'))
  .join('\n');
for (const comp of uiComponents) {
  if (comp === 'cx') continue;
  if (!docsText.includes(comp)) {
    errors.push(
      `components/ui/${comp}.tsx has no design-system sub-doc — add/update a doc under .claude/skills/design-system/components/.`,
    );
  }
}

for (const [file, counts] of Object.entries(current)) {
  for (const [rule, n] of Object.entries(counts)) {
    const allowed = baseline[file]?.[rule] ?? 0;
    if (n > allowed) {
      errors.push(
        `${file}: ${rule} count ${n} exceeds baseline ${allowed}.` +
          (allowed === 0 ? ' New violations are not allowed — use the ui/ kit + tokens.' : ''),
      );
    }
  }
}

// Stale-baseline hygiene: files that no longer violate should leave the list.
const stale = Object.keys(baseline).filter(
  (file) => !current[file] || Object.entries(baseline[file]).every(([rule]) => !(current[file]?.[rule] > 0)),
);

if (errors.length) {
  console.error('✖ UI-consistency lint failed:\n');
  for (const e of errors) console.error('  ' + e);
  console.error(
    '\nUse components/ui primitives + theme.css tokens. For legitimate class-GENERATION',
  );
  console.error('code add `// ui-lint-exempt: <reason>`; for a single line `// ui-lint-line: <reason>`.');
  console.error('If you cleaned a file below its baseline, run: node scripts/lint-ui-consistency.mjs --update-baseline');
  process.exit(1);
}

if (stale.length) {
  console.log(`✓ ui-consistency OK (${stale.length} baseline entr${stale.length === 1 ? 'y is' : 'ies are'} now clean — run --update-baseline to ratchet down)`);
} else {
  console.log('✓ ui-consistency OK');
}
console.log(relative(APP, BASELINE_PATH));
