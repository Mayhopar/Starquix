#!/usr/bin/env node
/**
 * Generates preview-template/public/scripts/bridge.js from the TS bridge
 * parts (app/src/bridge/). Single source of truth lives in the parts.
 *
 * Run: node scripts/build-bridge.mjs            (writes bridge.js)
 *      node scripts/build-bridge.mjs --stdout   (prints, no write)
 *      node scripts/build-bridge.mjs --check    (exit 1 if committed file is stale)
 *
 * Requires node >= 22.18 (native TypeScript type-stripping imports).
 */
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'preview-template', 'public', 'scripts', 'bridge.js');

export const BANNER = `// GENERATED FILE — DO NOT EDIT.
// Source of truth: app/src/bridge/parts/*.ts (assembled by IFrameBridgeScript.ts).
// Regenerate: node scripts/build-bridge.mjs   (build-snapshot.js runs this automatically)
`;

export async function generateBridge() {
  const { IFRAME_BRIDGE_SCRIPT } = await import(
    pathToFileURL(join(ROOT, 'app', 'src', 'bridge', 'IFrameBridgeScript.ts')).href
  );
  return BANNER + IFRAME_BRIDGE_SCRIPT + '\n';
}

const isCli = process.argv[1] && process.argv[1].endsWith('build-bridge.mjs');
if (isCli) {
  const arg = process.argv[2];
  const generated = await generateBridge();
  if (arg === '--stdout') {
    process.stdout.write(generated);
  } else if (arg === '--check') {
    const committed = await readFile(OUT, 'utf8');
    if (committed !== generated) {
      console.error('bridge.js is STALE. Run: node scripts/build-bridge.mjs');
      process.exit(1);
    }
    console.log('bridge.js is fresh.');
  } else {
    await writeFile(OUT, generated);
    console.log(`Wrote ${OUT} (${(generated.length / 1024).toFixed(1)} KB)`);
  }
}
