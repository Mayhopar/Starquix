import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { ImportEntry } from '../../projectImport/processFolder';

/** Walk a fixture dir into ImportEntry[] with a root-folder prefix, exactly
 *  like a webkitdirectory pick (paths start with the picked folder's name). */
export function loadFixtureFolder(dir: string, rootName = 'import-basic'): ImportEntry[] {
  const out: ImportEntry[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push({ path: `${rootName}/${relative(dir, full).split('\\').join('/')}`, content: new Uint8Array(readFileSync(full)) });
    }
  };
  walk(dir);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export const IMPORT_BASIC_DIR = join(__dirname, 'import-basic');
