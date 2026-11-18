import { describe, it, expect } from 'vitest';
import { resolveCanvasHtml } from '../canvasHtml';
import { addDataKeysToHtml } from '@/store/constants';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';

describe('regression: h2 inside inlined sub-component gets stamped data-key', () => {
  it('survives marker injection + full pipeline', () => {
    const headerHtml = '<header class="x"><nav><h2 class="text-2xl">Brand</h2><a>Features</a></nav></header>';
    const lib: ScannedComponent[] = [{
      name: 'Header', path: 'library/Header.astro', source: 'built-in',
      html: headerHtml, category: '', props: [], slots: [], dependencies: [],
    }];
    const blogPost = '<Layout><Header /><slot /></Layout>';

    const resolved = resolveCanvasHtml(blogPost, lib);
    const stamped = addDataKeysToHtml(resolved, (sel) => `el-1:${sel}`);

    expect(stamped).toMatch(/<h2[^>]*data-key="el-1:h2-0"/);
    expect(stamped).toMatch(/<header[^>]*data-sq-component-src="library\/Header\.astro"/);
  });
});
