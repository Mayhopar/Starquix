// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import JSZip from 'jszip';
import * as Y from 'yjs';
import { db } from '@/db';
import { unmarkFilesTruth } from '@/utils/localMode';
import { importFilesTruthProject } from '@/services/projectImport/createFilesTruthProject';
import { buildFilesTruthZip } from '../filesTruthZip';

const enc = (value: string) => new TextEncoder().encode(value);
const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    clear: () => storage.clear(),
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    key: (index: number) => [...storage.keys()][index] ?? null,
    get length() { return storage.size; },
  },
});

describe('files-truth import to Dexie to ZIP', () => {
  let projectId: string | null = null;

  beforeEach(async () => {
    await db.delete();
    await db.open();
    localStorage.clear();
  });

  afterEach(() => {
    if (projectId) unmarkFilesTruth(projectId);
  });

  it('preserves public, colocated and font bytes plus nested source references', async () => {
    const publicImage = new Uint8Array([0, 255, 17, 91, 4]);
    const colocatedImage = new Uint8Array([137, 80, 78, 71, 0, 1]);
    const font = new Uint8Array([119, 79, 70, 50, 9, 8, 7]);
    const nestedPage = "---\nimport card from '../../assets/card.png';\n---\n<img src={card.src} />\n";
    const imported = await importFilesTruthProject([
      { path: 'site/package.json', content: enc('{"dependencies":{"astro":"^5"}}') },
      { path: 'site/src/pages/products/detail.astro', content: enc(nestedPage) },
      { path: 'site/public/media/hero.webp', content: publicImage },
      { path: 'site/src/assets/card.png', content: colocatedImage },
      { path: 'site/public/fonts/site.woff2', content: font },
    ], 'Binary site');
    projectId = imported.projectId;

    const doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
    const blob = await buildFilesTruthZip(projectId, doc);
    doc.destroy();
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(await zip.file('public/media/hero.webp')!.async('uint8array')).toEqual(publicImage);
    expect(await zip.file('src/assets/card.png')!.async('uint8array')).toEqual(colocatedImage);
    expect(await zip.file('public/fonts/site.woff2')!.async('uint8array')).toEqual(font);
    expect(await zip.file('src/pages/products/detail.astro')!.async('string')).toBe(nestedPage);
  });
});
