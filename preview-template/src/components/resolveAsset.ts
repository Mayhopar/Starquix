// Turn whatever a post passed as `src` into a URL the browser can fetch.
//
// Posts colocate images next to the .mdx (`./images/timepad/hero.png`). A bare
// relative string handed to <img src> resolves against the PAGE url, not the
// post file, so it 404s. Glob the content tree once and match by suffix.
//
// Also accepts an imported ImageMetadata ({src, width, height}), which is what
// `import Hero from './images/hero.png'` + `src={Hero}` produces.
// ponytail: suffix match, not a real path resolve. If two posts ever colocate
// the same filename, disambiguate by collection folder.
const assets = import.meta.glob<{ src: string }>(
  '/src/content/**/*.{png,jpg,jpeg,gif,webp,avif,svg}',
  { eager: true, import: 'default' },
);

export function resolveAsset(src: unknown): string {
  if (!src) return '';
  if (typeof src === 'object' && 'src' in (src as object)) return (src as { src: string }).src;
  if (typeof src !== 'string') return '';
  if (/^(https?:|data:|\/)/.test(src)) return src;

  const tail = src.replace(/^\.\//, '');
  for (const [path, mod] of Object.entries(assets)) {
    if (path.endsWith('/' + tail)) return mod.src;
  }
  return src;
}
