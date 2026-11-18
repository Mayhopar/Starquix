/**
 * task-207 Task 12: promote / un-promote a component into and out of
 * `src/components/sq/`. Reuses renameComponentFile's guards (D9c: the same
 * call, reversed) rather than a second traversal-checking implementation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moveComponentToSystemDir, ComponentFileError } from '../componentFiles';

const BYTES = '---\nconst { role } = Astro.props;\n---\n<p>{role}</p>\n';
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sq-promote-'));
  mkdirSync(join(root, 'sq'), { recursive: true });
  writeFileSync(join(root, 'Credit.astro'), BYTES);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const err = async (fn: () => Promise<unknown>) => {
  try { await fn(); return null; } catch (e) { return e as ComponentFileError; }
};

describe('moveComponentToSystemDir', () => {
  it('promotes into sq/, moving the real bytes', async () => {
    const next = await moveComponentToSystemDir(root, 'Credit.astro', true);
    expect(next).toBe(join('sq', 'Credit.astro'));
    expect(existsSync(join(root, 'Credit.astro'))).toBe(false);
    expect(readFileSync(join(root, 'sq/Credit.astro'), 'utf8')).toBe(BYTES);
  });

  it('un-promote is the identical call, reversed', async () => {
    await moveComponentToSystemDir(root, 'Credit.astro', true);
    const back = await moveComponentToSystemDir(root, 'sq/Credit.astro', false);
    expect(back).toBe('Credit.astro');
    expect(existsSync(join(root, 'sq/Credit.astro'))).toBe(false);
    expect(readFileSync(join(root, 'Credit.astro'), 'utf8')).toBe(BYTES);
  });

  it('creates sq/ when it does not exist yet', async () => {
    rmSync(join(root, 'sq'), { recursive: true, force: true });
    await moveComponentToSystemDir(root, 'Credit.astro', true);
    expect(existsSync(join(root, 'sq/Credit.astro'))).toBe(true);
  });

  it('REFUSES a name that is one of ours — 409 (D2c)', async () => {
    writeFileSync(join(root, 'Media.astro'), BYTES);
    const e = await err(() => moveComponentToSystemDir(root, 'Media.astro', true, ['Media']));
    expect(e?.status).toBe(409);
    expect(e?.message).toMatch(/system component name/);
    expect(existsSync(join(root, 'Media.astro')), 'the file must not move').toBe(true);
  });

  it('REFUSES a collision at the destination — 409, nothing moved', async () => {
    writeFileSync(join(root, 'sq/Credit.astro'), 'other bytes');
    const e = await err(() => moveComponentToSystemDir(root, 'Credit.astro', true));
    expect(e?.status).toBe(409);
    expect(readFileSync(join(root, 'sq/Credit.astro'), 'utf8')).toBe('other bytes');
    expect(existsSync(join(root, 'Credit.astro'))).toBe(true);
  });

  it('REFUSES a redundant move in either direction — 409', async () => {
    writeFileSync(join(root, 'sq/Other.astro'), BYTES);
    expect((await err(() => moveComponentToSystemDir(root, 'sq/Other.astro', true)))?.status).toBe(409);
    expect((await err(() => moveComponentToSystemDir(root, 'Credit.astro', false)))?.status).toBe(409);
  });

  it('404s on a missing file', async () => {
    expect((await err(() => moveComponentToSystemDir(root, 'Nope.astro', true)))?.status).toBe(404);
  });

  it('REFUSES a path that escapes the root — the traversal guard is inherited', async () => {
    const e = await err(() => moveComponentToSystemDir(root, '../../etc/passwd', true));
    expect(e?.status).toBe(400);
    expect(e?.message).toMatch(/outside components directory/);
  });
});
