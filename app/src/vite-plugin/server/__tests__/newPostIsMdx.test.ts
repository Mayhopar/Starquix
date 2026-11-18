/**
 * projectHasMdx gates ensureSqComponent: our components are only copied into a
 * project that compiles MDX — an .mdx post in a project without @astrojs/mdx
 * never renders at all.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { projectHasMdx } from '../../project-fs';

let dir: string;

beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'sq-mdx-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('projectHasMdx', () => {
  it('honours @astrojs/mdx in devDependencies too', () => {
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ devDependencies: { '@astrojs/mdx': '^3' } }));
    expect(projectHasMdx(dir)).toBe(true);
  });

  it('is false when there is no readable package.json', () => {
    expect(projectHasMdx(path.join(dir, 'nope'))).toBe(false);
  });
});
