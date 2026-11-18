/**
 * Windows port (2026-11-10): every path the instance hands the editor is POSIX (`src/pages/x.astro`) — the write
 * routes refuse a backslash (sq-project-fs-routes.js), so a native `path.relative` key broke every canvas edit on
 * Windows. Node's path is swapped for path.win32: the real plugin modules run with Windows path rules on any OS.
 * The disk-writing helpers are covered on a real disk by windows-paths.fs.test.ts (it bites on the Windows CI).
 */
import { describe, it, expect, vi } from 'vitest';
import { parse } from '@astrojs/compiler';

// importOriginal() is empty for builtins here: take the real module through require.
vi.mock('node:path', async () => {
  const { win32 } = (await import('node:module')).createRequire(import.meta.url)('node:path') as typeof import('node:path');
  return { ...win32, default: win32 };
});
vi.mock('path', async () => {
  const { win32 } = (await import('node:module')).createRequire(import.meta.url)('node:path') as typeof import('node:path');
  return { ...win32, default: win32 };
});

// eslint-disable-next-line import/no-relative-packages
const { transformCompiledOutput } = await import('../../../../preview-template/src/plugins/sq-tagging.js');
// eslint-disable-next-line import/no-relative-packages
const { sqRehypeSource } = await import('../../../../preview-template/src/plugins/sq-source-plugin.js');
// eslint-disable-next-line import/no-relative-packages
const { extractCategory } = await import('../../../../preview-template/src/plugins/sq-project-fs.js');

describe('Windows paths reach the editor as POSIX', () => {
  it('the .astro tagger keys elements with the project path in forward slashes (Vite ids are C:/…, the root C:\\…)', async () => {
    const source = '---\n---\n<section class="page">\n  <h1>Hi</h1>\n</section>\n';
    const compiled = '$$render`<section class="page">\n  <h1>Hi</h1>\n</section>`;\n},';
    const out = await transformCompiledOutput(compiled, source, 'C:/site/src/pages/index.astro', 'C:\\site', 'relative', parse);
    const code = (out as { code: string }).code;
    expect(code).toMatch(/<section data-sq-source="src\/pages\/index\.astro:\d+:\d+"/);
    expect(code).toMatch(/<h1 data-sq-source="src\/pages\/index\.astro:\d+:\d+"/);
  });

  it('MDX stamps carry the project path in forward slashes', () => {
    const p = { type: 'element', tagName: 'p', properties: {} as Record<string, unknown>, children: [],
      position: { start: { line: 3, column: 1 }, end: { line: 3, column: 6 } } };
    sqRehypeSource()({ type: 'root', children: [p] }, { path: 'C:\\site\\src\\content\\blog\\post.mdx', cwd: 'C:\\site', value: 'Hello' });
    expect(p.properties.dataSqSource).toMatch(/^src\/content\/blog\/post\.mdx:\d+:\d+$/);
  });

  it('a nested component folder names its category by its first folder', () => {
    expect(extractCategory('', 'C:\\site\\src\\components\\ui\\forms\\Input.astro', 'C:\\site\\src\\components')).toBe('Ui');
  });
});
