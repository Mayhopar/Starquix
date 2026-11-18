// task-248: read_page_seo / update_page_seo on files-truth projects write the
// REAL files (page <head> or layout props) through the durable journal — driven
// here against the real route table on a temp disk (projectFsRuntime).
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { flushDurableSourceWrites } from '@/services/durableEdits/sourceMaterialization';
import { _resetLocalPageSyncForTests } from '@/utils/localPageSync';
import { markFilesTruth, unmarkFilesTruth, localPageId } from '@/utils/localMode';
import { generateCommandTools } from '../commandTools';
import { makeCtx, type ExecTool } from './testCtx';

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

const INDEX = 'src/pages/index.astro';
const ABOUT = 'src/pages/about.astro';
const LAYOUT = 'src/layouts/Main.astro';
const INDEX_SRC = '<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <title>Home</title>\n  </head>\n  <body></body>\n</html>\n';
const LAYOUT_SRC = '---\nconst { title } = Astro.props;\n---\n<html>\n  <head>\n    <title>{title}</title>\n  </head>\n  <body><slot /></body>\n</html>\n';
const ABOUT_SRC = "---\nimport Layout from '../layouts/Main.astro';\n---\n<Layout title=\"About\">\n  <p>Hi</p>\n</Layout>\n";

let PROJECT_ID = '';
let runtime: ReturnType<typeof projectFsRuntime>;

function localCtx() {
  const ctx = makeCtx({ currentPageId: localPageId('/') });
  ctx.doc.getMap('meta').set('projectId', PROJECT_ID);
  return ctx;
}

beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  await db.delete(); await db.open();
  _resetLocalPageSyncForTests();
  PROJECT_ID = `browser_seo_${crypto.randomUUID()}`;
  markFilesTruth(PROJECT_ID);
  setActiveSaveProjectId(PROJECT_ID);
  runtime = projectFsRuntime(PROJECT_ID, { [INDEX]: INDEX_SRC, [ABOUT]: ABOUT_SRC, [LAYOUT]: LAYOUT_SRC });
});

afterEach(() => {
  runtime.close();
  unmarkFilesTruth(PROJECT_ID);
  setActiveSaveProjectId(null);
  vi.unstubAllGlobals();
});

describe('SEO tools on a files-truth project', () => {
  it('are advertised (the capability gate hid them until task-248)', () => {
    const tools = generateCommandTools(localCtx());
    expect(tools).toHaveProperty('read_page_seo');
    expect(tools).toHaveProperty('update_page_seo');
  });

  it('update_page_seo writes the page <head> and survives on disk; read_page_seo reads it back', async () => {
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    const r = await (tools.update_page_seo as ExecTool).execute({ pageId: localPageId('/'), field: 'description', value: 'We fix bikes.' });
    expect(r.success).toBe(true);
    expect(ctx.takeSnapshot).toHaveBeenCalled();
    await flushDurableSourceWrites(PROJECT_ID);
    expect(runtime.read(INDEX)).toContain('<meta name="description" content="We fix bikes." />');
    const read = await (tools.read_page_seo as ExecTool).execute({ pageId: localPageId('/') }) as unknown as {
      fields: Record<string, { value: unknown }>; completeness: { todo: string[] };
    };
    expect(read.fields.title.value).toBe('Home');
    expect(read.fields.description.value).toBe('We fix bikes.');
    expect(read.completeness.todo).toContain('Add a share image');
  });

  it('a layout page: the layout learns the prop, the page sets it — both files, one batch', async () => {
    const tools = generateCommandTools(localCtx());
    const r = await (tools.update_page_seo as ExecTool).execute({ pageId: localPageId('/about'), field: 'description', value: 'About us' });
    expect(r.success).toBe(true);
    await flushDurableSourceWrites(PROJECT_ID);
    expect(runtime.read(LAYOUT)).toContain('{description && <meta name="description" content={description} />}');
    expect(runtime.read(LAYOUT)).toContain('const { title, description } = Astro.props;');
    expect(runtime.read(ABOUT)).toContain('<Layout title="About" description="About us">');
  });

  it('refuses an unknown field or page honestly', async () => {
    const tools = generateCommandTools(localCtx());
    expect((await (tools.update_page_seo as ExecTool).execute({ pageId: localPageId('/'), field: 'keywords', value: 'x' })).success).toBe(false);
    expect((await (tools.update_page_seo as ExecTool).execute({ pageId: 'nope', field: 'title', value: 'x' })).success).toBe(false);
  });
});

