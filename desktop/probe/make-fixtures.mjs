// Probe fixtures: `tiny` (1 page, 2 images) and `big` (6 pages, 10 images on home, 12 on gallery).
//   node probe/make-fixtures.mjs <outDir>
// Images are local gradient PNGs with a big number (python3 + PIL). Home images carry alt="Probe image N".
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const out = path.resolve(process.argv[2] ?? 'fixtures');
const base = path.resolve(import.meta.dirname, '../../app/e2e/fixtures/release-project');

const PY = `
import sys
from PIL import Image, ImageDraw, ImageFont
out, n = sys.argv[1], int(sys.argv[2])
palette = [(231,76,60),(52,152,219),(46,204,113),(241,196,15),(155,89,182),(26,188,156),(230,126,34),(52,73,94),(233,30,99),(0,150,136),(121,85,72),(63,81,181)]
for i in range(1, n + 1):
    c = palette[(i - 1) % len(palette)]
    im = Image.new('RGB', (800, 600), c)
    d = ImageDraw.Draw(im)
    for y in range(600):
        k = y / 600
        d.line([(0, y), (800, y)], fill=(int(c[0] * (1 - 0.45 * k)), int(c[1] * (1 - 0.45 * k)), int(c[2] * (1 - 0.45 * k))))
    try:
        f = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 320)
    except Exception:
        f = ImageFont.load_default()
    d.text((400, 300), '%02d' % i, fill=(255, 255, 255), font=f, anchor='mm')
    d.rectangle([0, 0, 799, 599], outline=(255, 255, 255), width=8)
    im.save('%s/img-%02d.png' % (out, i), optimize=True)
`;

async function copyConfig(dir) {
  await fs.mkdir(path.join(dir, 'src/pages'), { recursive: true });
  await fs.mkdir(path.join(dir, 'src/layouts'), { recursive: true });
  await fs.mkdir(path.join(dir, 'public'), { recursive: true });
  for (const f of ['package.json', 'astro.config.mjs', 'tailwind.config.mjs']) await fs.copyFile(path.join(base, f), path.join(dir, f));
  await fs.writeFile(path.join(dir, 'src/layouts/Layout.astro'), `---
const { title = 'Probe' } = Astro.props;
---
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
  </head>
  <body class="min-h-screen bg-white text-neutral-900">
    <slot />
  </body>
</html>
`);
}

const img = (n, cls, extra = '') => `<img src="/img-${String(n).padStart(2, '0')}.png" alt="Probe image ${n}" class="${cls}"${extra} />`;

// ---- tiny ------------------------------------------------------------------
const tiny = path.join(out, 'tiny');
await fs.rm(tiny, { recursive: true, force: true });
await copyConfig(tiny);
execFileSync('python3', ['-c', PY, path.join(tiny, 'public'), '2']);
await fs.writeFile(path.join(tiny, 'src/pages/index.astro'), `---
import Layout from '../layouts/Layout.astro';
---
<Layout title="Probe tiny">
  <main class="mx-auto max-w-5xl p-8">
    <h1 class="text-4xl font-semibold">Probe tiny</h1>
    <section class="mt-6 flex gap-4 items-start">
      ${img(1, 'w-full rounded')}
      ${img(2, 'w-48 rounded')}
    </section>
  </main>
</Layout>
`);

