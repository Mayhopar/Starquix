// Where a download lands (main.mjs will-download): beside a same-named file, never over it (finding #34).
import fs from 'node:fs';
import path from 'node:path';
/** `file`, or the first free "name (n).ext" beside it — Chrome's rule.
 *  shortcut: two same-named downloads in flight at once can pick the same name; track pending paths if that ever shows. */
export function freePath(file) {
  const { dir, name, ext } = path.parse(file);
  let free = file;
  for (let n = 1; fs.existsSync(free); n++) free = path.join(dir, `${name} (${n})${ext}`);
  return free;
}
