// Local-mode layout apply (files-truth): picking a layout from ⌘K rewrites
// the REAL page file (import + wrapper) instead of falling into
// insertLocalComponent (which refused it with the task-149 "has no markup"
// toast — layouts scan with html:''). Undo is a WHOLE-FILE byte-exact
// restore through the existing restore-region channel (mid-line splice
// inverses silently deleted wrong elements — task-133 law).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/ViteStructuralWriter', () => ({
  viteStructuralWriter: {
    writeRestoreRegion: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { default: toast };
});

import toast from 'react-hot-toast';
import { viteStructuralWriter } from '@/services/ViteStructuralWriter';
import { isLayoutComponent, applyLayoutToPage, fileLineSpan, applyLocalPageLayout } from '../localLayoutApply';
import { detectPageLayout } from '@/utils/detectPageLayout';
// The import specifier applyLocalPageLayout writes is the SHARED one that
// local component inserts use (utils/localStructural) — no second spelling.
import { importSpecifierFor } from '@/utils/localStructural';
import { layoutToScannedComponent, type ScannedLayout } from '@/hooks/useLayoutLibrary';
import { _resetStructuralWriteInFlightForTests, releaseStructuralWrite, tryAcquireStructuralWrite } from '../localStructuralOps';
import { _resetLocalPageSyncForTests } from '@/utils/localPageSync';
// The REAL plugin restore function — proves the pushed inverse restores the
// exact original bytes through the same code path ⌘Z replays.
import { restoreRegionAtLocation } from '../../../../../preview-template/src/plugins/sq-source-plugin.js';
import type { StructuralUndoRecord, StructuralOp } from '@/store/structuralUndo';

const writeRestoreRegion = viteStructuralWriter.writeRestoreRegion as ReturnType<typeof vi.fn>;

const PAGE = 'src/pages/index.astro';
const PROJECT = '/Users/x/site';

const userLayout: ScannedLayout = {
  name: 'Base',
  path: 'Base.astro',
  absolutePath: '/Users/x/site/src/layouts/Base.astro',
  props: [],
  slots: ['default'],
  frontmatter: '',
  body: '<html><body><slot /></body></html>',
  source: 'user-project',
};

const layoutComponent = layoutToScannedComponent(userLayout);

const heroComponent = {
  name: 'hero',
  path: 'src/components/hero.astro',
  source: 'user-project' as const,
  html: '<section></section>',
  category: 'Other',
  props: [],
  slots: [],
  dependencies: [],
};

/** Full HTML document page WITHOUT a layout — the common real-Astro shape. */
const FULL_DOC_PAGE = `---
const title = 'Home';
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>{title}</title>
  </head>
  <body>
    <main class="hero">
      <h1>{title}</h1>
    </main>
    <script src="/analytics.js"></script>
  </body>
</html>
`;

const PAGE_WITH_LAYOUT = `---
import Base from '../layouts/Base.astro';
const n = 1;
---
<Base title="hi">
  <main class="hero">
    <h1>Kept {n}</h1>
  </main>
</Base>
`;

function mockPageSource(content: string) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ content }), { status: 200 }) as Response,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  _resetStructuralWriteInFlightForTests();
  _resetLocalPageSyncForTests();
  writeRestoreRegion.mockResolvedValue({ success: true, restoredLine: 1, file: PAGE });
});

describe('isLayoutComponent (routing: layouts must NOT reach insertLocalComponent)', () => {
  it('a local user-project layout pick IS a layout (routes to apply, not insert)', () => {
    expect(isLayoutComponent(layoutComponent)).toBe(true);
  });

  it('a built-in layout path is a layout too', () => {
    expect(isLayoutComponent({ ...heroComponent, path: 'layouts/Marketing.astro' })).toBe(true);
  });

  it('a normal component is not', () => {
    expect(isLayoutComponent(heroComponent)).toBe(false);
  });
});

