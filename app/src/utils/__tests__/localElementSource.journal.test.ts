// writeLocalFile is the shared whole-file write (Source tab, blog scaffold,
// field binding, slot upgrade, AI edit_file). A raw write-file left the
// durable source projection stale → the next class edit on the file was
// refused until a restart (2026-10-05). With an open project it must be ONE
// journaled file-batch.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const activeId = vi.hoisted(() => ({ value: null as string | null }));
const accept = vi.fn();
const finish = vi.fn();
const projected = vi.fn();
const localFetch = vi.fn();
vi.mock('@/services/pendingProjectMutations', () => ({ getActiveSaveProjectId: () => activeId.value }));
vi.mock('@/services/durableEdits/fileAcceptance', () => ({ acceptFileChanges: (...a: unknown[]) => accept(...a), finishAcceptedFiles: (...a: unknown[]) => finish(...a) }));
vi.mock('@/services/durableEdits/projectedSource', () => ({ readProjectedSourceState: (...a: unknown[]) => projected(...a) }));
vi.mock('../sqLocalBase', () => ({ localFetch: (...a: unknown[]) => localFetch(...a) }));

import { writeLocalFile } from '../localElementSource';

beforeEach(() => {
  vi.clearAllMocks();
  activeId.value = 'browser_p';
  projected.mockResolvedValue('old');
  accept.mockImplementation(async (_folder: string, input: () => Promise<unknown>) => ({ changes: await input(), projectId: 'browser_p', revision: 1 }));
  finish.mockResolvedValue({ status: 'materialized' });
  localFetch.mockResolvedValue({ ok: true });
});

describe('writeLocalFile', () => {
  it('journals the exact before/after bytes with an open project (never the raw route)', async () => {
    await writeLocalFile('src/components/A.astro', 'new');
    expect(accept).toHaveBeenCalledWith('wc://browser_p', expect.any(Function), undefined, undefined, undefined);
    expect(await accept.mock.results[0].value).toMatchObject({ changes: [{ file: 'src/components/A.astro', beforeSource: 'old', afterSource: 'new' }] });
    expect(finish).toHaveBeenCalled();
    expect(localFetch).not.toHaveBeenCalled();
  });

  it('throws when the accepted edit is not written', async () => {
    finish.mockResolvedValue({ status: 'retained', error: new Error('Source differs') });
    await expect(writeLocalFile('src/a.astro', 'new')).rejects.toThrow(/Source differs/);
  });

  it('writes nothing for identical bytes', async () => {
    projected.mockResolvedValue('same');
    await writeLocalFile('src/a.astro', 'same');
    expect(finish).not.toHaveBeenCalled();
  });

  it('uses the plain route only without an open project or outside src/ (scaffold before the editor arms)', async () => {
    activeId.value = null;
    await writeLocalFile('src/a.astro', 'x');
    activeId.value = 'browser_p';
    await writeLocalFile('public/robots.txt', 'x');
    expect(accept).not.toHaveBeenCalled();
    expect(localFetch).toHaveBeenCalledWith('/__sq/local/write-file', expect.objectContaining({ method: 'POST' }));
  });
});
