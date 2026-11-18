import { describe, expect, it } from 'vitest';
import { applyStructuralTransform } from '../structuralTransform';

const bare = '<main />\n';
const imported = "---\nimport Card from './Card.astro';\n---\n<main />\n";
const op = { kind: 'import' as const, pageFile: 'src/pages/index.astro', name: 'Card', importPath: './Card.astro', remove: false };

describe('structural import preparation results', () => {
  it.each([
    { name: 'new frontmatter', before: bare, after: imported, added: true, lineDelta: 3 },
    { name: 'existing frontmatter', before: '---\nconst x = 1;\n---\n<main />\n', after: "---\nimport Card from './Card.astro';\nconst x = 1;\n---\n<main />\n", added: true, lineDelta: 1 },
    { name: 'already imported', before: imported, after: imported, added: false, lineDelta: 0 },
  ])('returns source bytes and insertion metadata for $name', ({ before, after, added, lineDelta }) => {
    expect(applyStructuralTransform(before, op)).toEqual({ content: after, added, lineDelta });
  });

  it.each([
    { name: 'existing import', before: imported, after: '---\n---\n<main />\n', removed: true, removeFences: false },
    { name: 'created fences', before: imported, after: bare, removed: true, removeFences: true },
    { name: 'absent import', before: bare, after: bare, removed: false, removeFences: false },
  ])('returns source bytes and removal metadata for $name', ({ before, after, removed, removeFences }) => {
    expect(applyStructuralTransform(before, { ...op, remove: true, removeFences })).toEqual({ content: after, removed });
  });
});
