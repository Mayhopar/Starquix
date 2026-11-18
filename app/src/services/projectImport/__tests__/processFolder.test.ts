import { describe, expect, it, vi } from 'vitest';
import { entriesFromFileList } from '../processFolder';

const MAX_TOTAL_SIZE = 500 * 1024 * 1024;

function file(
  path: string,
  size: number,
  read: () => Promise<ArrayBuffer> = async () => new Uint8Array([1]).buffer,
): File {
  return {
    name: path.split(/[\\/]/).pop() || 'file',
    webkitRelativePath: path,
    size,
    arrayBuffer: read,
  } as unknown as File;
}

describe('entriesFromFileList validation', () => {
  it('rejects 2,001 accepted files before reading any bytes', async () => {
    const read = vi.fn(async () => new ArrayBuffer(0));
    const files = Array.from({ length: 2_001 }, (_, i) => file(`site/file-${i}.txt`, 1, read));

    await expect(entriesFromFileList(files)).rejects.toThrow(/Too many files/);
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects metadata over 500 MiB before reading any bytes', async () => {
    const read = vi.fn(async () => new ArrayBuffer(0));

    await expect(entriesFromFileList([
      file('site/a.bin', MAX_TOTAL_SIZE, read),
      file('site/b.bin', 1, read),
    ])).rejects.toThrow(/500MB/);
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    ['traversal', ['site/../secret.txt']],
    ['duplicate normalized destinations', ['site/a.txt', 'site\\a.txt']],
  ])('rejects %s before reading any bytes', async (_kind, paths) => {
    const read = vi.fn(async () => new ArrayBuffer(0));

    await expect(entriesFromFileList(paths.map((path) => file(path, 1, read)))).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });

  it('does not read skipped files or count them against limits', async () => {
    const acceptedRead = vi.fn(async () => new Uint8Array([7]).buffer);
    const skippedRead = vi.fn(async () => new ArrayBuffer(MAX_TOTAL_SIZE));

    const entries = await entriesFromFileList([
      file('site/src/pages/index.astro', 1, acceptedRead),
      file('site/node_modules/pkg/index.js', MAX_TOTAL_SIZE, skippedRead),
      file('site/.git/objects/one', MAX_TOTAL_SIZE, skippedRead),
    ]);

    expect(entries.map((entry) => entry.path)).toEqual(['site/src/pages/index.astro']);
    expect(acceptedRead).toHaveBeenCalledOnce();
    expect(skippedRead).not.toHaveBeenCalled();
  });

  it('accepts exactly 500 MiB from metadata without allocating it', async () => {
    const read = vi.fn(async () => new Uint8Array([9]).buffer);

    const entries = await entriesFromFileList([file('site/large.bin', MAX_TOTAL_SIZE, read)]);

    expect(entries).toEqual([{ path: 'site/large.bin', content: new Uint8Array([9]) }]);
  });

  it('never has more than eight active file readers', async () => {
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    const files = Array.from({ length: 17 }, (_, i) => file(`site/file-${i}.txt`, 1, () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise<ArrayBuffer>((resolve) => {
        releases.push(() => {
          active -= 1;
          resolve(new Uint8Array([i]).buffer);
        });
      });
    }));

    const reading = entriesFromFileList(files);
    let released = 0;
    while (released < files.length) {
      await vi.waitFor(() => expect(releases.length).toBeGreaterThan(0));
      releases.shift()!();
      released += 1;
    }
    const entries = await reading;

    expect(entries).toHaveLength(files.length);
    expect(maxActive).toBe(8);
  });

  it('stops scheduling after a read failure and waits for active readers', async () => {
    const releases: Array<() => void> = [];
    const reads = Array.from({ length: 17 }, (_, index) => vi.fn(() => {
      if (index === 0) return Promise.reject(new Error('read failed'));
      return new Promise<ArrayBuffer>((resolve) => {
        releases.push(() => resolve(new Uint8Array([index]).buffer));
      });
    }));
    const reading = entriesFromFileList(reads.map((read, index) => file(`site/file-${index}.txt`, 1, read)));
    let settled = false;
    void reading.catch(() => { settled = true; });

    await vi.waitFor(() => expect(reads.reduce((sum, read) => sum + read.mock.calls.length, 0)).toBe(8));
    expect(settled).toBe(false);
    for (const release of releases) release();
    await expect(reading).rejects.toThrow('read failed');
    expect(reads.reduce((sum, read) => sum + read.mock.calls.length, 0)).toBe(8);
  });

  it('treats rejection with undefined as failure, stops scheduling, and waits for active readers', async () => {
    const releases: Array<() => void> = [];
    const reads = Array.from({ length: 17 }, (_, index) => vi.fn(() => {
      if (index === 0) return Promise.reject(undefined);
      if (index < 8) {
        return new Promise<ArrayBuffer>((resolve) => {
          releases.push(() => resolve(new Uint8Array([index]).buffer));
        });
      }
      return Promise.resolve(new Uint8Array([index]).buffer);
    }));
    const reading = entriesFromFileList(reads.map((read, index) => file(`site/file-${index}.txt`, 1, read)));
    const outcome = reading.then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (reason: unknown) => ({ status: 'rejected' as const, reason }),
    );
    let settled = false;
    void outcome.then(() => { settled = true; });

    await vi.waitFor(() => expect(reads.reduce((sum, read) => sum + read.mock.calls.length, 0)).toBeGreaterThanOrEqual(8));
    for (let i = 0; i < reads.length; i += 1) await Promise.resolve();
    const scheduledBeforeRelease = reads.reduce((sum, read) => sum + read.mock.calls.length, 0);
    expect(settled).toBe(false);
    for (const release of releases) release();

    expect(await outcome).toEqual({ status: 'rejected', reason: undefined });
    expect(scheduledBeforeRelease).toBe(8);
  });

  it('rejects actual bytes over the cap when file metadata is malformed', async () => {
    const oversized = { byteLength: MAX_TOTAL_SIZE + 1 } as ArrayBuffer;

    await expect(entriesFromFileList([
      file('site/large.bin', 1, async () => oversized),
    ])).rejects.toThrow(/500MB/);
  });
});
