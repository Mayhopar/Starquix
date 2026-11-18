// Per-project runtime inputs: the shared node_modules link and OUR .sq/ files.
import fs from 'node:fs/promises';
import path from 'node:path';

// OUR files copied into every project's .sq/.
const SQ_FILES = /^(src\/plugins\/.*\.js|public\/scripts\/(bridge|tailwind)\.js|public\/sq-placeholder\.mp4|src\/components\/(SqComponentView|SqStubContent|SqPostView|SqHmrWriteBridge|Media|Stack)\.astro)$/;
const USER_CONFIG_FILES = ['astro.config.mjs', 'astro.config.js', 'astro.config.ts', 'astro.config.mts'];
const MINIMAL_CONFIG = "import { defineConfig } from 'astro/config';\nexport default defineConfig({});\n";

async function listFiles(root, dir) {
  const out = [];
  for (const e of await fs.readdir(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...await listFiles(root, rel));
    else out.push(rel);
  }
  return out;
}

/** OUR files under <project>/.sq/ (the astro wrapper config is written by
 *  wrapper.mjs). Rewritten on every open = self-healing. */
export async function installSqFiles(templateDir, projectDir) {
  const files = [...await listFiles(templateDir, 'src'), ...await listFiles(templateDir, 'public')].filter((f) => SQ_FILES.test(f));
  for (const rel of files) {
    const to = path.join(projectDir, '.sq', rel);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(path.join(templateDir, rel), to);
  }
  const names = await fs.readdir(projectDir);
  if (!USER_CONFIG_FILES.some((f) => names.includes(f))) await fs.writeFile(path.join(projectDir, 'astro.config.mjs'), MINIMAL_CONFIG);
  // Astro 6 auto-generates collections from src/content/<dir> only once a content config exists (Astro 4 needed none).
  const content = await fs.readdir(path.join(projectDir, 'src/content'), { withFileTypes: true }).catch(() => []);
  const configs = await fs.readdir(path.join(projectDir, 'src')).catch(() => []);
  if (content.some((e) => e.isDirectory()) && !content.some((e) => /^config\.[mc]?[jt]s$/.test(e.name)) && !configs.some((n) => /^content\.config\.[mc]?[jt]s$/.test(n))) {
    await fs.writeFile(path.join(projectDir, 'src/content/config.ts'), 'export const collections = {};\n');
  }
}
