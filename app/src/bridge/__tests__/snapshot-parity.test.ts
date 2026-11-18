/**
 * bridge.js is GENERATED from app/src/bridge/parts/ (single source of truth).
 * This test fails if someone hand-edited bridge.js or changed a part without
 * regenerating. Fix: node scripts/build-snapshot.js (regenerates + snapshots),
 * or node scripts/build-bridge.mjs for the bridge alone.
 *
 * The BANNER below mirrors scripts/build-bridge.mjs — if the generator's
 * banner changes, this test fails until both are updated. That's intentional.
 *
 * TWO artifacts are checked, because there are two and they can drift apart:
 *
 *   1. preview-template/public/scripts/bridge.js — what the desktop instance
 *      serves (desktop/src/instance.mjs copies it into each project's .sq/).
 *   2. the copy embedded in app/public/astro-snapshot.json — the editor's
 *      bundled copy of the template.
 *
 * Case (2) exists because `build-bridge.mjs` can be run on its own, which
 * refreshes (1) and leaves (2) stale. `build-snapshot.js --check` does catch
 * it, but only in the pre-push hook (bypassable with --no-verify) and only as a
 * whole-tree hash that names no file.
 *
 * NOTE FOR ANYONE INVESTIGATING: the snapshot stores every file BASE64-ENCODED.
 * `grep SOME_STRING app/public/astro-snapshot.json` always returns zero hits and
 * is NOT evidence of staleness — decode the entry, as this test does.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IFRAME_BRIDGE_SCRIPT } from '../IFrameBridgeScript.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_JS = path.resolve(
  __dirname,
  '../../../../preview-template/public/scripts/bridge.js',
);
const SNAPSHOT = path.resolve(__dirname, '../../../public/astro-snapshot.json');
/** The snapshot keys files relative to preview-template/. */
const SNAPSHOT_BRIDGE_KEY = 'public/scripts/bridge.js';
const BANNER = `// GENERATED FILE — DO NOT EDIT.
// Source of truth: app/src/bridge/parts/*.ts (assembled by IFrameBridgeScript.ts).
// Regenerate: node scripts/build-bridge.mjs   (build-snapshot.js runs this automatically)
`;

describe('generated bridge.js freshness', () => {
  it('committed bridge.js is byte-identical to generator output', () => {
    const committed = fs.readFileSync(BRIDGE_JS, 'utf8');
    expect(committed.length).toBe((BANNER + IFRAME_BRIDGE_SCRIPT + '\n').length);
    expect(committed).toBe(BANNER + IFRAME_BRIDGE_SCRIPT + '\n');
  });

  it('the bridge inside astro-snapshot.json is byte-identical too', () => {
    const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')) as {
      files: Record<string, string>;
    };
    const encoded = snapshot.files[SNAPSHOT_BRIDGE_KEY];
    expect(
      encoded,
      `astro-snapshot.json has no "${SNAPSHOT_BRIDGE_KEY}" entry. Fix: node scripts/build-snapshot.js`,
    ).toBeTypeOf('string');

    // Files are base64 in the snapshot — decode before comparing.
    const embedded = Buffer.from(encoded, 'base64').toString('utf8');
    expect(
      embedded,
      'astro-snapshot.json ships a STALE bridge (older than the TS parts). Fix: node scripts/build-snapshot.js && git add app/public/astro-snapshot.json preview-template/public/scripts/bridge.js',
    ).toBe(BANNER + IFRAME_BRIDGE_SCRIPT + '\n');
  });
});
