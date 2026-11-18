import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverLayouts } from './layout-discovery';

describe('discoverLayouts', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'layouts-'));
    await writeFile(
      join(dir, 'Base.astro'),
      `---\nexport interface Props { title?: string }\nconst { title } = Astro.props;\n---\n<html><body><slot name="header" /><slot /></body></html>`,
    );
    await writeFile(
      join(dir, 'Marketing.astro'),
      `---\n---\n<html><body><slot /></body></html>`,
    );
  });

  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('returns one entry per .astro file with name, path, props, slots', async () => {
    const layouts = await discoverLayouts(dir);
    expect(layouts.map((l) => l.name).sort()).toEqual(['Base', 'Marketing']);
    const base = layouts.find((l) => l.name === 'Base')!;
    expect(base.props).toEqual([{ name: 'title', type: 'string', required: false }]);
    expect(base.slots.sort()).toEqual(['default', 'header']);
  });

  it('includes the frontmatter-stripped body with the <slot/> intact', async () => {
    const layouts = await discoverLayouts(dir);
    const base = layouts.find((l) => l.name === 'Base')!;
    expect(base.body).toContain('<slot');
    expect(base.body).not.toContain('Astro.props'); // frontmatter stripped
    // Full body chrome preserved, not a bare <slot/>.
    expect(base.body).toContain('<html>');
    expect(base.body).toContain('</body>');
  });

  it('skips non-astro files and files starting with underscore', async () => {
    await writeFile(join(dir, 'readme.md'), '');
    await writeFile(join(dir, '_Private.astro'), '---\n---\n<html/>');
    const layouts = await discoverLayouts(dir);
    expect(layouts.find((l) => l.name === '_Private')).toBeUndefined();
    expect(layouts.find((l) => l.name === 'readme')).toBeUndefined();
  });
});
