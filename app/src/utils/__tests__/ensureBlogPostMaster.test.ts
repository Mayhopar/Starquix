import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { ensureBlogPostMasterSeeded, refreshMasterFromSource } from '../ensureBlogPostMaster';
import { readComponentSource } from '../componentSourceReader';
import { selectMasterMarkup } from '@/store/masters';
import { applyCommand } from '@/store/commands';
import { readLocalFile } from '@/utils/localElementSource';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';

vi.mock('@/utils/localElementSource', () => ({ readLocalFile: vi.fn() }));
vi.mock('../componentSourceReader', () => ({
  readComponentSource: vi.fn(),
}));

function mk(name: string, path: string, html: string): ScannedComponent {
  return {
    name, path, source: 'built-in',
    html, category: '', props: [], slots: [], dependencies: [],
  };
}

const RAW_BLOGPOST = '<Layout title={title}>\n  <GlobalNav />\n  <slot />\n</Layout>';
const blogPost = mk('BlogPost', 'library/BlogPost.astro', RAW_BLOGPOST);
const globalNav = mk('GlobalNav', 'library/navigation/GlobalNav.astro', '<header class="gn">nav</header>');

beforeEach(() => {
  // Instance not answering (boot race): the scanned html stands in.
  vi.mocked(readLocalFile).mockReset();
  vi.mocked(readLocalFile).mockRejectedValue(new Error('Could not read the file (503)'));
});

describe('ensureBlogPostMasterSeeded', () => {
  // The bug: a doc whose masters were never seeded (or purged) renders post
  // pages from the wrapper's frozen first-wrap staticMarkup forever — the nav
  // added to BlogPost.astro only appeared after the user happened to open the
  // BlogPost master in Assets (which runs the seed as a side effect).
  it('post-page open seeds the BlogPost master + missing child masters (no Assets visit needed)', async () => {
    const doc = new Y.Doc();

    const seeded = await ensureBlogPostMasterSeeded(doc, [blogPost, globalNav]);

    expect(seeded).toBe(true);
    const master = selectMasterMarkup(doc, 'library/BlogPost.astro');
    // Placeholder wire format — same shape the master-editor open writes.
    expect(master).toContain('<sq-child');
    expect(master).toContain('library/navigation/GlobalNav.astro');
    // Child master seeded too: expandLeftoverPlaceholders reads masters ONLY —
    // without this entry the nav still drops from the page.
    expect(selectMasterMarkup(doc, 'library/navigation/GlobalNav.astro')).toContain('gn');
  });

  it('never overwrites an existing BlogPost master (bake-on-leave stays authoritative)', async () => {
    const doc = new Y.Doc();
    const edited =
      '<layout class="edited-by-user"><sq-child data-sq-astro-source="library/navigation/GlobalNav.astro" data-sq-placement="globalnav-0"></sq-child><slot></slot></layout>';
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: 'library/BlogPost.astro', markup: edited });

    await ensureBlogPostMasterSeeded(doc, [blogPost, globalNav]);

    // Parent untouched — a stale source read must never clobber a fresh bake.
    expect(selectMasterMarkup(doc, 'library/BlogPost.astro')).toContain('edited-by-user');
    // But a missing child master is still seeded from the stored wire format.
    expect(selectMasterMarkup(doc, 'library/navigation/GlobalNav.astro')).toContain('gn');
  });

  it('is idempotent: second call writes nothing', async () => {
    const doc = new Y.Doc();
    await ensureBlogPostMasterSeeded(doc, [blogPost, globalNav]);
    const master = selectMasterMarkup(doc, 'library/BlogPost.astro');

    const second = await ensureBlogPostMasterSeeded(doc, [blogPost, globalNav]);

    expect(second).toBe(false);
    expect(selectMasterMarkup(doc, 'library/BlogPost.astro')).toBe(master);
  });

  it('returns false when BlogPost is not in the library (cold scan)', async () => {
    const doc = new Y.Doc();
    expect(await ensureBlogPostMasterSeeded(doc, [globalNav])).toBe(false);
    expect(selectMasterMarkup(doc, 'library/BlogPost.astro')).toBeUndefined();
  });
});

describe('refreshMasterFromSource', () => {
  const logos = mk('Logos', 'library/Logos.astro', '<section class="lg">logos</section>');

  // The bug: an add in the master editor lands in the SOURCE (append flush on
  // leave) but the bake can't see it (no placeholder in the editor markup), so
  // masters — and every post page — lagged until the next master OPEN.
  it('leave-time refresh: re-resolves the source so an appended component reaches masters', async () => {
    const doc = new Y.Doc();
    applyCommand(doc, {
      type: 'SET_MASTER_MARKUP',
      astroSource: 'library/BlogPost.astro',
      markup: '<layout class="bg-white"><sq-child data-sq-astro-source="library/navigation/GlobalNav.astro" data-sq-placement="globalnav-0"></sq-child><slot></slot></layout>',
    });
    // Post-append source: Logos now in the file, not yet in masters.
    vi.mocked(readComponentSource).mockResolvedValue(
      '<Layout title={title}>\n  <GlobalNav />\n  <slot />\n  <Logos />\n</Layout>',
    );

    const ok = await refreshMasterFromSource(doc, 'library/BlogPost.astro', [blogPost, globalNav, logos]);

    expect(ok).toBe(true);
    const master = selectMasterMarkup(doc, 'library/BlogPost.astro');
    expect(master).toContain('library/Logos.astro');
    expect(master).toContain('library/navigation/GlobalNav.astro');
    // New child master seeded so pages can expand the placeholder.
    expect(selectMasterMarkup(doc, 'library/Logos.astro')).toContain('lg');
  });

  it('read failure keeps the baked master untouched (next open heals)', async () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: 'library/BlogPost.astro', markup: '<layout class="baked"><slot></slot></layout>' });
    vi.mocked(readComponentSource).mockRejectedValue(new Error('both reads failed'));

    expect(await refreshMasterFromSource(doc, 'library/BlogPost.astro', [blogPost])).toBe(false);
    expect(selectMasterMarkup(doc, 'library/BlogPost.astro')).toContain('baked');
  });
});
