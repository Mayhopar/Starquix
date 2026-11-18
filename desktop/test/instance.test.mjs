import { afterEach, describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installSqFiles } from '../src/instance.mjs';

const owned = [];
const tmp = async () => { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-desktop-')); owned.push(dir); return dir; };
afterEach(async () => { await Promise.all(owned.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); });
const TEMPLATE = path.resolve(import.meta.dirname, '../../preview-template');

describe('installSqFiles', () => {
  it('copies our plugin/bridge/views under .sq/', async () => {
    const project = await tmp();
    await installSqFiles(TEMPLATE, project);
    await fs.access(path.join(project, '.sq/src/plugins/sq-source-plugin.js'));
    await fs.access(path.join(project, '.sq/public/scripts/bridge.js'));
    await fs.access(path.join(project, '.sq/src/components/SqComponentView.astro'));
  });

  it('writes a minimal astro.config.mjs when the project has none', async () => {
    const project = await tmp();
    await installSqFiles(TEMPLATE, project);
    expect(await fs.readFile(path.join(project, 'astro.config.mjs'), 'utf8')).toContain('defineConfig');
  });

  it('content folders with no content config get an empty one; an existing one stays', async () => {
    const project = await tmp();
    await fs.mkdir(path.join(project, 'src/content/works'), { recursive: true });
    await installSqFiles(TEMPLATE, project);
    expect(await fs.readFile(path.join(project, 'src/content/config.ts'), 'utf8')).toBe('export const collections = {};\n');
    const modern = await tmp();
    await fs.mkdir(path.join(modern, 'src/content/works'), { recursive: true });
    await fs.writeFile(path.join(modern, 'src/content.config.ts'), 'export const collections = { works };\n');
    await installSqFiles(TEMPLATE, modern);
    await expect(fs.access(path.join(modern, 'src/content/config.ts'))).rejects.toThrow();
    const none = await tmp();
    await installSqFiles(TEMPLATE, none);
    await expect(fs.access(path.join(none, 'src/content'))).rejects.toThrow();
  });

  it('keeps an existing config file and adds none', async () => {
    const project = await tmp();
    await fs.writeFile(path.join(project, 'astro.config.ts'), 'export default {};\n');
    await installSqFiles(TEMPLATE, project);
    await expect(fs.access(path.join(project, 'astro.config.mjs'))).rejects.toThrow();
  });
});
