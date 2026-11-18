import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveComponentEditorOpen } from '../canvasHtml';
import { readLocalFile } from '@/utils/localElementSource';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';

vi.mock('@/utils/localElementSource', () => ({ readLocalFile: vi.fn() }));

function mk(name: string, path: string, html: string): ScannedComponent {
  return {
    name, path, source: 'built-in',
    html, category: '', props: [], slots: [], dependencies: [],
  };
}

// Raw scanned source of a page template — what /__sq/scan-components returns.
// The regression: seeding THIS unresolved would make the browser parse
// `<slot />` and `<Footer />` as unclosed open tags → footer nested inside
// the slot, empty components, dead write-back selectors.
const RAW_BLOGPOST = '<Layout title={title}>\n  <slot />\n  <Footer />\n</Layout>';
const blogPost = mk('BlogPost', 'library/BlogPost.astro', RAW_BLOGPOST);
const footer = mk('Footer', 'library/Footer.astro', '<footer class="f">foot</footer>');

beforeEach(() => {
  vi.mocked(readLocalFile).mockReset();
});

describe('resolveComponentEditorOpen', () => {
  it('instance read fails (boot race): scanned source still runs the full pipeline', async () => {
    vi.mocked(readLocalFile).mockRejectedValue(new Error('Could not read src/components/library/BlogPost.astro (503)'));

    const { html, placements } = await resolveComponentEditorOpen(blogPost, [blogPost, footer]);

    // Layout inlined to a real element, never the raw component tag.
    expect(html).toMatch(/^<layout\b/);
    expect(html).not.toContain('<Layout');
    // Slot normalized to an open+close pair — self-closing is browser-invalid.
    expect(html).toMatch(/<slot[^>]*><\/slot>/);
    expect(html).not.toMatch(/<slot[^>]*\/>/);
    // Footer extracted as a placement, not left as a raw unknown tag.
    expect(html).not.toContain('<Footer');
    expect(placements.map((p) => p.path)).toContain('library/Footer.astro');
  });

  it('instance file content (/__sq/local/file) wins over the scanned html', async () => {
    vi.mocked(readLocalFile).mockResolvedValue(
      '---\nconst x = 1;\n---\n<div class="from-file"><slot /></div>',
    );

    const { html } = await resolveComponentEditorOpen(blogPost, [blogPost, footer]);

    expect(html).toContain('from-file');
    expect(html).toMatch(/<slot[^>]*><\/slot>/);
    expect(html).not.toMatch(/<slot[^>]*\/>/);
    expect(html).not.toContain('<Layout'); // scanned html was not used
  });
});

describe('resolveComponentEditorOpen — read target', () => {
  it('reads the component through the instance at its src/components path', async () => {
    vi.mocked(readLocalFile).mockResolvedValue('<div/>');
    await resolveComponentEditorOpen(footer, [footer]);
    expect(readLocalFile).toHaveBeenCalledWith('src/components/library/Footer.astro');
  });
});
