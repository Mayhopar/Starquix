import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '@/db';
import { putProjectFiles, readProjectFiles } from '@/db/projectFiles';
import { healLegacyEditorAttrs, stripLegacyEditorAttrs } from '../legacyEditorAttrs';

const enc = (s: string) => new TextEncoder().encode(s);

// Verbatim shape of a page the doc→files conversion wrote (owner's page-7, 2026-09-24).
const CONVERTED = `---
import Layout from '../layouts/Layout.astro';
---
<Layout title="Page 7">
  <section data-sq-source="element-1785012361095-qdzr1:1:1" data-key="element-1785012361095-qdzr1:section-0" data-with-props='true' class='bg-[#090909] py-24'>
    <p data-key="element-1785012361095-qdzr1:p-0" contenteditable='false' class='text-sm'>Showcase</p>
  </section>
</Layout>
`;

beforeEach(async () => { await db.delete(); await db.open(); });

describe('legacy editor attributes (doc-era data-key baked into files)', () => {
  it('strips every editor-only attribute and keeps user attributes', () => {
    const out = stripLegacyEditorAttrs(CONVERTED);
    expect(out).not.toMatch(/data-key|data-sq-source|data-with-props|contenteditable/);
    expect(out).toContain(`<section class='bg-[#090909] py-24'>`);
    expect(out).toContain(`<p class='text-sm'>Showcase</p>`);
  });

  it('heals converted pages before boot, leaves hand-authored files alone', async () => {
    const own = `<div data-key="mine" contenteditable='false'>x</div>`;
    await putProjectFiles('p', [
      { path: 'src/pages/page-7.astro', content: enc(CONVERTED) },
      { path: 'src/pages/own.astro', content: enc(own) },
    ]);
    expect(await healLegacyEditorAttrs('p')).toBe(1);
    const files = await readProjectFiles('p');
    expect(files['src/pages/page-7.astro']).not.toMatch(/data-key/);
    expect(files['src/pages/own.astro']).toBe(own);
    expect(await healLegacyEditorAttrs('p')).toBe(0);
  });

  it('waits while journal rows are unmaterialized (their before-bytes must match disk)', async () => {
    await putProjectFiles('p', [{ path: 'src/pages/page-7.astro', content: enc(CONVERTED) }]);
    await db.durableEdits.put({ id: 'r1', projectId: 'p', revision: 1, operationId: 'o', commands: [], acceptedAt: 1, materializedAt: null } as never);
    expect(await healLegacyEditorAttrs('p')).toBe(0);
    expect((await readProjectFiles('p'))['src/pages/page-7.astro']).toBe(CONVERTED);
  });
});
