import { describe, it, expect } from 'vitest';
import { addLayoutProp, removeLayoutProp, layoutBodyReferencesProp, applyLayoutPropOp } from './layoutPropEdit';
import { extractProps, extractFrontmatter } from './component-discovery';

const LAYOUT = `---
interface Props {
  title?: string;
}
const { title = 'Home' } = Astro.props;
---
<html><body><slot /></body></html>`;

describe('addLayoutProp', () => {
  it('adds the prop to interface Props and the destructuring', () => {
    const out = addLayoutProp(LAYOUT, 'cta');
    const props = extractProps(extractFrontmatter(out)).map(p => p.name);
    expect(props).toContain('cta');
    expect(out).toMatch(/const\s*\{[^}]*\bcta\b[^}]*\}\s*=\s*Astro\.props/);
  });

  it('creates interface + destructuring when absent', () => {
    const bare = `---\n---\n<html><body><slot /></body></html>`;
    const out = addLayoutProp(bare, 'cta');
    expect(extractProps(extractFrontmatter(out)).map(p => p.name)).toEqual(['cta']);
    expect(out).toMatch(/const\s*\{[^}]*\bcta\b/);
  });
});

describe('removeLayoutProp', () => {
  it('strips the prop from interface and destructuring', () => {
    const added = addLayoutProp(LAYOUT, 'cta');
    const out = removeLayoutProp(added, 'cta');
    expect(extractProps(extractFrontmatter(out)).map(p => p.name)).not.toContain('cta');
    expect(out).not.toMatch(/\bcta\b/);
  });
});

describe('layoutBodyReferencesProp', () => {
  it('is true when the template references the prop', () => {
    const used = `---\ninterface Props { cta?: string }\nconst { cta } = Astro.props;\n---\n<a>{cta}</a>`;
    expect(layoutBodyReferencesProp(used, 'cta')).toBe(true);
  });
  it('is false when only declared, not used in the body', () => {
    expect(layoutBodyReferencesProp(addLayoutProp(LAYOUT, 'cta'), 'cta')).toBe(false);
  });
});

describe('applyLayoutPropOp', () => {
  const L = `---\ninterface Props { title?: string }\nconst { title } = Astro.props;\n---\n<slot />`;

  it('add: returns new source containing the prop', () => {
    const r = applyLayoutPropOp(L, { op: 'add', propName: 'cta' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.source).toMatch(/\bcta\b/);
  });
  it('add: rejects a reserved name', () => {
    expect(applyLayoutPropOp(L, { op: 'add', propName: 'title' })).toMatchObject({ ok: false });
  });
  it('add: rejects an invalid name', () => {
    expect(applyLayoutPropOp(L, { op: 'add', propName: '1bad' })).toMatchObject({ ok: false });
  });
  it('add: rejects a duplicate', () => {
    const withCta = applyLayoutPropOp(L, { op: 'add', propName: 'cta' });
    if (withCta.ok) expect(applyLayoutPropOp(withCta.source, { op: 'add', propName: 'cta' })).toMatchObject({ ok: false });
  });
  it('remove: strips the prop', () => {
    const withCta = applyLayoutPropOp(L, { op: 'add', propName: 'cta' });
    if (withCta.ok) {
      const r = applyLayoutPropOp(withCta.source, { op: 'remove', propName: 'cta' });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.source).not.toMatch(/\bcta\b/);
    }
  });
  it('remove: refuses a prop used in the body', () => {
    const used = `---\ninterface Props { cta?: string }\nconst { cta } = Astro.props;\n---\n<a>{cta}</a>`;
    expect(applyLayoutPropOp(used, { op: 'remove', propName: 'cta' })).toMatchObject({ ok: false });
  });
});
