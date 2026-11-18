/**
 * task-133: ViteStructuralWriter — the parent-side client for structural source
 * writes (insert/remove/move/import/restore). Unlike the boolean writers, its
 * promises resolve the FULL result payload (insertedLine/removedSource/...)
 * because callers build undo records from the extras.
 *
 * Since c8535b79 ("add durable structural dispatch core") the writer no longer
 * posts SQ_WRITE_* to the iframe: every op goes through
 * `acceptStructuralOperations` — the shared pure transform
 * (`sq-source-transforms.js`) runs in the editor, the result is accepted into
 * the project store, then materialized to the instance. These tests drive that
 * REAL path against the real `/__sq/local/*` route table on a temp disk.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '@/db';
import { viteStructuralWriter as writer } from '../ViteStructuralWriter';
import { setActiveSaveProjectId } from '../pendingProjectMutations';
import { projectFsRuntime } from '@/test/projectFsRuntime';

// A fresh project id per test: the materializer keeps per-project session
// state that must not leak across tests that wipe the database.
let seq = 0;
let PROJECT = '';
const FILE = 'src/pages/index.astro';
const SOURCE = '<main>\n  <p>a</p>\n  <p>b</p>\n</main>\n';
// Scan-time coordinates of `<p>a</p>` and `<p>b</p>` in SOURCE.
const A = { file: FILE, line: 2, column: 3 };
const B = { file: FILE, line: 3, column: 3 };

let runtime: ReturnType<typeof projectFsRuntime>;
const disk = () => runtime.read(FILE);

beforeEach(async () => {
  await db.delete();
  await db.open();
  PROJECT = `browser_structural_writer_${++seq}`;
  setActiveSaveProjectId(PROJECT);
  runtime = projectFsRuntime(PROJECT, { [FILE]: SOURCE });
});

afterEach(() => {
  runtime.close();
  setActiveSaveProjectId(null);
  vi.restoreAllMocks();
});

describe('ViteStructuralWriter', () => {
  it('writeInsert splices the markup and resolves the full result payload', async () => {
    const result = await writer.writeInsert(A, '<div>hi</div>', 'after');
    expect(result).toMatchObject({ success: true, insertedLine: 3, file: FILE, replacedLine: 3, replacedLineCount: 1, originalSegment: '' });
    expect(result && result.sourceFiles?.[0]).toMatchObject({ file: FILE, beforeSource: SOURCE });
    await vi.waitFor(() => expect(disk()).toBe('<main>\n  <p>a</p>\n  <div>hi</div>\n  <p>b</p>\n</main>\n'));
  });

  it('writeRemove resolves removedSource/removedLine/removedColumn/file extras', async () => {
    const result = await writer.writeRemove(B);
    expect(result).toMatchObject({ success: true, removedSource: '  <p>b</p>\n', removedLine: 3, removedColumn: 1, file: FILE });
    await vi.waitFor(() => expect(disk()).toBe('<main>\n  <p>a</p>\n</main>\n'));
  });

  it('writeMove relocates the element and resolves insertedLine + the removed extras', async () => {
    const result = await writer.writeMove(A, B, 'after');
    expect(result).toMatchObject({ success: true, file: FILE, removedSource: expect.stringContaining('<p>a</p>') });
    expect(result && typeof result.insertedLine).toBe('number');
    await vi.waitFor(() => expect(disk()).toBe('<main>\n  <p>b</p>\n  <p>a</p>\n</main>\n'));
  });

  it('writeImport adds (creating the frontmatter) and removes, resolving added/removed/lineDelta', async () => {
    await expect(writer.writeImport(FILE, 'Hero', '../components/Hero.astro')).resolves.toMatchObject({ success: true, added: true, lineDelta: 3 });
    await vi.waitFor(() => expect(disk()).toBe(`---\nimport Hero from '../components/Hero.astro';\n---\n${SOURCE}`));
    await expect(writer.writeImport(FILE, 'Hero', '', true, true)).resolves.toMatchObject({ success: true, removed: true });
    await vi.waitFor(() => expect(disk()).toBe(SOURCE));
  });

  it('preserves proven import conflict provenance and writes nothing', async () => {
    await writer.writeImport(FILE, 'Card', './Card.astro');
    await vi.waitFor(() => expect(disk()).toContain("import Card from './Card.astro';"));
    const before = disk();
    await expect(writer.writeImport(FILE, 'Card', './Other.astro')).rejects.toMatchObject({
      code: 'import-binding-conflict', outcome: 'no-write', message: expect.stringContaining('import name Card already used'),
    });
    expect(disk()).toBe(before);
  });

  it('does not attach import refusal provenance to a different structural failure', async () => {
    const error = await writer.writeRemove({ file: FILE, line: 9, column: 1 }).catch((failure: Error) => failure);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toHaveProperty('code');
    expect(disk()).toBe(SOURCE);
  });

  it('two in-flight ops each resolve their own result (no cross-resolution)', async () => {
    const insert = writer.writeInsert(A, '<p>new</p>', 'before');
    const remove = writer.writeRemove(B);
    const [insertResult, removeResult] = await Promise.all([insert, remove]);
    expect(insertResult).toMatchObject({ success: true, insertedLine: 2 });
    expect(insertResult).not.toHaveProperty('removedSource');
    expect(removeResult).toMatchObject({ success: true, removedSource: '  <p>b</p>\n' });
    expect(removeResult).not.toHaveProperty('insertedLine');
    await vi.waitFor(() => expect(disk()).toBe('<main>\n  <p>new</p>\n  <p>a</p>\n</main>\n'));
  });

  it('a refused transform rejects with the transform error and leaves the file untouched', async () => {
    await expect(writer.writeRemove({ file: FILE, line: 1, column: 1 })).rejects.toThrow();
    expect(disk()).toBe(SOURCE);
  });

  it('failed region replay rejects its awaited owner', async () => {
    await expect(writer.writeRestoreRegion({ file: FILE, line: 99, column: 1 }, 1, '<img src="/old.png" alt="Release image" />\n')).rejects.toThrow();
    expect(disk()).toBe(SOURCE);
  });

  it('rejects before touching the source when no project storage is active', async () => {
    setActiveSaveProjectId(null);
    await expect(writer.writeInsert(A, '<div/>', 'inside-end')).rejects.toThrow('Project storage is not ready');
    expect(disk()).toBe(SOURCE);
    expect(await db.durableEdits.count()).toBe(0);
  });
});
