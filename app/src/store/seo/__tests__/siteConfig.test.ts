// task-248 P2: site address, sitemap integration, package.json, robots.txt — surgical config edits.
import { describe, it, expect } from 'vitest';
import { readSiteConfig, setSiteAddress, setSitemap, setPackageDep, robotsTxt, sitemapUrlOf } from '../siteConfig';

const SCAFFOLD = `import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import mdx from '@astrojs/mdx';

export default defineConfig({
  integrations: [tailwind(), mdx()],
});
`;
const IMPORTED = `import { defineConfig } from 'astro/config';
import tailwind from "@astrojs/tailwind";

import mdx from "@astrojs/mdx";

// https://astro.build/config
export default defineConfig({
  integrations: [tailwind(), mdx()],
  prefetch: {
    defaultStrategy: 'viewport',
  }
});
`;

describe('site address', () => {
  it('adds, replaces and removes `site` without touching the rest', () => {
    const a = setSiteAddress(SCAFFOLD, 'acme.com/');
    expect(a).toContain("export default defineConfig({\n  site: 'https://acme.com',\n  integrations: [tailwind(), mdx()],");
    expect(readSiteConfig(a).site).toBe('https://acme.com');
    const b = setSiteAddress(a, 'https://www.acme.com');
    expect(readSiteConfig(b).site).toBe('https://www.acme.com');
    expect(setSiteAddress(b, '')).toBe(SCAFFOLD);
  });
  it('refuses something that is not an address', () => {
    expect(() => setSiteAddress(SCAFFOLD, 'not a url')).toThrow(/example\.com/);
  });
  it('an empty or missing config reads as nothing set', () => {
    expect(readSiteConfig(null)).toEqual({ site: '', sitemap: false });
  });
});

describe('sitemap integration', () => {
  it('adds the import + call and reads back on; off restores the bytes', () => {
    for (const cfg of [SCAFFOLD, IMPORTED]) {
      const on = setSitemap(cfg, true);
      expect(on).toContain("import sitemap from '@astrojs/sitemap';");
      expect(on).toContain('integrations: [tailwind(), mdx(), sitemap()]');
      expect(readSiteConfig(on).sitemap).toBe(true);
      expect(setSitemap(on, true)).toBe(on);
      expect(setSitemap(on, false)).toBe(cfg);
    }
  });
  it('a config with no integrations gets one', () => {
    const cfg = "import { defineConfig } from 'astro/config';\nexport default defineConfig({});\n";
    expect(setSitemap(cfg, true)).toContain('defineConfig({ integrations: [sitemap()],});');
  });
});

describe('package.json + robots.txt', () => {
  it('adds the dependency once, sorted, keeping indentation', () => {
    const pkg = JSON.stringify({ name: 's', dependencies: { astro: '^7.4.7', '@astrojs/mdx': '^8.1.3' } }, null, 2) + '\n';
    const out = setPackageDep(pkg, '@astrojs/sitemap', '^3.7.5');
    expect(Object.keys(JSON.parse(out).dependencies)).toEqual(['@astrojs/mdx', '@astrojs/sitemap', 'astro']);
    expect(setPackageDep(out, '@astrojs/sitemap', '^3.7.5')).toBe(out);
    expect(out.endsWith('}\n')).toBe(true);
  });
  it('robots.txt: created when absent; an existing one keeps its rules', () => {
    expect(robotsTxt(null, sitemapUrlOf('https://acme.com'))).toBe('User-agent: *\nAllow: /\n\nSitemap: https://acme.com/sitemap-index.xml\n');
    const own = 'User-agent: *\nDisallow: /admin\n';
    expect(robotsTxt(own, 'https://a.co/sitemap-index.xml')).toBe('User-agent: *\nDisallow: /admin\n\nSitemap: https://a.co/sitemap-index.xml\n');
    expect(robotsTxt(robotsTxt(own, 'https://a.co/s.xml'), null)).toBe(own);
  });
});
