// Auto text on a VARIABLE background is recomputed when the post opens.
import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import * as Y from 'yjs';
vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => null }));
vi.mock('@/hooks/useComponentLibrary', () => ({ useComponentLibrary: () => ({ userProject: [] }) }));
vi.mock('@/store/EditorContext', async orig => ({ ...(await orig<typeof import('@/store/EditorContext')>()), useOptionalEditorDoc: () => new Y.Doc() }));
vi.mock('@/store/variableSelectors', async orig => ({
  ...(await orig<typeof import('@/store/variableSelectors')>()),
  selectVariableCollections: () => [{ id: 'c', name: 'Colors', modes: [{ id: 'm', name: 'Light', isDefault: true }],
    variables: [{ id: 'v', name: 'brand', type: 'color', values: { m: { type: 'color', hex: '#0b1d3a', opacity: 1 } } }] }],
}));
import { PostBodyEditor } from '../PostBodyEditor';
import { PostWriteQueue } from '@/postmodel/writeQueue';

const IMP = "import Stack from '../../components/sq/Stack.astro';";

it('recomputes a stale Auto text class for a var() background, touching only that stack head', async () => {
  const body = `${IMP}\n\n<Stack class="bg-[var(--brand)] text-[#111111]" text="auto">\n\nDark now.\n\n</Stack>\n\n<Stack class="bg-[#ffffff] text-white" text="auto">\n\nHex bg is left alone.\n\n</Stack>\n`;
  const writes: string[] = [];
  const queue = new PostWriteQueue({ collection: 'works', slug: 'a', writePost: async (_c, _s, _fm, value) => { writes.push(value); } });
  const view = render(<PostBodyEditor body={body} format="mdx" queue={queue} frontmatterRef={{ current: {} }} collection="works" slug="a" filePath="src/content/works/a.mdx" />);
  view.unmount(); await queue.flushNow();
  expect(writes.at(-1)).toBe(body.replace('class="bg-[var(--brand)] text-[#111111]"', 'class="bg-[var(--brand)] text-white"'));
});
