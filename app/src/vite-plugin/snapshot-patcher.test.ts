import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, mkdir, stat, utimes } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { SnapshotPatcher } from './snapshot-patcher';
import type { Snapshot } from './snapshot-shared';

async function readSnapshot(p: string): Promise<Snapshot> {
  const raw = await readFile(p, 'utf-8');
  return JSON.parse(raw) as Snapshot;
}

function b64decode(b64: string): string {
  return Buffer.from(b64, 'base64').toString('utf-8');
}

describe('SnapshotPatcher', () => {
  let workDir: string;
  let previewTemplateRoot: string;
  let snapshotPath: string;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'snap-patcher-'));
    previewTemplateRoot = path.join(workDir, 'preview-template');
    snapshotPath = path.join(workDir, 'astro-snapshot.json');
    await mkdir(path.join(previewTemplateRoot, 'src', 'components', 'library'), { recursive: true });
    await writeFile(
      snapshotPath,
      JSON.stringify({
        version: 'initial0',
        files: {
          'src/components/library/BlogSlot.astro': Buffer.from('<section class="bg-slate-500"></section>').toString('base64'),
          'src/components/library/Header.astro': Buffer.from('<header>old</header>').toString('base64'),
        },
      }),
    );
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('patches a single file entry and bumps version', async () => {
    const patcher = new SnapshotPatcher({ snapshotPath, previewTemplateRoot, debounceMs: 10 });
    const filePath = path.join(previewTemplateRoot, 'src/components/library/BlogSlot.astro');
    await writeFile(filePath, '<section class="bg-red-500"></section>');

    await patcher.patchFile(filePath);
    await patcher.flush();

    const snap = await readSnapshot(snapshotPath);
    expect(b64decode(snap.files['src/components/library/BlogSlot.astro'])).toBe('<section class="bg-red-500"></section>');
    expect(snap.files['src/components/library/Header.astro']).toBeDefined();
    expect(snap.version).not.toBe('initial0');
    expect(snap.version).toMatch(/^[a-f0-9]{12}$/);
  });

  it('removes a deleted file from the snapshot', async () => {
    const patcher = new SnapshotPatcher({ snapshotPath, previewTemplateRoot, debounceMs: 10 });
    const filePath = path.join(previewTemplateRoot, 'src/components/library/Header.astro');

    patcher.removeFile(filePath);
    await patcher.flush();

    const snap = await readSnapshot(snapshotPath);
    expect(snap.files['src/components/library/Header.astro']).toBeUndefined();
    expect(snap.files['src/components/library/BlogSlot.astro']).toBeDefined();
  });

  it('flush() resolves only after entries queued during an in-flight write are on disk', async () => {
    // Regression: the debounce timer can start a flush; flush() called while
    // that write is in-flight used to schedule-and-return, resolving BEFORE
    // the newly-queued entries were written — callers (and the burst test
    // below, under suite load) then read a stale snapshot. Deterministic
    // repro: gate the in-flight flush open while a newer edit is queued.
    const patcher = new SnapshotPatcher({ snapshotPath, previewTemplateRoot, debounceMs: 10 });
    const a = path.join(previewTemplateRoot, 'src/components/library/BlogSlot.astro');

    let releaseGate!: () => void;
    const gate = new Promise<void>((r) => { releaseGate = r; });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orig = (patcher as any).loadCached.bind(patcher) as () => Promise<Snapshot>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (patcher as any).loadCached = async () => { await gate; return orig(); };

    await writeFile(a, '<section>A1</section>');
    await patcher.patchFile(a);
    const inflight = patcher.flush(); // holds at the gated loadCached

    await writeFile(a, '<section>A2</section>');
    await patcher.patchFile(a); // queued while the A1 write is in-flight

    const second = patcher.flush(); // must drain A2 before resolving
    releaseGate();
    await Promise.all([inflight, second]);

    const snap = await readSnapshot(snapshotPath);
    expect(b64decode(snap.files['src/components/library/BlogSlot.astro'])).toBe('<section>A2</section>');
  });

  it('coalesces a burst of edits into a single snapshot write', async () => {
    const patcher = new SnapshotPatcher({ snapshotPath, previewTemplateRoot, debounceMs: 10 });
    const a = path.join(previewTemplateRoot, 'src/components/library/BlogSlot.astro');
    const b = path.join(previewTemplateRoot, 'src/components/library/Header.astro');
    await writeFile(a, '<section>A1</section>');
    await writeFile(b, '<header>B1</header>');

    await patcher.patchFile(a);
    await patcher.patchFile(b);
    await writeFile(a, '<section>A2</section>');
    await patcher.patchFile(a);
    await patcher.flush();

    const snap = await readSnapshot(snapshotPath);
    expect(b64decode(snap.files['src/components/library/BlogSlot.astro'])).toBe('<section>A2</section>');
    expect(b64decode(snap.files['src/components/library/Header.astro'])).toBe('<header>B1</header>');
  });

  it('ignores paths outside preview-template', async () => {
    const patcher = new SnapshotPatcher({ snapshotPath, previewTemplateRoot, debounceMs: 10 });
    const outside = path.join(workDir, 'other', 'thing.astro');
    await mkdir(path.dirname(outside), { recursive: true });
    await writeFile(outside, 'noop');

    await patcher.patchFile(outside);
    await patcher.flush();

    const snap = await readSnapshot(snapshotPath);
    expect(snap.version).toBe('initial0');
    expect(Object.keys(snap.files).sort()).toEqual([
      'src/components/library/BlogSlot.astro',
      'src/components/library/Header.astro',
    ]);
  });

  it('ignores paths in skip-listed directories', async () => {
    const patcher = new SnapshotPatcher({ snapshotPath, previewTemplateRoot, debounceMs: 10 });
    const inNodeModules = path.join(previewTemplateRoot, 'node_modules', 'pkg', 'index.js');
    const inTests = path.join(previewTemplateRoot, 'src', '__tests__', 'foo.test.ts');
    await mkdir(path.dirname(inNodeModules), { recursive: true });
    await mkdir(path.dirname(inTests), { recursive: true });
    await writeFile(inNodeModules, 'x');
    await writeFile(inTests, 'y');

    await patcher.patchFile(inNodeModules);
    await patcher.patchFile(inTests);
    await patcher.flush();

    const snap = await readSnapshot(snapshotPath);
    expect(snap.version).toBe('initial0');
  });

  it('toSnapshotKey returns forward-slash relative path', () => {
    const patcher = new SnapshotPatcher({ snapshotPath, previewTemplateRoot, debounceMs: 10 });
    const filePath = path.join(previewTemplateRoot, 'src', 'styles', 'global.css');
    expect(patcher.toSnapshotKey(filePath)).toBe('src/styles/global.css');
  });

  it('treats a vanished file as a removal', async () => {
    const patcher = new SnapshotPatcher({ snapshotPath, previewTemplateRoot, debounceMs: 10 });
    const filePath = path.join(previewTemplateRoot, 'src/components/library/Header.astro');
    await patcher.patchFile(filePath);
    await patcher.flush();

    const snap = await readSnapshot(snapshotPath);
    expect(snap.files['src/components/library/Header.astro']).toBeUndefined();
  });

  it('skips the snapshot write when no content actually changed', async () => {
    const patcher = new SnapshotPatcher({ snapshotPath, previewTemplateRoot, debounceMs: 10 });
    const filePath = path.join(previewTemplateRoot, 'src/components/library/Header.astro');
    // Identical to what's already in the snapshot.
    await writeFile(filePath, '<header>old</header>');

    const before = await stat(snapshotPath);
    await patcher.patchFile(filePath);
    await patcher.flush();
    const after = await stat(snapshotPath);

    expect(after.mtimeMs).toBe(before.mtimeMs);
    const snap = await readSnapshot(snapshotPath);
    expect(snap.version).toBe('initial0');
  });

  it('invokes onFlush with the new version after a successful write', async () => {
    const versions: string[] = [];
    const patcher = new SnapshotPatcher({
      snapshotPath,
      previewTemplateRoot,
      debounceMs: 10,
      onFlush: (v) => versions.push(v),
    });
    const filePath = path.join(previewTemplateRoot, 'src/components/library/BlogSlot.astro');
    await writeFile(filePath, '<section class="bg-green-500"></section>');

    await patcher.patchFile(filePath);
    await patcher.flush();

    const snap = await readSnapshot(snapshotPath);
    expect(versions).toEqual([snap.version]);
  });

  it('does not invoke onFlush when nothing changed', async () => {
    const versions: string[] = [];
    const patcher = new SnapshotPatcher({
      snapshotPath,
      previewTemplateRoot,
      debounceMs: 10,
      onFlush: (v) => versions.push(v),
    });
    // Re-write the identical content already in the snapshot fixture
    const filePath = path.join(previewTemplateRoot, 'src/components/library/BlogSlot.astro');
    await writeFile(filePath, '<section class="bg-slate-500"></section>');

    await patcher.patchFile(filePath);
    await patcher.flush();

    expect(versions).toEqual([]);
  });

  it('picks up external snapshot rewrites between flushes', async () => {
    const patcher = new SnapshotPatcher({ snapshotPath, previewTemplateRoot, debounceMs: 10 });
    const filePath = path.join(previewTemplateRoot, 'src/components/library/BlogSlot.astro');
    await writeFile(filePath, '<section>v1</section>');
    await patcher.patchFile(filePath);
    await patcher.flush();

    // Simulate `node scripts/build-snapshot.js` rewriting the snapshot externally.
    await writeFile(
      snapshotPath,
      JSON.stringify({
        version: 'external',
        files: {
          'src/components/library/Header.astro': Buffer.from('<header>external</header>').toString('base64'),
        },
      }),
    );
    const future = new Date(Date.now() + 5000);
    await utimes(snapshotPath, future, future);

    await writeFile(filePath, '<section>v2</section>');
    await patcher.patchFile(filePath);
    await patcher.flush();

    const snap = await readSnapshot(snapshotPath);
    expect(b64decode(snap.files['src/components/library/Header.astro'])).toBe('<header>external</header>');
    expect(b64decode(snap.files['src/components/library/BlogSlot.astro'])).toBe('<section>v2</section>');
  });
});
