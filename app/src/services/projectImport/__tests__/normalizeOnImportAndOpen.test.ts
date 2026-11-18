import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { db } from '@/db';
import { readProjectFiles, putProjectFiles } from '@/db/projectFiles';
import { importFilesTruthProject } from '../createFilesTruthProject';

const DIR = join(__dirname, 'fixtures', 'md-site');
function fixture(prefix = '') {
  const out: Array<{ path: string; content: Uint8Array }> = [];
  const walk = (d: string) => readdirSync(d).forEach(n => {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else out.push({ path: prefix + relative(DIR, p).replace(/\.fixture$/, ''), content: new Uint8Array(readFileSync(p)) });
  });
  walk(DIR);
  return out;
}

beforeEach(async () => { await db.delete(); await db.open(); localStorage.clear(); });

it('import of an .md site yields .mdx posts + the unfixable .md', async () => {
  const r = await importFilesTruthProject(fixture('site/'), 'MD site');
  const files = Object.keys(await readProjectFiles(r.projectId));
  expect(files).toContain('src/content/blog/a.mdx');
  expect(files).toContain('src/content/blog/b.md');
  expect(files).not.toContain('src/content/blog/a.md');
  expect(files).toContain('src/components/sq/sq-utilities.css');
});
