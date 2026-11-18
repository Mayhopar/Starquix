/**
 * Windows port (2026-11-10): an antivirus/indexer scan of the fresh temp file can refuse the save's rename for a
 * moment (EPERM/EACCES/EBUSY). writeFileAtomic retries briefly on Windows only; elsewhere it fails as before.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const busy = vi.hoisted(() => ({ left: 0, calls: 0, code: 'EPERM' }));
// importOriginal() is empty for builtins here: take the real module through require.
vi.mock('node:fs', async () => {
  const real = (await import('node:module')).createRequire(import.meta.url)('node:fs') as typeof import('node:fs');
  const renameSync = (from: string, to: string) => {
    busy.calls++;
    if (busy.left > 0) { busy.left--; throw Object.assign(new Error(`${busy.code}: rename`), { code: busy.code }); }
    return real.renameSync(from, to);
  };
  return { ...real, default: { ...real, renameSync }, renameSync };
});

// eslint-disable-next-line import/no-relative-packages
const { renameReplacing, writeFileAtomic } = await import('../../../../preview-template/src/plugins/sq-atomic-write.js');
// eslint-disable-next-line import/no-relative-packages
const { writeFileSync } = await import('node:fs');

describe('the atomic save rename on Windows', () => {
  beforeEach(() => { busy.left = 0; busy.calls = 0; busy.code = 'EPERM'; });
  const files = () => { const dir = mkdtempSync(path.join(os.tmpdir(), 'sq-atomic-')); return { from: path.join(dir, 'a.tmp'), to: path.join(dir, 'a.astro') }; };

  it('a briefly busy target is retried until the rename lands (Windows)', () => {
    const { from, to } = files(); writeFileSync(from, 'new'); writeFileSync(to, 'old');
    busy.left = 2;
    renameReplacing(from, to, 'win32');
    expect(busy.calls).toBe(3);
    expect(readFileSync(to, 'utf8')).toBe('new');
    expect(existsSync(from)).toBe(false);
  });
  it('macOS/Linux never retry: the first refusal is the answer', () => {
    const { from, to } = files(); writeFileSync(from, 'new');
    busy.left = 1;
    expect(() => renameReplacing(from, to, 'darwin')).toThrow(/EPERM/);
    expect(busy.calls).toBe(1);
  });
  it('a real error (not busy) is not retried on Windows either', () => {
    const { from, to } = files(); writeFileSync(from, 'new');
    busy.left = 1; busy.code = 'ENOSPC';
    expect(() => renameReplacing(from, to, 'win32')).toThrow(/ENOSPC/);
    expect(busy.calls).toBe(1);
  });
  it('writeFileAtomic goes through it', () => {
    const { to } = files(); writeFileSync(to, 'old');
    writeFileAtomic(to, 'saved');
    expect(readFileSync(to, 'utf8')).toBe('saved');
    expect(busy.calls).toBe(1);
  });
});
