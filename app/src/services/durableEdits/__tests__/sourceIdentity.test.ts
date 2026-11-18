import { expect, it } from 'vitest';
import { applyStructuralTransform } from '../structuralTransform';
import { structuralIdentityMap, projectCoordinate, invertIdentityMaps } from '../sourceIdentity';
import type { StructuralOp } from '@/store/structuralUndo';
const file = 'src/pages/index.astro';
const loc = (line: number, column = 3) => ({ file, line, column });
function step(source: string, op: StructuralOp) {
  const result = applyStructuralTransform(source, op);
  return { source: result.content, map: structuralIdentityMap(source, result.content, op, result) };
}

it('preserves identical sibling identities even when the reorder leaves identical bytes', () => {
  const source = '<main>\n  <p>Same</p>\n  <p>Same</p>\n</main>\n';
  const moved = step(source, { kind: 'move', from: loc(2), to: loc(3), position: 'after' });
  expect(moved.source).toBe(source);
  expect(projectCoordinate(loc(2), [moved.map])).toMatchObject(loc(3));
  expect(projectCoordinate(loc(3), [moved.map])).toMatchObject(loc(2));
});

it('preserves nested descendants when a subtree is reindented', () => {
  const source = '<main>\n  <section>\n    <p>Same</p>\n  </section>\n  <aside></aside>\n</main>\n';
  const moved = step(source, { kind: 'move', from: loc(2), to: loc(5), position: 'inside-end' });
  expect(projectCoordinate(loc(3, 5), [moved.map])).toMatchObject(loc(4, 7));
  expect(projectCoordinate(loc(5), [moved.map])).toMatchObject(loc(2));
});

it('tracks same-line tags through line splitting and a later deletion', () => {
  const source = '<main><b>A</b><b>B</b></main>';
  const moved = step(source, { kind: 'move', from: loc(1, 7), to: loc(1, 15), position: 'after' });
  const removed = step(moved.source, { kind: 'remove', loc: loc(1, 7) });
  expect(projectCoordinate(loc(1, 7), [moved.map, removed.map])).toMatchObject(loc(2, 1));
  expect(projectCoordinate(loc(1, 15), [moved.map, removed.map])).toBeNull();
});

it('restores deleted identities through their persisted inverse without reviving another sibling', () => {
  const source = '<main>\n  <p>Same</p>\n  <p>Same</p>\n</main>\n';
  const removed = step(source, { kind: 'remove', loc: loc(2) });
  expect(projectCoordinate(loc(2), [removed.map])).toBeNull();
  expect(projectCoordinate(loc(2), [removed.map, ...invertIdentityMaps([removed.map])])).toMatchObject(loc(2));
  expect(projectCoordinate(loc(3), [removed.map, ...invertIdentityMaps([removed.map])])).toMatchObject(loc(3));
});

it('does not turn an unowned coordinate into the nearest surviving element', () => {
  const source = '<main>\n  <p>Same</p>\n  <p>Same</p>\n</main>\n';
  const moved = step(source, { kind: 'move', from: loc(2), to: loc(3), position: 'after' });
  expect(projectCoordinate(loc(2, 4), [moved.map])).toBeNull();
});

it('projects import line shifts and whitespace-sensitive subtree moves', () => {
  const source = '<main>\n  <pre>\n   a   b\n  </pre>\n  <p>Tail</p>\n</main>\n';
  const imported = step(source, { kind: 'import', pageFile: file, name: 'Card', importPath: '../components/Card.astro', remove: false });
  const moved = step(imported.source, { kind: 'move', from: loc(5), to: loc(8), position: 'after' });
  expect(moved.source).toContain('<pre>\n   a   b\n  </pre>');
  expect(projectCoordinate(loc(2), [imported.map, moved.map])).toMatchObject(loc(6));
  expect(projectCoordinate(loc(5), [imported.map, moved.map])).toMatchObject(loc(5));
});
