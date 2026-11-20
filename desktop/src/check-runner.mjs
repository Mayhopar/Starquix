// The pre-publish type check child (site-build.mjs checkSite), forked with Electron's Node in the project copy: what
// `astro check` runs — astro's sync, then @astrojs/check's AstroCheck — with the PROJECT's packages. Its own CLI can't
// here: it imports @astrojs/check from astro's location (the shared runtime), offers to install it and exits 0 having
// checked nothing (docs/plans/2026-10-20-prepublish-type-check-design.md). One message back, then exit.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { SQ_ASTRO_COMPAT_TYPE_ERROR, SQ_ASTRO_LEGACY } from '../../preview-template/src/plugins/sq-astro-compat.js';
process.on('disconnect', () => process.exit(1)); // main went away (app quit): never check on for nobody
// Node emits no 'disconnect' when main left before this process started (quit right after the fork): check once too.
if (process.send && !process.connected) process.exit(1);
const root = process.cwd(); const out = process.env.SQ_BUILD_OUT;
// Exit only once the message is on the wire (Astro/esbuild may leave handles open).
const reply = message => process.send(message, () => process.exit(0));
const load = (req, id) => import(pathToFileURL(req.resolve(id)).href);
try {
  const project = createRequire(path.join(root, 'package.json'));
  let check = null;
  try { check = createRequire(project.resolve('@astrojs/check')); } catch { /* not a dependency of this project */ }
  if (!check) reply({ type: 'unavailable' });
  else {
    const astro = await load(project, 'astro');
    // Types first, as `astro check` does; caches stay out of node_modules (it links to the SHARED runtime).
    await astro.sync({ root, logLevel: 'error', legacy: SQ_ASTRO_LEGACY, cacheDir: path.join(out, '.cache-astro'),
      vite: { cacheDir: path.join(out, '.cache-vite'), resolve: { preserveSymlinks: true } } });
    const { AstroCheck } = await load(check, '@astrojs/language-server');
    const result = await new AstroCheck(root, check.resolve('typescript'), undefined).lint({});
    const real = fs.realpathSync(root);
    // A legacy content config gets no generated entry types on Astro 7: every collection callback reads as implicit any.
    const legacy = ['ts', 'js', 'mjs', 'mts'].some(x => fs.existsSync(path.join(root, `src/content/config.${x}`)));
    const compatNoise = m => SQ_ASTRO_COMPAT_TYPE_ERROR.test(m) || (legacy && /implicitly has an 'any' type/.test(m));
    reply({ type: 'checked', errors: result.fileResult.flatMap(f => f.errors.filter(d => (d.severity ?? 1) === 1 && !compatNoise(String(d.message))).map(d => ({
      file: path.relative(real, fs.realpathSync(fileURLToPath(f.fileUrl))).split(path.sep).join('/'),
      line: d.range.start.line + 1, column: d.range.start.character + 1,
      code: `${d.source ?? 'ts'}(${d.code})`, message: String(d.message).split('\n')[0] }))) });
  }
} catch (error) {
  reply({ type: 'failed', error: String(error?.message ?? error) });
}
