// task-244 open pass: ONE journaled batch with an undo snapshot, nothing
// written on failure, retried when a structural write is in flight.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ rewrite: vi.fn() }));
vi.mock('@/utils/localElementSource', async (orig) => ({ presentFiles: (await orig<typeof import('@/utils/localElementSource')>()).presentFiles, rewriteLocalFiles: (...a: unknown[]) => h.rewrite(...a) }));

import { convertListsOnOpen, sourcesComplete } from '../listConversion';
import { _resetStructuralWriteInFlightForTests, releaseStructuralWrite, tryAcquireStructuralWrite } from '@/store/structuralWriteGuard';
import { OWNER_FILES, TWO_SLOTS } from '@/utils/__tests__/fixtures/lists';
import { DEFAULT_CARD } from '@/utils/cardFields';

const FILES = OWNER_FILES;
const HEAL = { exists: () => true, assignments: new Map(), fieldsOf: () => [] };
const undo = () => ({ takeSnapshot: vi.fn(), claimSnapshot: vi.fn(() => ({ commit: vi.fn() })) });

beforeEach(() => {
  _resetStructuralWriteInFlightForTests();
  h.rewrite.mockReset().mockImplementation(async (files: string[], compute: (b: Record<string, string | null>) => Record<string, string>) =>
    Object.keys(compute(Object.fromEntries(files.map((f) => [f, (FILES as Record<string, string>)[f] ?? null])))));
});

describe('convertListsOnOpen', () => {
  it('writes the page + BlogSlot in ONE batch with a claimed undo snapshot', async () => {
    const u = undo();
    expect(await convertListsOnOpen({ files: FILES, blogSlotLibrary: 'LIB', ...HEAL, ...u })).toBe(true);
    expect(h.rewrite).toHaveBeenCalledTimes(1);
    expect(h.rewrite.mock.calls[0][0].sort()).toEqual(['src/components/BlogSlot.astro', 'src/components/FeaturedWorkList.astro', 'src/components/WorkList.astro', 'src/pages/index.astro']);
    expect(u.takeSnapshot).toHaveBeenCalledTimes(1);
    expect(h.rewrite.mock.calls[0][2]).toBe(u.claimSnapshot.mock.results[0].value);
  });

  it('nothing to convert → no write, no snapshot', async () => {
    const u = undo();
    expect(await convertListsOnOpen({ files: { 'src/pages/a.astro': '<p />' }, blogSlotLibrary: 'LIB', ...HEAL, ...u })).toBe(true);
    expect(h.rewrite).not.toHaveBeenCalled();
    expect(u.takeSnapshot).not.toHaveBeenCalled();
  });

  // Owner 2026-11-10: never skipped — it waits its turn behind the write in flight.
  it('a structural write in flight → waits its turn, then converts', async () => {
    tryAcquireStructuralWrite();
    const pending = convertListsOnOpen({ files: FILES, blogSlotLibrary: 'LIB', ...HEAL, ...undo() });
    await new Promise((r) => setTimeout(r, 0));
    expect(h.rewrite).not.toHaveBeenCalled();
    releaseStructuralWrite();
    expect(await pending).toBe(true);
    expect(h.rewrite).toHaveBeenCalled();
  });

  it('a failed batch warns and reports nothing written; the guard is released', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.rewrite.mockRejectedValue(new Error('disk'));
    expect(await convertListsOnOpen({ files: FILES, blogSlotLibrary: 'LIB', ...HEAL, ...undo() })).toBe(true);
    expect(warn).toHaveBeenCalled();
    expect(tryAcquireStructuralWrite()).toBe(true);
    warn.mockRestore();
  });
});

describe('sourcesComplete', () => {
  it('waits until every component a page imports from src/components has been read', () => {
    expect(sourcesComplete(FILES)).toBe(true);
    const { 'src/components/WorkList.astro': _gone, ...partial } = FILES;
    expect(sourcesComplete(partial)).toBe(false);
    expect(sourcesComplete({})).toBe(false);
  });
});

describe('convertListsOnOpen — heals a slot whose card file is gone (owner 2026-10-10)', () => {
  it('the converted page with both cards deleted → both slots render the basic BlogCard, in the same batch', async () => {
    const page = TWO_SLOTS;
    const files = { 'src/pages/index.astro': page, 'src/components/BlogCard.astro': DEFAULT_CARD };
    h.rewrite.mockImplementation(async (list: string[], compute: (b: Record<string, string | null>) => Record<string, string | null>) =>
      Object.keys(compute(Object.fromEntries(list.map((f) => [f, (files as Record<string, string>)[f] ?? null])))));
    expect(await convertListsOnOpen({ files, blogSlotLibrary: 'LIB', exists: (f) => f in files, assignments: new Map(), fieldsOf: () => [{ name: 'title', type: 'text' }], ...undo() })).toBe(true);
    const out = (h.rewrite.mock.calls[0][1] as (b: Record<string, string | null>) => Record<string, string | null>)(files);
    expect(out['src/pages/index.astro']!.match(/<BlogCard post=\{post\} \/>/g)).toHaveLength(2);
  });
});

