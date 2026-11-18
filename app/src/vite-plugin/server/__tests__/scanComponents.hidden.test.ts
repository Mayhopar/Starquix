/** Design P2: Stack is system-driven — no component surface may list it. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanComponents } from '../../../../../preview-template/src/plugins/sq-project-fs.js';

const TEMPLATES = join(__dirname, '../../../../..', 'preview-template/src/components');
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sq-hidden-'));
  mkdirSync(join(dir, 'src/components/sq'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { '@astrojs/mdx': '^3' } }));
  for (const n of ['Stack', 'Media']) {
    writeFileSync(join(dir, `src/components/sq/${n}.astro`), readFileSync(join(TEMPLATES, `${n}.astro`), 'utf8'));
  }
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('scanComponents hides SQ_HIDDEN', () => {
  it('drops sq/Stack.astro, keeps sq/Media.astro', async () => {
    const paths = (await scanComponents(dir)).map(c => c.path);
    expect(paths.some(p => p.endsWith('sq/Stack.astro'))).toBe(false);
    expect(paths).toContain('src/components/sq/Media.astro');
  });
});
