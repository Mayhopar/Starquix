import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { postRouteSource } from '@/core/post/postLayoutSource';

const h = vi.hoisted(() => ({ commit: vi.fn(), write: vi.fn(), source: '' }));
vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => 'wc://p' }));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ pushStructuralUndo: vi.fn() }) }));
vi.mock('@/utils/localPageSync', async (orig) => ({
  ...(await orig<typeof import('@/utils/localPageSync')>()),
  getLocalPageFile: () => 'src/pages/blog/[slug].astro',
  fetchLocalPageSource: async () => h.source,
}));
vi.mock('@/components/Editor/localBlogBind', () => ({ commitWholeLocalFile: (...a: unknown[]) => h.commit(...a) }));
vi.mock('@/utils/localElementSource', () => ({ writeLocalFile: (...a: unknown[]) => h.write(...a) }));

import { PostLayoutBlock } from '../PostLayoutBlock';
import { _resetStructuralWriteInFlightForTests } from '@/store/structuralWriteGuard';

beforeEach(() => {
  h.source = postRouteSource('blog', '../../layouts/PostLayout.astro');
  h.commit.mockReset().mockResolvedValue({ ok: true });
  h.write.mockReset().mockResolvedValue(undefined);
  _resetStructuralWriteInFlightForTests();
});

describe('PostLayoutBlock', () => {
  it('header variant → one undoable whole-file write of the <PostLayout> tag', async () => {
    render(<PostLayoutBlock />);
    fireEvent.click(await screen.findByText('Centered'));
    await waitFor(() => expect(h.commit).toHaveBeenCalledTimes(1));
    const arg = h.commit.mock.calls[0][0] as { file: string; before: string; after: string };
    expect(arg.file).toBe('src/pages/blog/[slug].astro');
    expect(arg.after).toContain('<PostLayout post={post} header="centered">');
  });

  it('a toggle writes show…={false}', async () => {
    render(<PostLayoutBlock />);
    fireEvent.click(await screen.findByLabelText('Cover image'));
    await waitFor(() => expect(h.commit).toHaveBeenCalled());
    expect((h.commit.mock.calls[0][0] as { after: string }).after).toContain('showCover={false}');
  });

  it('a page without a <PostLayout> tag shows nothing', async () => {
    h.source = '<main />';
    const { container } = render(<PostLayoutBlock />);
    await new Promise(r => setTimeout(r, 0));
    expect(container.textContent).toBe('');
  });

  it('the post editor passes its route and hears the accepted change (writing view re-draws its header)', async () => {
    const onChange = vi.fn();
    render(<PostLayoutBlock file="src/pages/notes/[slug].astro" onChange={onChange} />);
    fireEvent.click(await screen.findByText('Cover'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ header: 'cover' })));
    // no canvas surface owns this file: a plain write (the structural writer refused "another surface file", found live)
    expect(h.commit).not.toHaveBeenCalled();
    expect(h.write).toHaveBeenCalledWith('src/pages/notes/[slug].astro', expect.stringContaining('header="cover"'));
  });
});
