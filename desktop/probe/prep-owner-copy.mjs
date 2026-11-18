// Prepare a scratch COPY of an owner project for the probe: rsync (never touches the original), then tag the first 10 <img> of the page with
// alt="Probe image N" so the runner/recorder can find them.   node prep-owner-copy.mjs <srcProjectDir> <destDir> <page, e.g. src/pages/index.astro>
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
const [src, dest, page] = process.argv.slice(2);
await fs.rm(dest, { recursive: true, force: true });
await fs.mkdir(dest, { recursive: true });
execFileSync('rsync', ['-a', '--exclude', 'node_modules', '--exclude', '.git', '--exclude', '.sq', '--exclude', '.astro', `${src.replace(/\/?$/, '/')}`, `${dest.replace(/\/?$/, '/')}`]);
const file = path.join(dest, page);
let txt = await fs.readFile(file, 'utf8'); let n = 0;
txt = txt.replace(/<img\b[^>]*>/gs, tag => { if (++n > 10) return tag; const clean = tag.replace(/\salt=(["'])[\s\S]*?\1/, ''); return clean.replace(/^<img\b/, `<img alt="Probe image ${n}"`); });
await fs.writeFile(file, txt);
console.log(`tagged ${Math.min(n, 10)} of ${n} <img> in ${page}; copy at ${dest}`);
