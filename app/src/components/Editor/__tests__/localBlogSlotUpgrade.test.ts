import { beforeEach, describe, expect, it, vi } from 'vitest';

const read = vi.fn<(file: string) => Promise<string>>();
const write = vi.fn(async () => {});
vi.mock('@/utils/localElementSource', () => ({ readLocalFile: (f: string) => read(f), writeLocalFile: (f: string, s: string) => write(f, s) }));

import { upgradeLocalBlogSlotChrome, SLOT_FILE } from '../localBlogSlotUpgrade';

const OLD = '<section class="bg-stone-100"><div data-blog-source="posts"></div><div data-blog-source="pagination"></div></section>\n';

describe('upgradeLocalBlogSlotChrome — the automatic, journaled slot upgrade', () => {
  beforeEach(() => { read.mockReset(); write.mockClear(); });
  it('rewrites an outdated project copy once, through the plain journaled write', async () => {
    read.mockResolvedValue(OLD);
    expect(await upgradeLocalBlogSlotChrome()).toEqual({ ok: true });
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toBe(SLOT_FILE);
    expect(write.mock.calls[0][1]).toBe('---\n// @sq-chrome 2\n---\n<section class="bg-stone-100 flex-wrap"><div class="w-full basis-full col-span-full" data-blog-source="posts"></div><div class="w-full basis-full col-span-full" data-blog-source="pagination"></div></section>\n');
  });
  it('writes nothing when the copy was already upgraded (stamped) — user edits since are kept', async () => {
    read.mockResolvedValue('---\n// @sq-chrome 2\n---\n<section class="bg-stone-100 flex-wrap"><div class="w-full basis-full col-span-full" data-blog-source="posts"></div><div class="w-full basis-full col-span-full" data-blog-source="pagination"></div></section>\n');
    expect(await upgradeLocalBlogSlotChrome()).toEqual({ ok: true });
    expect(write).not.toHaveBeenCalled();
  });
  it('an unreadable file reports a retryable failure, never a write', async () => {
    read.mockRejectedValue(new Error('404'));
    expect((await upgradeLocalBlogSlotChrome()).ok).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });
});
