// The COPIER's own guard. The built-in BlogPost is no longer offered anywhere
// (mergeScannedComponents drops page templates, HN report 2026-11-09 — pinned by
// localComponentInsert.everyListedBuiltInOpens.test.ts), so no user can pick
// it. It stays the real example of a library file that imports outside the
// library (`../../layouts/Layout.astro`): the copier must refuse it visibly and
// write nothing, never a silent return or an unhandled rejection (C6, 2026-08-26).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openDurableInsertProject, type DurableInsertProject } from './localInsertDurableHarness';

vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { default: toast };
});

import toast from 'react-hot-toast';
import { insertLocalComponent } from '../localComponentInsert';

const PAGE = 'src/pages/index.astro';
const PAGE_SOURCE = '<main>\n</main>\n';
let project: DurableInsertProject;

const BLOG_POST_RAW = `---
import Layout from '../../layouts/Layout.astro';
import Header from './Header.astro';
---
<Layout><article class="post"><slot /></article></Layout>
`;

const blogPost = {
  name: 'BlogPost',
  path: 'library/BlogPost.astro',
  source: 'built-in' as const,
  html: '<article class="post"></article>',
  category: 'Pages',
  props: [],
  slots: [],
  dependencies: [],
};

describe('local ⌘K BlogPost — honest refusal, never silent', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Files-truth: scan-components/writes go through the real route table
    // (localFetch); only the dev raw built-in source read is a page fetch.
    project = await openDurableInsertProject({ [PAGE]: PAGE_SOURCE });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/__sq/component-html')) {
        return new Response(BLOG_POST_RAW, { status: 200, headers: { 'content-type': 'text/plain' } });
      }
      return new Response('not found', { status: 404 });
    }));
  });
  afterEach(async () => { await project.close(); vi.unstubAllGlobals(); });

  it('refuses with a toast naming the out-of-library layout dependency', async () => {
    const res = await insertLocalComponent({
      component: blogPost,
      selection: null,
      scannedElements: [],
      pageFile: PAGE,
      localProjectPath: project.folder,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/Layout\.astro|outside the component library/);
    // The refusal is VISIBLE — some toast fired (plain or error).
    const toastFn = toast as unknown as ReturnType<typeof vi.fn> & { error: ReturnType<typeof vi.fn> };
    const fired = toastFn.mock.calls.length + toastFn.error.mock.calls.length;
    expect(fired).toBeGreaterThan(0);
    // Nothing was written: no import, no tag, no copied component.
    await project.flush();
    expect(project.read(PAGE)).toBe(PAGE_SOURCE);
  });
});
