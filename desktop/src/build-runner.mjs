// The publish build child (site-build.mjs), forked with Electron's Node: Astro's own build() of the project copy in cwd
// with ITS astro.config (never .sq/desktop.config.mjs) into cwd/dist, caches in SQ_BUILD_OUT. One message back, then exit.
import { createRequire, enableCompileCache } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sqAstroCompat, SQ_ASTRO_LEGACY } from '../../preview-template/src/plugins/sq-astro-compat.js';
if (process.env.SQ_COMPILE_CACHE) enableCompileCache?.(process.env.SQ_COMPILE_CACHE);
process.on('disconnect', () => process.exit(1)); // main went away (app quit): never build on for nobody
const root = process.cwd(); const out = process.env.SQ_BUILD_OUT;
const NOT_STATIC = 'SQ_NOT_STATIC';
// Exit only once the message is on the wire (Astro/esbuild may leave handles open).
const reply = message => process.send(message, () => process.exit(0));
try {
  const astro = await import(pathToFileURL(createRequire(path.join(root, 'package.json')).resolve('astro')).href);
  // Caches stay out of node_modules: it links to the SHARED runtime (its default .astro/.vite caches would land there).
  await astro.build({ root, outDir: path.join(root, 'dist'), cacheDir: path.join(out, '.cache-astro'), logLevel: 'warn',
    // node_modules links to the shared runtime outside the project: keep in-project package paths (wrapper.mjs, dev).
    // Dev's wrapper config never runs here: the same Astro 4 site compat, or the publish build breaks what the canvas shows.
    ...(process.env.SQ_NO_COMPAT ? {} : { legacy: SQ_ASTRO_LEGACY }),
    vite: { cacheDir: path.join(out, '.cache-vite'), resolve: { preserveSymlinks: true }, plugins: process.env.SQ_NO_COMPAT ? [] : sqAstroCompat() },
    // Ledger 23: a server bundle must never reach a public asset bucket — refuse before anything builds.
    integrations: [{ name: 'sq-publish', hooks: { 'astro:config:done': ({ config }) => {
      if (config.output !== 'static' || config.adapter) throw new Error(NOT_STATIC);
    } } }] });
  reply({ type: 'built' });
} catch (error) {
  const text = String(error?.message ?? error);
  reply({ type: 'failed', code: text.includes(NOT_STATIC) ? 'not-static' : 'build-failed', error: text });
}
