import { describe, it, expect } from 'vitest';
import { ensureStackImport } from '../ensureStackImport';
import { mdxCompiles } from '@/postmodel/compileGate';

const POST = 'src/content/blog/a.mdx';
const OURS = "import Stack from '../../components/sq/Stack.astro';";
const ROW = '<Stack direction="row">\n<div>\n\nA\n\n</div>\n<div>\n\nB\n\n</div>\n</Stack>\n';

describe('ensureStackImport', () => {
  it('adds our import at the top, blank line before the body', async () => {
    const out = ensureStackImport(`Intro.\n\n${ROW}`, POST);
    expect(out).toBe(`${OURS}\n\nIntro.\n\n${ROW}`);
    expect(await mdxCompiles(out)).toEqual({ ok: true });
  });

  it('already imported from our path → same string', () => {
    const body = `${OURS}\n\n${ROW}`;
    expect(ensureStackImport(body, POST)).toBe(body);
  });

  it("the user's own Stack binding wins → unchanged", () => {
    const body = `import Stack from '../../components/Stack.astro';\n\n${ROW}`;
    expect(ensureStackImport(body, POST)).toBe(body);
  });

  it('no <Stack → unchanged', () => {
    expect(ensureStackImport('Just text, Stacks of it.\n', POST)).toBe('Just text, Stacks of it.\n');
  });

  it('goes after the last existing import', async () => {
    const media = "import Media from '../../components/sq/Media.astro';";
    const out = ensureStackImport(`${media}\n\n${ROW}`, POST);
    expect(out).toBe(`${media}\n${OURS}\n\n${ROW}`);
    expect(await mdxCompiles(out)).toEqual({ ok: true });
  });

  it('path is relative to a nested post', () => {
    expect(ensureStackImport(ROW, 'src/content/blog/2024/deep.mdx'))
      .toContain("import Stack from '../../../components/sq/Stack.astro';");
  });

  it('.md posts are never touched (no JSX there)', () => {
    expect(ensureStackImport(ROW, 'src/content/blog/a.md')).toBe(ROW);
  });
});