describe('layoutToScannedComponent carries the real body (task-149 false-empty fix)', () => {
  it('user-project layouts pass their template body through as html', () => {
    expect(layoutComponent.html).toBe(userLayout.body);
  });

  it('built-in layouts pass their template body through as html', () => {
    expect(layoutToScannedComponent({ ...userLayout, source: 'built-in' }).html).toBe(userLayout.body);
  });
});

describe('detectPageLayout', () => {
  it('finds a frontmatter layouts/ import whose tag wraps the body', () => {
    expect(detectPageLayout(PAGE_WITH_LAYOUT)).toEqual({
      name: 'Base',
      importPath: '../layouts/Base.astro',
    });
  });

  it('a full HTML document page has no layout', () => {
    expect(detectPageLayout(FULL_DOC_PAGE)).toBeNull();
  });

  it('a layouts/ import that does NOT wrap the body is not the page layout', () => {
    const src = `---\nimport Base from '../layouts/Base.astro';\n---\n<div><Base /></div>\n`;
    expect(detectPageLayout(src)).toBeNull();
  });

  it('a self-closing wrapper counts (empty page with layout)', () => {
    const src = `---\nimport Base from '../layouts/Base.astro';\n---\n<Base />\n`;
    expect(detectPageLayout(src)?.name).toBe('Base');
  });
});

describe('applyLayoutToPage', () => {
  it('full-document page: boilerplate stripped, BODY inner preserved and wrapped', () => {
    const out = applyLayoutToPage(FULL_DOC_PAGE, 'Base', '../layouts/Base.astro');
    // import added to the EXISTING frontmatter
    expect(out).toContain("const title = 'Home';");
    expect(out).toContain("import Base from '../layouts/Base.astro';");
    // document boilerplate gone
    expect(out).not.toMatch(/<!doctype|<html|<head|<body/i);
    // body inner preserved byte-for-byte (scripts included)
    expect(out).toContain('<main class="hero">\n      <h1>{title}</h1>\n    </main>\n    <script src="/analytics.js"></script>');
    // wrapped
    expect(out.trim().split(/\n/).find((l) => l.startsWith('<'))).toBe('<Base>');
    expect(out.trim().endsWith('</Base>')).toBe(true);
    // head-only content is dropped by design (the layout provides the head)
    expect(out).not.toContain('<meta charset');
  });

  it('empty layout-less page: frontmatter created, empty wrapper written', () => {
    const out = applyLayoutToPage('', 'Base', '../layouts/Base.astro');
    expect(out).toBe("---\nimport Base from '../layouts/Base.astro';\n---\n\n<Base>\n</Base>\n");
  });

  it('replace: import + wrapper tags swapped, inner content byte-for-byte', () => {
    const out = applyLayoutToPage(PAGE_WITH_LAYOUT, 'Marketing', '../layouts/Marketing.astro');
    expect(out).toContain("import Marketing from '../layouts/Marketing.astro';");
    expect(out).not.toContain('layouts/Base.astro');
    expect(out).toContain('<Marketing title="hi">');
    expect(out).toContain('</Marketing>');
    // inner bytes untouched
    expect(out).toContain('  <main class="hero">\n    <h1>Kept {n}</h1>\n  </main>');
    // rest of the frontmatter untouched
    expect(out).toContain('const n = 1;');
  });

  it('fragment page (no document tags): content wrapped as-is', () => {
    const src = '<main>\n  <h1>Hi</h1>\n</main>\n';
    const out = applyLayoutToPage(src, 'Base', '../layouts/Base.astro');
    expect(out).toBe(
      "---\nimport Base from '../layouts/Base.astro';\n---\n\n<Base>\n<main>\n  <h1>Hi</h1>\n</main>\n</Base>\n",
    );
  });
});

