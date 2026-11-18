// Fetches design themes from VoltAgent/awesome-design-md (MIT) and emits
// app/src/ai/styles/themes.json. Rerun to refresh; artifact is committed.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'app/src/ai/styles/themes.json');
const REPO = 'VoltAgent/awesome-design-md';

const tree = await (await fetch(`https://api.github.com/repos/${REPO}/git/trees/main?recursive=1`)).json();
const designFiles = tree.tree.filter(t => /^design-md\/[^/]+\/DESIGN\.md$/.test(t.path));
if (designFiles.length < 50) throw new Error(`only ${designFiles.length} themes found — repo layout changed?`);

const titleCase = slug => slug.split(/[-_]/).map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');

const themes = [];
for (const f of designFiles) {
  const slug = f.path.split('/')[1];
  const res = await fetch(`https://raw.githubusercontent.com/${REPO}/main/${f.path}`);
  if (!res.ok) throw new Error(`fetch failed for ${f.path}: ${res.status}`);
  const markdown = (await res.text()).trim();
  if (markdown.length < 50) throw new Error(`suspiciously short theme: ${f.path}`);
  themes.push({ id: slug, name: titleCase(slug), markdown });
}
themes.sort((a, b) => a.name.localeCompare(b.name));

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  source: `https://github.com/${REPO}`,
  license: 'MIT',
  themes,
}, null, 2) + '\n');
console.log(`wrote ${themes.length} themes to ${OUT}`);
