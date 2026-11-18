// Round-2 fixture: `comp` = `big`'s config/layout/images + ONE page whose images live inside LOCAL COMPONENTS:
//   V2: <Photo alt="Probe image 1|2" src=...>   — the component ROOT is the <img> (edited from the page)
//   V3: <Card  alt="Probe image 3|4" src=...>   — the <img> is an INNER element of the component root <figure>
//   V1 control: plain <img> 5 and 6 on the page.
//   node probe/make-comp-fixture.mjs <fixturesDir> [comp|comp2]   (needs <fixturesDir>/big from make-fixtures.mjs)
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'fixtures');
const comp = path.join(root, process.argv[3] ?? 'comp'); // 'comp2' = stacked layout (a widened image cannot push its neighbour out of the canvas)
const stacked = (process.argv[3] ?? 'comp') !== 'comp';
await fs.rm(comp, { recursive: true, force: true });
await fs.cp(path.join(root, 'big'), comp, { recursive: true });
for (const f of await fs.readdir(path.join(comp, 'src/pages'))) await fs.rm(path.join(comp, 'src/pages', f));
await fs.mkdir(path.join(comp, 'src/components'), { recursive: true });
await fs.writeFile(path.join(comp, 'src/components/Photo.astro'), `---
const { alt = '', src = '/img-01.png' } = Astro.props;
---
<img src={src} alt={alt} class="w-full rounded" />
`);
await fs.writeFile(path.join(comp, 'src/components/Card.astro'), `---
const { alt = '', src = '/img-03.png', title = 'Card' } = Astro.props;
---
<figure class="${stacked ? 'w-full ' : ''}rounded border border-neutral-200 p-4">
  <img src={src} alt={alt} class="w-full rounded" />
  <figcaption class="mt-2 text-sm text-neutral-600">{title}</figcaption>
</figure>
`);
const img = (n, cls) => `<img src="/img-${String(n).padStart(2, '0')}.png" alt="Probe image ${n}" class="${cls}" />`;
await fs.writeFile(path.join(comp, 'src/pages/index.astro'), `---
import Layout from '../layouts/Layout.astro';
import Photo from '../components/Photo.astro';
import Card from '../components/Card.astro';
---
<Layout title="Probe comp">
  <main class="mx-auto max-w-5xl p-8">
    <h1 class="text-4xl font-semibold">Probe comp</h1>
    <p class="mt-2 text-lg text-neutral-600">Images inside local components (root and inner) plus plain controls.</p>
    <section class="mt-6 ${stacked ? 'flex flex-col' : 'flex'} gap-4 items-start">
      <Photo alt="Probe image 1" src="/img-01.png" />
      <Photo alt="Probe image 2" src="/img-02.png" />
    </section>
    <section class="mt-6 ${stacked ? 'flex flex-col' : 'flex'} gap-4 items-start">
      <Card alt="Probe image 3" src="/img-03.png" title="Card three" />
      <Card alt="Probe image 4" src="/img-04.png" title="Card four" />
    </section>
    <section class="mt-6 ${stacked ? 'flex flex-col' : 'flex'} gap-4 items-start">
      ${img(5, 'w-full rounded')}
      ${img(6, 'w-48 rounded')}
    </section>
    <p class="mt-6">Closing paragraph.</p>
  </main>
</Layout>
`);
console.log('comp fixture →', comp);