describe('importSpecifierFor — the layout import path', () => {
  it('page at src/pages → ../layouts', () => {
    expect(importSpecifierFor('src/pages/index.astro', 'src/layouts/Base.astro')).toBe('../layouts/Base.astro');
  });
  it('nested page → ../../layouts', () => {
    expect(importSpecifierFor('src/pages/blog/[slug].astro', 'src/layouts/Base.astro')).toBe('../../layouts/Base.astro');
  });
  it('same directory → ./', () => {
    expect(importSpecifierFor('src/pages/index.astro', 'src/pages/Widget.astro')).toBe('./Widget.astro');
  });
});

describe('applyLocalPageLayout', () => {
  const args = () => ({
    component: layoutComponent,
    pageFile: PAGE,
    localProjectPath: PROJECT,
  });

  it('same layout already applied → noop toast, NO write', async () => {
    mockPageSource(PAGE_WITH_LAYOUT);
    const r = await applyLocalPageLayout({
      ...args(),
      component: { ...layoutComponent, name: 'Base' },
    });
    expect(r.ok).toBe(false);
    expect(writeRestoreRegion).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('Layout "Base" is already applied');
  });

  it('replacing an existing layout applies directly — no native confirm (owner rule), undo restores the bytes', async () => {
    mockPageSource(PAGE_WITH_LAYOUT);
    const confirm = vi.spyOn(window, 'confirm');
    const r = await applyLocalPageLayout({
      ...args(),
      component: { ...layoutComponent, name: 'Marketing', path: 'src/layouts/Marketing.astro' },
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
    expect(writeRestoreRegion).toHaveBeenCalledTimes(1);
  });

  it('page with content applies directly: whole-file write + success toast', async () => {
    mockPageSource(FULL_DOC_PAGE);
    const confirm = vi.spyOn(window, 'confirm');
    const r = await applyLocalPageLayout(args());
    expect(confirm).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true, file: PAGE, insertedLine: 1 });
    const [loc, lineCount, segment] = writeRestoreRegion.mock.calls[0];
    expect(loc).toEqual({ file: PAGE, line: 1, column: 1 });
    expect(lineCount).toBe(fileLineSpan(FULL_DOC_PAGE));
    expect(segment).toBe(applyLayoutToPage(FULL_DOC_PAGE, 'Base', '../layouts/Base.astro'));
    expect(toast.success).toHaveBeenCalledWith('Applied layout Base');
  });

  it('empty layout-less page applies silently (no confirm)', async () => {
    mockPageSource('');
    const confirm = vi.spyOn(window, 'confirm');
    const r = await applyLocalPageLayout(args());
    expect(confirm).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
  });

  it('undo record restores the EXACT original file bytes (real plugin replay)', async () => {
    mockPageSource(FULL_DOC_PAGE);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const records: StructuralUndoRecord[] = [];
    await applyLocalPageLayout({ ...args(), pushUndo: (rec) => records.push(rec) });

    expect(records).toHaveLength(1);
    const { forward, inverse } = records[0].structuralOp;
    const after = applyLayoutToPage(FULL_DOC_PAGE, 'Base', '../layouts/Base.astro');

    // forward (redo) replays the whole-file apply
    expect(forward).toEqual([
      { kind: 'restore-region', loc: { file: PAGE, line: 1, column: 1 }, lineCount: fileLineSpan(FULL_DOC_PAGE), segment: after },
    ]);
    // inverse (⌘Z) is a WHOLE-FILE restore — replay it through the REAL
    // plugin restore function against the post-apply content.
    const inv = inverse[0] as Extract<StructuralOp, { kind: 'restore-region' }>;
    expect(inv.kind).toBe('restore-region');
    const restored = restoreRegionAtLocation(after, inv.loc, inv.lineCount, inv.segment);
    expect(restored.content).toBe(FULL_DOC_PAGE);
  });

  it('failed write → error toast, NO undo record', async () => {
    mockPageSource('');
    writeRestoreRegion.mockResolvedValue({ success: false });
    const records: StructuralUndoRecord[] = [];
    const r = await applyLocalPageLayout({ ...args(), pushUndo: (rec) => records.push(rec) });
    expect(r.ok).toBe(false);
    expect(records).toHaveLength(0);
    expect(toast.error).toHaveBeenCalled();
  });

  it('refuses a non-page target (component view) before any read', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const r = await applyLocalPageLayout({ ...args(), pageFile: 'src/components/Card.astro' });
    expect(r.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a built-in layout path (not a file in the user project)', async () => {
    const r = await applyLocalPageLayout({
      ...args(),
      component: { ...layoutComponent, path: 'layouts/Marketing.astro' },
    });
    expect(r.ok).toBe(false);
    expect(writeRestoreRegion).not.toHaveBeenCalled();
  });

  it('serializes against other structural writes (shared guard): waits its turn, then applies', async () => {
    mockPageSource('');
    expect(tryAcquireStructuralWrite()).toBe(true); // another write in flight
    const pending = applyLocalPageLayout(args());
    await new Promise((r) => setTimeout(r, 0));
    expect(writeRestoreRegion).not.toHaveBeenCalled();
    releaseStructuralWrite();
    expect((await pending).ok).toBe(true);
    expect(writeRestoreRegion).toHaveBeenCalledTimes(1);
  });

  it('releases the guard after a successful apply', async () => {
    mockPageSource('');
    await applyLocalPageLayout(args());
    expect(tryAcquireStructuralWrite()).toBe(true); // free again
  });
});

