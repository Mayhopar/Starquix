/**
 * task-206 regression: `data-sq-body-line` must be BODY-relative in BOTH
 * coordinate spaces the compiler hands us. Measured live 2026-08-11: after an
 * HMR recompile mdast positions are body-relative (frontmatter stripped before
 * parse), but a COLD compile delivers FILE-absolute positions — the stamps
 * came out 9/11 instead of 4/6 and saveMediaEdit found no component block.
 *
 * Detection is exact, not heuristic: relative positions are bounded by the
 * body's line count, so a tree whose max end line exceeds it is absolute.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error plain JS plugin, single source
import { sqRehypeSource } from '../../../../preview-template/src/plugins/sq-source-plugin.js';

const RAW = [
  '---',        // 1
  'title: T',   // 2
  'date: 2026-01-01', // 3
  '---',        // 4
  'import Media from "../../components/sq/Media.astro";', // file 5 / body 1
  '',           // file 6 / body 2
  'Hello.',     // file 7 / body 3
  '',           // file 8 / body 4
  '<Media items={["a.png"]} class="col-span-8" />', // file 9 / body 5
  '',
].join('\n');

let dir: string;
let filePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sq-rehype-'));
  filePath = join(dir, 'post.mdx');
  writeFileSync(filePath, RAW);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

interface JsxNode {
  type: string;
  name?: string;
  position: { start: { line: number; column: number }; end: { line: number } };
  attributes?: Array<{ name: string; value: string }>;
  children: unknown[];
}

function mediaNode(startLine: number, endLine: number): JsxNode {
  return {
    type: 'mdxJsxFlowElement',
    name: 'Media',
    position: { start: { line: startLine, column: 1 }, end: { line: endLine } },
    attributes: [],
    children: [],
  };
}

interface WrapperNode {
  type: string;
  tagName?: string;
  properties?: { dataSqBodyLine?: string; dataSqBodyEnd?: string };
}

/** The plugin REPLACES each top-level invocation with a stamped wrapper div —
 *  the wrapper's properties are what reaches the DOM (and the scan). */
function run(nodes: JsxNode[]): WrapperNode[] {
  const tree = { type: 'root', children: nodes as unknown[] };
  sqRehypeSource()(tree, { path: filePath, cwd: dir, value: '' });
  return tree.children as WrapperNode[];
}

const bodyLine = (n: WrapperNode) => n.properties?.dataSqBodyLine;
const bodyEnd = (n: WrapperNode) => n.properties?.dataSqBodyEnd;

describe('sqRehypeSource body-line normalization', () => {
  it('body-relative positions (HMR path) stamp as-is', () => {
    const [media] = run([mediaNode(5, 5)]); // Media at body line 5; max end 5 ≤ body lines
    expect(bodyLine(media)).toBe('5');
    expect(bodyEnd(media)).toBe('5');
  });

  it('file-absolute positions (cold-compile path) are shifted back to body-relative', () => {
    // Media at FILE line 9 — impossible in body coordinates? No: the body has
    // 6 lines, so a max end of 9 proves the tree is absolute (fence = 4 lines).
    const [media] = run([mediaNode(9, 9)]);
    expect(bodyLine(media)).toBe('5');
    expect(bodyEnd(media)).toBe('5');
  });

  it('no frontmatter → no shift', () => {
    writeFileSync(filePath, 'Hello.\n\n<Media />\n');
    const [media] = run([mediaNode(3, 3)]);
    expect(bodyLine(media)).toBe('3');
  });
});
