/**
 * The open site's Astro major, from its package.json pin — set by the desktop driver on every mirror. Astro ≥5 sites
 * use the content layer (`post.id`, `render(post)`, glob loaders in src/content.config.ts): hosts build them with no
 * compat shim, so what we generate there must be content-layer code. Older pins (sites the on-open upgrade kept, see
 * desktop/src/astro-upgrade.mjs) keep the legacy shapes the canvas renders through sq-astro-compat. Unknown = legacy.
 */
let major: number | null = null;

export function setSiteAstro(pkg: string | Uint8Array | null | undefined): void {
  try {
    const text = typeof pkg === 'string' ? pkg : pkg ? new TextDecoder().decode(pkg) : '';
    const json = JSON.parse(text) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const m = /(\d+)/.exec(json.dependencies?.astro ?? json.devDependencies?.astro ?? '');
    major = m ? Number(m[1]) : null;
  } catch { major = null; }
}

export const siteUsesContentLayer = (): boolean => major !== null && major >= 5;

/** A content-layer collection over src/content/<name> (Astro 4 auto-generated these from the folder alone). */
export const contentLayerLoader = (name: string): string => `loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: './src/content/${name}' })`;
