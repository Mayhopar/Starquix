import { expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { freePath } from '../src/downloads.mjs';
// Finding #34: exporting 'Site' twice, or with an unrelated Site.zip already in Downloads, replaced that file silently.
it('saves a download beside same-named files as "name (n).ext", never over one', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-downloads-'));
  const at = name => path.join(dir, name);
  try {
    expect(freePath(at('Site.zip'))).toBe(at('Site.zip'));
    await fs.writeFile(at('Site.zip'), 'theirs');
    expect(freePath(at('Site.zip'))).toBe(at('Site (1).zip'));
    await fs.writeFile(at('Site (1).zip'), 'an earlier export');
    expect(freePath(at('Site.zip'))).toBe(at('Site (2).zip'));
    await fs.writeFile(at('notes'), '');
    expect(freePath(at('notes'))).toBe(at('notes (1)'));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
