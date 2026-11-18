// Desktop astro configs: the WC wrapper + per-project caches, loopback strict
// port and the private-route guard; plus a fallback that never imports the
// user's config (booted by a fresh child after a failed config boot).
import fs from 'node:fs/promises';
import path from 'node:path';
import { renderWrapperConfig, SQ_BRIDGE_JS_PATH_SRC, SQ_PRELUDE } from '../../preview-template/src/plugins/sq-wrapper-config.js';
const CONFIGS = ['astro.config.mjs', 'astro.config.js', 'astro.config.ts', 'astro.config.mts'];
export async function installDesktopConfig(projectDir) {
  const sq = path.join(projectDir, '.sq'); await fs.mkdir(sq, { recursive: true });
  await fs.copyFile(new URL('./http-guard.mjs', import.meta.url), path.join(sq, 'desktop-guard.mjs'));
  const files = await fs.readdir(projectDir);
  const user = CONFIGS.find(name => files.includes(name)) ?? 'astro.config.mjs';
  await fs.writeFile(path.join(sq, 'fallback.config.mjs'), `import mdx from '@astrojs/mdx';
import tailwind from '@astrojs/tailwind';
export default { integrations: [mdx(), tailwind({ applyBaseStyles: false })] };
`);
  // Appended after \`export default cfg\`: mutates the exported object during
  // module evaluation. Astro's cacheDir schema is z.string() — a path, not a URL.
  const extra = `
import { desktopGuard } from './desktop-guard.mjs';
cfg.cacheDir = fileURLToPath(new URL('./cache/astro/', import.meta.url));
cfg.vite.cacheDir = fileURLToPath(new URL('./cache/vite/', import.meta.url));
cfg.server = { ...cfg.server, host: '127.0.0.1' };
// node_modules is a symlink to the shared runtime OUTSIDE the project: resolved to its real
// path, astro:transitions' ViewTransitions.astro styles got a root-glued module id and every
// page 500'd ("No cached compile metadata"). Keep packages on their in-project path.
cfg.vite.resolve = { ...(cfg.vite.resolve || {}), preserveSymlinks: true };
// Only the editor reads the instance cross-origin (loadPostViewHtml's direct fetch). An open
// CORS policy let any website the user visited read the project. Unset = no origin at all.
cfg.vite.server = { ...cfg.vite.server, host: '127.0.0.1', strictPort: true,
  cors: { origin: [process.env.SQ_EDITOR_ORIGIN].filter(Boolean) } };
// Seamless canvas drafts (/__sq/local/draft) are written while the user types: never watched.
// Case 24 / D11: a template error keeps the last good canvas + one inline status, never Vite's overlay.
cfg.vite.server.hmr = { ...(cfg.vite.server.hmr || {}), overlay: false };
cfg.vite.server.watch = { ...(cfg.vite.server.watch || {}), ignored: [...[].concat(cfg.vite.server.watch?.ignored ?? []), '**/.sq/drafts/**'] };
cfg.vite.plugins = [desktopGuard({ token: process.env.SQ_DESKTOP_TOKEN,
  identity: JSON.parse(process.env.SQ_DESKTOP_IDENTITY) }), ...cfg.vite.plugins];
`;
  const render = userPath => renderWrapperConfig(userPath, './src/plugins/sq-source-plugin.js',
    './.sq/src/components/SqComponentView.astro', './.sq/src/components/SqPostView.astro',
    { bridgeJsPathSrc: SQ_BRIDGE_JS_PATH_SRC, prelude: SQ_PRELUDE }) + extra;
  const normal = path.join(sq, 'desktop.config.mjs');
  const fallback = path.join(sq, 'desktop-fallback.config.mjs');
  await fs.writeFile(normal, render(`../${user}`));
  await fs.writeFile(fallback, render('./fallback.config.mjs'));
  return { normal, fallback };
}
