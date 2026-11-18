// task-075 guard: the Yjs meta selection layer is DELETED. Selection truth
// lives ONLY in SelectionContext — no production file may read or write
// selection through the meta map, or resurrect the deleted selection
// commands. Bans target the MECHANISM (meta map access to selected* keys),
// so legitimate uses of names like selectedElementId elsewhere stay free.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const FORBIDDEN = [
  "meta.set('selected", 'meta.set("selected',
  "meta.get('selected", 'meta.get("selected',
  'SELECT_SOURCE_ELEMENT',
  "'SELECT_ELEMENT'", '"SELECT_ELEMENT"',
  'clearSelectionMeta',
];

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      collectSourceFiles(full, out);
    } else if (
      /\.(ts|tsx)$/.test(entry) &&
      !/\.test\.(ts|tsx)$/.test(entry) &&
      !/\.spec\.(ts|tsx)$/.test(entry)
    ) {
      out.push(full);
    }
  }
  return out;
}

describe('no Yjs meta selection layer (task-075 guard)', () => {
  it('no production source file references the deleted meta keys or commands', () => {
    const srcRoot = join(__dirname, '..', '..');
    const files = collectSourceFiles(srcRoot);
    expect(files.length).toBeGreaterThan(100); // sanity: the walk actually ran

    const violations: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      for (const token of FORBIDDEN) {
        if (content.includes(token)) {
          violations.push(`${file.replace(srcRoot + '/', '')} contains ${token}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
