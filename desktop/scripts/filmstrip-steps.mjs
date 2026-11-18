// Visual steps per journey from a filmstrip.mjs recording: how many separate
// times the window visibly changed after the gesture, and when. "One action = one
// visual step" (owner 2026-11-08, "the speed of Figma"): a delete that deselects,
// then moves content, then updates Layers is 3 steps.
//   node scripts/filmstrip-steps.mjs <outDir> [--max-steps=N]   (exit 1 when a journey exceeds N)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';

/** Minimal PNG decoder: 8-bit RGB/RGBA, non-interlaced (what CDP screencasts emit). */
export function decodePng(buf) {
  let pos = 8, width = 0, height = 0, bpp = 0; const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8);
    if (type === 'IHDR') {
      width = buf.readUInt32BE(pos + 8); height = buf.readUInt32BE(pos + 12);
      bpp = { 6: 4, 2: 3 }[buf[pos + 17]];
      if (!bpp || buf[pos + 16] !== 8 || buf[pos + 20] !== 0) throw new Error('unsupported PNG');
    } else if (type === 'IDAT') idat.push(buf.subarray(pos + 8, pos + 8 + len));
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = width * bpp, px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[dst + x - bpp] : 0, b = y ? px[dst - stride + x] : 0, c = x >= bpp && y ? px[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[dst + x] = v & 255;
    }
  }
  return { width, height, bpp, px };
}

/** Pixels whose brightest channel moved by more than 28 (JPEG/AA noise stays under it). */
export function changedPixels(a, b) {
  if (a.width !== b.width || a.height !== b.height) return a.width * a.height;
  let n = 0;
  for (let i = 0; i < a.px.length; i += a.bpp) {
    if (Math.abs(a.px[i] - b.px[i]) > 28 || Math.abs(a.px[i + 1] - b.px[i + 1]) > 28 || Math.abs(a.px[i + 2] - b.px[i + 2]) > 28) n++;
  }
  return n;
}

/** Changes at least `gapMs` apart are separate steps (two frames = a visible in-between state). */
export function visualSteps(changes, gapMs = 34) {
  const steps = [];
  for (const t of changes) { const last = steps.at(-1); if (last && t - last.end <= gapMs) last.end = t; else steps.push({ start: t, end: t }); }
  return steps;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dir, ...flags] = process.argv.slice(2);
  const max = Number((flags.find(f => f.startsWith('--max-steps=')) ?? '').split('=')[1]) || Infinity;
  let over = 0;
  console.log('| journey | first change ms | settled ms | visual steps (ms) |\n|---|---|---|---|');
  for (const j of fs.readdirSync(dir).sort()) {
    const d = path.join(dir, j); if (!fs.existsSync(path.join(d, 'meta.json'))) continue;
    const meta = JSON.parse(fs.readFileSync(path.join(d, 'meta.json'), 'utf8'));
    const files = fs.readdirSync(d).filter(f => f.endsWith('.png')).sort();
    const changes = []; let prev = null;
    for (const f of files) {
      const img = decodePng(fs.readFileSync(path.join(d, f))), t = Number(f.slice(0, -4)) - meta.offset;
      if (prev && t >= 0 && changedPixels(prev, img) > 0) changes.push(t);
      prev = img;
    }
    const steps = visualSteps(changes);
    if (steps.length > max) over++;
    console.log(`| ${j} | ${changes[0] ?? '-'} | ${changes.at(-1) ?? '-'} | ${steps.length} (${steps.map(s => s.start === s.end ? s.start : `${s.start}–${s.end}`).join(', ')})${meta.error ? ' ERROR' : ''} |`);
  }
  if (over) { console.error(`${over} journey(s) over ${max} visual steps`); process.exit(1); }
}