// ---- big -------------------------------------------------------------------
const big = path.join(out, 'big');
await fs.rm(big, { recursive: true, force: true });
await copyConfig(big);
execFileSync('python3', ['-c', PY, path.join(big, 'public'), '12']);
// Home: #1 Fill in a flex row (container 311 px at the 375 canvas), #2 Fill in a flex column; grid cells are narrow (img max-width:100%
// clamps a typed width to the cell), so the typed-on images live in flex containers. #11 = a frame with a background image (S5).
const home = (title) => `---
import Layout from '../layouts/Layout.astro';
---
<Layout title="${title}">
  <main class="mx-auto max-w-5xl p-8">
    <h1 class="text-4xl font-semibold">${title}</h1>
    <p class="mt-2 text-lg text-neutral-600">Ten images, fill and fixed widths, flex and grid containers.</p>
    <section class="mt-6 flex gap-4 items-start">
      ${img(1, 'w-full rounded')}
      ${img(3, 'w-48 rounded')}
      ${img(4, 'w-64 rounded')}
    </section>
    <section class="mt-6 flex flex-col gap-4 items-start">
      ${img(2, 'w-full rounded')}
      ${img(5, 'w-1/2 rounded')}
      ${img(6, 'w-72 rounded')}
    </section>
    <section class="mt-6 grid grid-cols-2 gap-4">
      ${img(7, 'w-full rounded')}
      ${img(8, 'w-full rounded')}
      ${img(9, 'w-32 rounded')}
      ${img(10, 'w-full rounded')}
    </section>
    <div id="fx" class="mt-6 h-40 w-full rounded bg-[url('/img-11.png')] bg-cover bg-center"></div>
    <p class="mt-6">Closing paragraph for the home page.</p>
  </main>
</Layout>
`;
await fs.writeFile(path.join(big, 'src/pages/index.astro'), home('Probe home'));
const extra = [
  ['about', 'About', 4], ['gallery', 'Gallery', 12], ['services', 'Services', 3], ['contact', 'Contact', 2], ['team', 'Team', 6],
];
for (const [slug, title, count] of extra) {
  const imgs = Array.from({ length: count }, (_, i) => `      ${img(i + 1, i % 3 === 0 ? 'w-full rounded' : i % 3 === 1 ? 'w-64 rounded' : 'w-1/2 rounded')}`).join('\n');
  const paras = Array.from({ length: 4 }, (_, i) => `    <p class="mt-4 text-lg">${title} paragraph ${i + 1}: lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>`).join('\n');
  await fs.writeFile(path.join(big, `src/pages/${slug}.astro`), `---
import Layout from '../layouts/Layout.astro';
---
<Layout title="${title}">
  <main class="mx-auto max-w-5xl p-8">
    <h1 class="text-4xl font-semibold">${title}</h1>
${paras}
    <section class="mt-6 grid grid-cols-3 gap-4 items-start">
${imgs}
    </section>
  </main>
</Layout>
`);
}

// ---- huge: the big project + 34 more pages (40 total), each with 12 images and 20 text blocks ------------------------------------
const huge = path.join(out, 'huge');
await fs.rm(huge, { recursive: true, force: true });
await fs.cp(big, huge, { recursive: true });
for (let i = 1; i <= 34; i++) {
  const slug = `page-${String(i).padStart(2, '0')}`;
  const imgs = Array.from({ length: 12 }, (_, k) => `      ${img((k % 12) + 1, k % 3 === 0 ? 'w-full rounded' : k % 3 === 1 ? 'w-64 rounded' : 'w-1/2 rounded')}`).join('\n');
  const paras = Array.from({ length: 20 }, (_, k) => `    <p class="mt-3 text-base">Page ${i} paragraph ${k + 1}: lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>`).join('\n');
  await fs.writeFile(path.join(huge, `src/pages/${slug}.astro`), `---
import Layout from '../layouts/Layout.astro';
---
<Layout title="Page ${i}">
  <main class="mx-auto max-w-5xl p-8">
    <h1 class="text-4xl font-semibold">Page ${i}</h1>
${paras}
    <section class="mt-6 flex flex-wrap gap-4 items-start">
${imgs}
    </section>
  </main>
</Layout>
`);
}

// ---- bigpage: ONE page with a ~540-line index.astro (like a hand-built landing page): the same ten probe images on top, then 60 card blocks ---------
const bigpage = path.join(out, 'bigpage');
await fs.rm(bigpage, { recursive: true, force: true });
await fs.cp(big, bigpage, { recursive: true });
for (const f of (await fs.readdir(path.join(bigpage, 'src/pages'))).filter(f => f !== 'index.astro')) await fs.rm(path.join(bigpage, 'src/pages', f));
let homeTxt = await fs.readFile(path.join(bigpage, 'src/pages/index.astro'), 'utf8');
const blocks = Array.from({ length: 60 }, (_, i) => `    <section class="mt-8 rounded-xl border border-neutral-200 p-6">
      <h2 class="text-2xl font-semibold">Feature ${i + 1}</h2>
      <p class="mt-2 text-neutral-600">Feature ${i + 1} body copy: lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>
      <div class="mt-4 flex items-center gap-4">
        <img src="/img-${String((i % 12) + 1).padStart(2, '0')}.png" alt="decor ${i + 1}" class="h-16 w-16 rounded" />
        <ul class="list-disc pl-5 text-sm">
          <li>Point one of feature ${i + 1}</li>
          <li>Point two of feature ${i + 1}</li>
        </ul>
      </div>
    </section>`).join('\n');
homeTxt = homeTxt.replace('    <p class="mt-6">Closing paragraph for the home page.</p>', `${blocks}\n    <p class="mt-6">Closing paragraph for the home page.</p>`);
await fs.writeFile(path.join(bigpage, 'src/pages/index.astro'), homeTxt);
console.log('bigpage index.astro lines:', homeTxt.split('\n').length);
console.log('fixtures →', out);
