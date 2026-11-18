// gap-61: local font picks are FILES-truth — bytes and css go to the
// /__sq/local/font-* endpoints, never Dexie, and the baked css carries real
// /fonts/ urls (no sq-asset: refs the user's own astro build can't resolve).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { dbAdd } = vi.hoisted(() => ({ dbAdd: vi.fn() }));
vi.mock('@/db', () => ({
  db: { assets: { add: dbAdd, get: vi.fn() } },
  getAssetBlob: vi.fn(),
}));
vi.mock('@/store/persistence/SyncClient', () => ({ getSyncConfig: () => null }));
vi.mock('@/store/persistence/assetSync', () => ({ pushAsset: vi.fn() }));

import {
  pickLocalGoogleFont, uploadLocalFont, updateLocalCustomFont,
  fontClassRuleCss, LOCAL_FONT_NO_HEAD_WARNING,
} from '../localFonts';
import { markFilesTruth, filesTruthPath } from '../localMode';
import { setLocalTransport, resetLocalTransportForTests } from '../sqLocalBase';

const PROJECT_ID = 'browser_site';
const DIR = filesTruthPath(PROJECT_ID);

const CSS2 =
  `/* latin */\n@font-face{font-family:'Open Sans';font-style:normal;font-weight:400;` +
  `src:url(https://fonts.gstatic.com/s/os-latin.woff2) format('woff2');unicode-range:U+0000-00FF;}\n` +
  `/* cyrillic */\n@font-face{font-family:'Open Sans';font-style:normal;font-weight:400;` +
  `src:url(https://fonts.gstatic.com/s/os-cyr.woff2) format('woff2');}\n`;

interface Call { url: string; init?: RequestInit }
let calls: Call[];
let linkedResponse: boolean;

beforeEach(() => {
  calls = [];
  linkedResponse = true;
  dbAdd.mockClear();
  markFilesTruth(PROJECT_ID);
  resetLocalTransportForTests();
  // /__sq/local/* rides the proxy transport; Google Fonts is a plain fetch.
  setLocalTransport({ projectPath: DIR, fetch: (p, init) => (globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>)(p, init) });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const u = String(url);
    if (u.includes('fonts.googleapis.com')) return { ok: true, status: 200, text: async () => CSS2 };
    if (u.includes('fonts.gstatic.com')) return { ok: true, status: 200, blob: async () => new Blob(['BYTES']) };
    if (u.includes('/__sq/local/font-file')) {
      const name = new URL(u, 'http://x').searchParams.get('name') ?? '';
      return { ok: true, status: 200, json: async () => ({ src: `/fonts/${name}` }) };
    }
    if (u.includes('/__sq/local/font-css')) {
      return { ok: true, status: 200, json: async () => ({ linked: linkedResponse }) };
    }
    throw new Error(`unexpected fetch ${u}`);
  }));
});

describe('pickLocalGoogleFont', () => {
  it('posts bytes + css to the local endpoints; css uses /fonts/ urls, never sq-asset or Dexie', async () => {
    const { css, warning } = await pickLocalGoogleFont(PROJECT_ID, 'Open Sans', [400]);
    expect(warning).toBeNull();
    expect(css).toContain("src:url('/fonts/Open-Sans-400-latin.woff2') format('woff2')");
    expect(css).toContain(fontClassRuleCss('Open Sans'));
    expect(css).not.toContain('sq-asset:');
    expect(dbAdd).not.toHaveBeenCalled();

    const cssCall = calls.find(c => c.url.includes('/__sq/local/font-css'))!;
    expect(JSON.parse(String(cssCall.init?.body))).toMatchObject({ path: DIR, family: 'Open Sans', css });
    // latin kept, cyrillic filtered by the shared KEEP_SUBSETS parse
    expect(calls.filter(c => c.url.includes('/__sq/local/font-file'))).toHaveLength(1);
  });

  it('surfaces the honest warning when no <head> could be linked', async () => {
    linkedResponse = false;
    const { warning } = await pickLocalGoogleFont(PROJECT_ID, 'Open Sans', [400]);
    expect(warning).toBe(LOCAL_FONT_NO_HEAD_WARNING);
  });

  it('refuses a project whose files-truth mirror has not resolved (no writes fired)', async () => {
    await expect(pickLocalGoogleFont('browser_unresolved', 'Open Sans', [400])).rejects.toThrow(/not ready/);
    expect(calls).toHaveLength(0);
  });
});

describe('uploadLocalFont', () => {
  it('writes the file into public/fonts and bakes a real-url @font-face', async () => {
    const file = new File(['F'], 'My-Brand.woff2');
    const up = await uploadLocalFont(PROJECT_ID, file);
    expect(up).toMatchObject({ family: 'My Brand', format: 'woff2', srcUrl: '/fonts/My-Brand.woff2', warning: null });
    expect(up.css).toContain("src:url('/fonts/My-Brand.woff2') format('woff2')");
    expect(up.css).toContain('font-weight:400');
    expect(up.css).not.toContain('sq-asset:');
    expect(dbAdd).not.toHaveBeenCalled();
  });
});

describe('updateLocalCustomFont', () => {
  it('re-merges the family block with the new weight axis, same url', async () => {
    const { css } = await updateLocalCustomFont(
      PROJECT_ID, { family: 'My Brand', format: 'woff2', srcUrl: '/fonts/My-Brand.woff2' }, 700, true,
    );
    expect(css).toContain('font-weight:100 900');
    expect(css).toContain("src:url('/fonts/My-Brand.woff2')");
    expect(calls.filter(c => c.url.includes('/__sq/local/font-css'))).toHaveLength(1);
  });
});

describe('fontClassRuleCss', () => {
  it('escapes the persisted class token into a valid selector', () => {
    expect(fontClassRuleCss('Open Sans')).toBe('.font-\\[\\"Open_Sans\\"\\]{font-family:\'Open Sans\';}');
  });
});
