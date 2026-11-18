// Editorial layouts D10: AI post writes with <Stack> make sure the component
// file exists BEFORE the body (an import of a missing file blanks the page).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateCommandTools } from '../commandTools';
import { contentOps } from '@/core/collections/content-ops';
import { ensureSqComponent } from '@/components/PostEditor/ensureComponent';
import { makeCtx, type ExecTool } from './testCtx';

vi.mock('@/core/collections/content-ops', () => ({
  contentOps: {
    writeContentConfig: vi.fn(async () => undefined),
    fetchCollections: vi.fn(async () => [{ name: 'blog', posts: [{ slug: 'a', frontmatter: {}, body: 'Old' }] }]),
    createPost: vi.fn(async () => undefined),
    updatePost: vi.fn(async () => undefined),
    deletePost: vi.fn(async () => undefined),
  },
}));
vi.mock('@/components/PostEditor/ensureComponent', async (orig) => ({
  ...(await orig<typeof import('@/components/PostEditor/ensureComponent')>()),
  ensureSqComponent: vi.fn(async () => 'src/components/sq/Stack.astro'),
}));

const STACK = '<Stack direction="row">\n<div>\n\nA\n\n</div>\n<div>\n\nB\n\n</div>\n</Stack>\n';

beforeEach(() => vi.clearAllMocks());

describe('post tools + Stack', () => {
  it('update_post with <Stack ensures Stack before writing', async () => {
    const tools = generateCommandTools(makeCtx());
    const r = await (tools.update_post as ExecTool).execute({ collectionName: 'blog', slug: 'a', body: STACK });
    expect(r.success).toBe(true);
    expect(vi.mocked(ensureSqComponent).mock.calls[0]?.[1]).toBe('Stack');
    expect(contentOps.updatePost).toHaveBeenCalled();
  });

  it('create_post refuses (writes nothing) when Stack cannot be prepared', async () => {
    vi.mocked(ensureSqComponent).mockResolvedValueOnce(null);
    const tools = generateCommandTools(makeCtx());
    const r = await (tools.create_post as ExecTool).execute({ collectionName: 'blog', slug: 'b', frontmatter: {}, body: STACK });
    expect(r.success).toBe(false);
    expect(contentOps.createPost).not.toHaveBeenCalled();
  });

  it('a body without <Stack never touches the component', async () => {
    const tools = generateCommandTools(makeCtx());
    await (tools.create_post as ExecTool).execute({ collectionName: 'blog', slug: 'c', frontmatter: {}, body: 'Plain.' });
    expect(ensureSqComponent).not.toHaveBeenCalled();
  });
});

describe('post tool descriptions', () => {
  it('create_post and update_post teach the <Stack format', async () => {
    const { commandRegistry: COMMAND_REGISTRY } = await import('../commandRegistry');
    for (const name of ['create_post', 'update_post'] as const) {
      const entry = COMMAND_REGISTRY[name];
      expect(entry.description).toContain('<Stack');
      expect(entry.schema.shape.body.description).toContain('<Stack direction="row"');
    }
  });
});
