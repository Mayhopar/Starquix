// Round-2 fixture: `compbig` = `bigpage` (688-line single page) whose probe images 1 and 2 are <Photo> usages (component ROOT = <img>).
//   node probe/make-compbig-fixture.mjs <fixturesDir>   (needs <fixturesDir>/bigpage and <fixturesDir>/comp2)
import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(process.argv[2] ?? 'fixtures');
const out = path.join(root, 'compbig');
await fs.rm(out, { recursive: true, force: true });
await fs.cp(path.join(root, 'bigpage'), out, { recursive: true });
await fs.mkdir(path.join(out, 'src/components'), { recursive: true });
await fs.copyFile(path.join(root, 'comp2/src/components/Photo.astro'), path.join(out, 'src/components/Photo.astro'));
let txt = await fs.readFile(path.join(out, 'src/pages/index.astro'), 'utf8');
for (const n of [1, 2]) {
  const tag = new RegExp(`<img src="/img-0${n}\\.png" alt="Probe image ${n}" class="[^"]*" />`);
  if (!tag.test(txt)) throw new Error(`image ${n} tag not found`);
  txt = txt.replace(tag, `<Photo alt="Probe image ${n}" src="/img-0${n}.png" />`);
}
txt = txt.replace("import Layout from '../layouts/Layout.astro';", "import Layout from '../layouts/Layout.astro';\nimport Photo from '../components/Photo.astro';");
await fs.writeFile(path.join(out, 'src/pages/index.astro'), txt);
console.log('compbig →', out, txt.split('\n').length, 'lines', txt.length, 'bytes');
