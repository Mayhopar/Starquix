// Editorial layouts: `/` → Text + image writes a row Stack + both imports
// through the real durable post path, after ensuring both component files.
import { TEXT_ITEMS } from '../SlashMenu';
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/react';

const captured = vi.hoisted(() => ({ editor: null as Editor | null, projectPath: '' }));
vi.mock('@tiptap/react', async original => {
  const actual = await original<typeof import('@tiptap/react')>();
  return { ...actual, useEditor: (...args: Parameters<typeof actual.useEditor>) => {
    const editor = actual.useEditor(...args); captured.editor = editor; return editor;
  } };
});
vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => captured.projectPath }));
vi.mock('@/hooks/useComponentLibrary', () => ({ useComponentLibrary: () => ({ userProject: [] }) }));

import { PostBodyEditor } from '../PostBodyEditor';
import { PostWriteQueue } from '@/postmodel/writeQueue';
import { db } from '@/db';
import { markFilesTruth } from '@/utils/localMode';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { readAcceptedPost } from '@/services/durableEdits/featureAcceptance';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { mdxCompiles } from '@/postmodel/compileGate';
import * as ensure from '../ensureComponent';

const TEMPLATES = join(__dirname, '../../../../../preview-template/src/components');
const file = 'src/content/works/a.mdx';
let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime> | undefined;
let queue: PostWriteQueue;

const seed = (body: string) => projectFsRuntime(projectId, {
  [file]: body,
  'src/components/sq/Stack.astro': readFileSync(join(TEMPLATES, 'Stack.astro'), 'utf8'),
  'src/components/sq/Media.astro': readFileSync(join(TEMPLATES, 'Media.astro'), 'utf8'),
  'package.json': '{"dependencies":{"@astrojs/mdx":"1.0.0"}}',
});

function mount(body: string) {
  runtime?.close();
  runtime = seed(body);
  queue = new PostWriteQueue({ projectId, collection: 'works', slug: 'a', format: 'mdx', baseline: { frontmatter: {}, body } });
  const view = render(<PostBodyEditor body={body} format="mdx" queue={queue}
    frontmatterRef={{ current: {} }} collection="works" slug="a" filePath={file} />);
  captured.editor!.view.coordsAtPos = () => ({ left: 10, right: 10, top: 20, bottom: 40 });
  return view;
}

beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  projectId = `stack_insert_${crypto.randomUUID()}`;
  markFilesTruth(projectId); setActiveSaveProjectId(projectId);
  captured.projectPath = `wc://${projectId}`;
  Range.prototype.getBoundingClientRect = () => new DOMRect(10, 20, 80, 20);
  Range.prototype.getClientRects = () => [new DOMRect(10, 20, 80, 20)] as unknown as DOMRectList;
});

afterEach(() => {
  queue.dispose(); runtime?.close(); runtime = undefined; setActiveSaveProjectId(null);
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it('Text + image: ensures Stack and Media, writes a row with both imports', async () => {
  const spy = vi.spyOn(ensure, 'ensureSqComponent');
  const view = mount('Intro.\n\n/\n');
  act(() => { captured.editor!.commands.setTextSelection(10); });
  const options = screen.getAllByRole('option').map(o => o.textContent);
  // writing blocks first, then the layouts
  expect(options.findIndex(o => o?.includes('Text + image'))).toBe(TEXT_ITEMS.length);
  fireEvent.click(screen.getByRole('option', { name: /Text \+ image/ }));
  await waitFor(() => expect(captured.editor!.getJSON().content?.some(n => n.type === 'stackRow')).toBe(true));
  await act(async () => { await queue.flushNow(); });
  expect(spy.mock.calls.map(c => c[1])).toEqual(['Stack', 'Media']);
  const body = (await readAcceptedPost(projectId, 'works', 'a')).body;
  expect(body).toBe("import Stack from '../../components/sq/Stack.astro';\nimport Media from '../../components/sq/Media.astro';\n\nIntro.\n\n<Stack direction=\"row\">\n<div>\n\n</div>\n<div>\n\n<Media items={[null]} />\n\n</div>\n</Stack>\n");
  expect(await mdxCompiles(body)).toEqual({ ok: true });
  // the caret landed in the empty first slot
  expect(captured.editor!.state.selection.$from.node(-1).type.name).toBe('stackSlot');
  view.unmount();
});

it('inside a layout, `/` lists no layouts', async () => {
  const body = "import Stack from '../../components/sq/Stack.astro';\n\n<Stack>\n\n/\n\n</Stack>\n";
  const view = mount(body);
  let pos = -1;
  captured.editor!.state.doc.descendants((n, p) => { if (n.isText && n.text === '/') pos = p + 1; });
  act(() => { captured.editor!.commands.setTextSelection(pos); });
  const options = screen.getAllByRole('option').map(o => o.textContent ?? '');
  expect(options.some(o => /Text \+ image|Two columns|Colored section/.test(o))).toBe(false);
  expect(options.some(o => o.includes('Media'))).toBe(true);
  view.unmount();
});

it('Media picked inside a layout lands inside it (no col-span wrapper class)', async () => {
  const body = "import Stack from '../../components/sq/Stack.astro';\n\n<Stack>\n\nText.\n\n/\n\n</Stack>\n";
  const view = mount(body);
  let pos = -1;
  captured.editor!.state.doc.descendants((n, p) => { if (n.isText && n.text === '/') pos = p + 1; });
  act(() => { captured.editor!.commands.setTextSelection(pos); });
  fireEvent.click(screen.getByRole('option', { name: /Media/ }));
  await waitFor(() => expect(JSON.stringify(captured.editor!.getJSON())).toContain('astroComponent'));
  await act(async () => { await queue.flushNow(); });
  expect((await readAcceptedPost(projectId, 'works', 'a')).body).toBe(
    "import Stack from '../../components/sq/Stack.astro';\nimport Media from '../../components/sq/Media.astro';\n\n<Stack>\n\nText.\n\n<Media items={[null]} />\n\n</Stack>\n");
  view.unmount();
});