describe('head-loss guard (C3 local, 2026-08-26)', () => {
  const args = () => ({
    component: layoutComponent,
    pageFile: PAGE,
    localProjectPath: PROJECT,
  });
  // Disk-proven data loss: applying a layout to a page whose <body> was empty
  // but whose <head> held a real <title> matched the "empty page" decision and
  // SILENTLY replaced the page's own head with the layout shell. Any apply
  // that drops head bytes must confirm first, naming the head replacement.
  const HEAD_ONLY_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>My page title</title>
  </head>
  <body>
  </body>
</html>
`;

  it('empty-body page with its own <head> applies without a native confirm (the layout provides the head; undo restores it)', async () => {
    mockPageSource(HEAD_ONLY_PAGE);
    const confirm = vi.spyOn(window, 'confirm');
    const r = await applyLocalPageLayout(args());
    expect(confirm).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
    expect(writeRestoreRegion).toHaveBeenCalledTimes(1);
  });

  it('page with content AND its own <head> applies without a native confirm', async () => {
    mockPageSource(FULL_DOC_PAGE);
    const confirm = vi.spyOn(window, 'confirm');
    const r = await applyLocalPageLayout(args());
    expect(confirm).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
  });

  it('page with no <head> of its own still applies silently', async () => {
    mockPageSource('<main>x</main>');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await applyLocalPageLayout(args());
    // Content confirm may fire, but never a head warning.
    for (const call of confirm.mock.calls) {
      expect(String(call[0])).not.toMatch(/head/i);
    }
  });
});


describe('applyLayoutToPage — stale import, no wrapper (owner break 2026-08-27)', () => {
  it('does not duplicate an existing import of the same layout', () => {
    // Deleting the wrapper tag leaves the import behind; re-applying used to
    // append `import Layout1` a second time — a duplicate binding that broke
    // the page build (owner's blog.astro, live).
    const src = [
      '---',
      "import BlogSlot from '../components/BlogSlot.astro';",
      "import Layout1 from '../layouts/Layout1.astro';",
      '---',
      '',
      '<BlogSlot />',
      '',
    ].join('\n');
    const out = applyLayoutToPage(src, 'Layout1', '../layouts/Layout1.astro');
    const importCount = (out.match(/import Layout1 /g) || []).length;
    expect(importCount).toBe(1);
    expect(out).toContain('<Layout1>');
    expect(out).toContain('</Layout1>');
    expect(out).toContain('<BlogSlot />');
  });
});
