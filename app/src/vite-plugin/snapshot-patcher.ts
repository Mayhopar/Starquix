/**
 * Without this, write-back edits land on host disk but the editor keeps
 * reading a stale astro-snapshot.json (component inserts, sq/ upgrades).
 * Patches the snapshot entry in place keyed off Vite's chokidar watcher.
 */
import { readFile, writeFile, rename, stat } from 'fs/promises';
import path from 'path';
import { SKIP_DIR_NAMES, computeSnapshotVersion, type Snapshot } from './snapshot-shared';

export interface SnapshotPatcherOptions {
  snapshotPath: string;
  previewTemplateRoot: string;
  debounceMs?: number;
  /** Called after each successful snapshot write with the new version hash. */
  onFlush?: (version: string) => void;
}

export class SnapshotPatcher {
  private pending = new Map<string, string | null>(); // null = delete
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<boolean> | null = null;
  private cache: Snapshot | null = null;
  private readonly snapshotPath: string;
  private readonly previewTemplateRoot: string;
  private readonly debounceMs: number;
  private readonly onFlush?: (version: string) => void;

  constructor(opts: SnapshotPatcherOptions) {
    this.snapshotPath = opts.snapshotPath;
    this.previewTemplateRoot = path.resolve(opts.previewTemplateRoot);
    this.debounceMs = opts.debounceMs ?? 100;
    this.onFlush = opts.onFlush;
  }

  toSnapshotKey(absHostPath: string): string | null {
    const norm = path.resolve(absHostPath);
    const rootWithSep = this.previewTemplateRoot + path.sep;
    if (norm !== this.previewTemplateRoot && !norm.startsWith(rootWithSep)) {
      return null;
    }
    const rel = path.relative(this.previewTemplateRoot, norm);
    if (!rel) return null;
    const segs = rel.split(path.sep);
    if (segs.some((s) => SKIP_DIR_NAMES.has(s))) return null;
    return segs.join('/');
  }

  async patchFile(absHostPath: string): Promise<void> {
    const key = this.toSnapshotKey(absHostPath);
    if (!key) return;
    let buf: Buffer;
    try {
      buf = await readFile(absHostPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.pending.set(key, null);
        this.schedule();
      } else {
        console.warn('[snapshot-patcher] read failed:', absHostPath, err);
      }
      return;
    }
    this.pending.set(key, buf.toString('base64'));
    this.schedule();
  }

  removeFile(absHostPath: string): void {
    const key = this.toSnapshotKey(absHostPath);
    if (!key) return;
    this.pending.set(key, null);
    this.schedule();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
  }

  /**
   * Durability contract: when this resolves after successful writes, every
   * entry pending at call time — including entries queued while a previous
   * write was in-flight — is on disk. (The old schedule-and-return guard
   * resolved early and callers read a stale snapshot.) On a write failure it
   * returns early; the failed batch is restored to `pending` and retried on
   * the debounce timer.
   */
  async flush(): Promise<void> {
    for (;;) {
      if (this.inflight) {
        const ok = await this.inflight;
        if (!ok) return;
        continue;
      }
      if (this.pending.size === 0) return;
      const run = this.flushOnce();
      this.inflight = run;
      let ok: boolean;
      try {
        ok = await run;
      } finally {
        if (this.inflight === run) this.inflight = null;
      }
      if (!ok) return;
    }
  }

  /** One drain pass over the current pending batch. Returns false on a failed write. */
  private async flushOnce(): Promise<boolean> {
    const batch = new Map(this.pending);
    this.pending.clear();

    try {
      const snap = await this.loadCached();

      let changed = false;
      for (const [key, b64] of batch) {
        if (b64 === null) {
          if (key in snap.files) { delete snap.files[key]; changed = true; }
        } else if (snap.files[key] !== b64) {
          snap.files[key] = b64;
          changed = true;
        }
      }

      if (!changed) return true;

      snap.version = computeSnapshotVersion(snap.files);
      const tmp = this.snapshotPath + '.tmp';
      await writeFile(tmp, JSON.stringify(snap));
      await rename(tmp, this.snapshotPath);
      this.cacheMtimeMs = (await stat(this.snapshotPath)).mtimeMs;
      this.onFlush?.(snap.version);
      return true;
    } catch (err) {
      // Restore unmerged entries — newer writes from concurrent patchFile()
      // calls win over the failed batch.
      for (const [key, b64] of batch) {
        if (!this.pending.has(key)) this.pending.set(key, b64);
      }
      // Drop the cache so the next flush re-reads from disk after a failure.
      this.cache = null;
      console.warn('[snapshot-patcher] flush failed:', err);
      return false;
    } finally {
      if (this.pending.size > 0) this.schedule();
    }
  }

  private async loadCached(): Promise<Snapshot> {
    if (this.cache) {
      // External rewrite (e.g. `node scripts/build-snapshot.js`) invalidates us.
      try {
        const st = await stat(this.snapshotPath);
        if (st.mtimeMs > (this.cacheMtimeMs ?? 0)) this.cache = null;
      } catch {
        this.cache = null;
      }
    }
    if (!this.cache) {
      const raw = await readFile(this.snapshotPath, 'utf-8');
      this.cache = JSON.parse(raw) as Snapshot;
      if (!this.cache.files) this.cache.files = {};
      const st = await stat(this.snapshotPath);
      this.cacheMtimeMs = st.mtimeMs;
    }
    return this.cache;
  }

  private cacheMtimeMs: number | null = null;
}
