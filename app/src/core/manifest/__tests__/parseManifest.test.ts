/**
 * task-207 Task 1. Cases are the A-rows of
 * docs/plans/2026-08-11-task-207-variant-system-design.md.
 */
import { describe, it, expect } from 'vitest';
import { parseComponentManifest, manifestFromFrontmatter, manifestForComponent } from '../parseManifest';
import type { Manifest } from '../types';

const fm = (body: string) => `---\n${body}\n---\n<div />`;

/** The user's REAL untyped component (fixtures/local-astro-project). */
const DOUBLE_IMAGE = fm(
  `import { resolveAsset } from './resolveAsset';\n` +
  `const { src1, src2, alt1 = '', alt2 = '', caption = '', customClass = '' } = Astro.props;`,
);

const CREDIT = fm(`const { role, name } = Astro.props;`);

const MEDIA = fm(
  `interface Props {\n` +
  `  /** @media */\n` +
  `  items?: (string | null)[];\n` +
  `  class?: string;\n` +
  `  /** @unit px */\n` +
  `  gap?: number;\n` +
  `}\n` +
  `const { items = [null], class: cls = 'col-span-8', gap } = Astro.props;`,
);

const byName = (src: string, name: string) =>
  parseComponentManifest(src).props.find(p => p.name === name);

describe('tier 1 — untyped destructuring (the common case, F1)', () => {
  it('src1/src2 read as media slots by NAME', () => {
    expect(byName(DOUBLE_IMAGE, 'src1')?.control).toEqual({ kind: 'slot' });
    expect(byName(DOUBLE_IMAGE, 'src2')?.control).toEqual({ kind: 'slot' });
  });

  it('everything else is a text field, defaults captured', () => {
    expect(byName(DOUBLE_IMAGE, 'caption')).toEqual({
      name: 'caption', label: 'Caption', control: { kind: 'text' }, default: '',
    });
  });

  it('class-ish props are hidden (A13) — they would poison class writes', () => {
    expect(byName(DOUBLE_IMAGE, 'customClass')).toBeUndefined();
  });

  it('a component with no media props still yields a manifest', () => {
    expect(parseComponentManifest(CREDIT).props.map(p => p.name)).toEqual(['role', 'name']);
  });
});

describe('tier 2 — typed Props wins over the destructuring (A3)', () => {
  it('@media on an array prop → growable slots', () => {
    expect(byName(MEDIA, 'items')?.control).toEqual({ kind: 'slots' });
  });

  it('number + @unit px → numeric knob', () => {
    expect(byName(MEDIA, 'gap')?.control).toEqual({ kind: 'number', unit: 'px' });
  });

  it('class is hidden even when declared in Props', () => {
    expect(byName(MEDIA, 'class')).toBeUndefined();
  });

  it('a string-literal union → enum (A8 threshold not reached)', () => {
    const src = fm(`interface Props {\n  align?: 'left' | 'center' | 'right';\n}`);
    expect(byName(src, 'align')?.control).toEqual({
      kind: 'enum', values: ['left', 'center', 'right'],
    });
  });

  it('a numeric union → enum with numbers, not strings (A9)', () => {
    const src = fm(`interface Props {\n  cols?: 1 | 2 | 3;\n}`);
    expect(byName(src, 'cols')?.control).toEqual({ kind: 'enum', values: [1, 2, 3] });
  });

  it('boolean → toggle', () => {
    expect(byName(fm(`interface Props {\n  wide?: boolean;\n}`), 'wide')?.control)
      .toEqual({ kind: 'boolean' });
  });

  it('string | null is a text field, not an enum (A7)', () => {
    expect(byName(fm(`interface Props {\n  cap?: string | null;\n}`), 'cap')?.control)
      .toEqual({ kind: 'text' });
  });

  it('an object/nested type is OMITTED, never a text field (A6)', () => {
    const src = fm(`interface Props {\n  post?: CollectionEntry<'works'>;\n}`);
    expect(byName(src, 'post')).toBeUndefined();
  });

  it('type Props = {…} alias form parses too', () => {
    const src = fm(`type Props = {\n  /** @media */\n  src?: string;\n};`);
    expect(byName(src, 'src')?.control).toEqual({ kind: 'slot' });
  });
});

describe('annotations degrade, never throw (D3)', () => {
  it('an unknown/typo tag is ignored; the type still resolves (A10)', () => {
    const src = fm(`interface Props {\n  /** @varaint a|b */\n  gap?: number;\n}`);
    expect(byName(src, 'gap')?.control).toEqual({ kind: 'number', unit: 'px' });
  });

  it('@label overrides the humanized name', () => {
    const src = fm(`interface Props {\n  /** @label Corner radius */\n  radius?: number;\n}`);
    expect(byName(src, 'radius')?.label).toBe('Corner radius');
  });

  it('@min/@max/@step ride the numeric control', () => {
    const src = fm(`interface Props {\n  /** @min 0 @max 64 @step 4 */\n  gap?: number;\n}`);
    expect(byName(src, 'gap')?.control).toEqual({
      kind: 'number', unit: 'px', min: 0, max: 64, step: 4,
    });
  });

  it('@hidden removes an otherwise-editable prop', () => {
    const src = fm(`interface Props {\n  /** @hidden */\n  slug?: string;\n}`);
    expect(byName(src, 'slug')).toBeUndefined();
  });
});

describe('degradation (A14–A16)', () => {
  it('no frontmatter at all → empty manifest', () => {
    expect(parseComponentManifest('<div>hi</div>')).toEqual({ props: [] });
  });

  it('empty string → empty manifest', () => {
    expect(parseComponentManifest('')).toEqual({ props: [] });
  });

  it('a data-* index signature never becomes a prop', () => {
    const src = fm('interface Props {\n  [key: `data-${string}`]: string | undefined;\n}');
    expect(parseComponentManifest(src).props).toEqual([]);
  });

  it('only the FIRST frontmatter fence is scanned (A16)', () => {
    const src = `---\nconst { a } = Astro.props;\n---\n<p>---\nconst { b } = Astro.props;\n---</p>`;
    expect(parseComponentManifest(src).props.map(p => p.name)).toEqual(['a']);
  });
});

/**
 * task-207 Task 7 / D11: the scan payload already carries each local
 * component's frontmatter BODY (component-discovery's extractFrontmatter,
 * confirmed at runtime against /__sq/local/scan-components) — no new
 * endpoint and no fence re-wrapping at the call site.
 */
describe('manifestForComponent (scan payload → manifest)', () => {
  const MEDIA_FM = `interface Props {\n  /** @media */\n  items?: (string | null)[];\n  /** @unit px */\n  gap?: number;\n}`;
  const FALLBACK: Manifest = { props: [{ name: 'x', label: 'X', control: { kind: 'text' } }] };
  const scan = [{ path: 'src/components/sq/Media.astro', frontmatter: MEDIA_FM }];

  it('parses the scanned frontmatter when the component is there', () => {
    expect(manifestForComponent(scan, 'src/components/sq/Media.astro').props.map(p => p.name))
      .toEqual(['items', 'gap']);
  });

  it('falls back when the component is absent (WC has no local scan)', () => {
    expect(manifestForComponent(scan, 'src/components/sq/Nope.astro', FALLBACK)).toEqual(FALLBACK);
  });

  it('falls back when the scanned frontmatter yields no props', () => {
    const empty = [{ path: 'a.astro', frontmatter: 'const x = 1;' }];
    expect(manifestForComponent(empty, 'a.astro', FALLBACK)).toEqual(FALLBACK);
  });

  it('with no fallback, an absent component is an empty manifest, never a throw', () => {
    expect(manifestForComponent([], 'nope.astro')).toEqual({ props: [] });
  });

  it('manifestFromFrontmatter and parseComponentManifest agree', () => {
    expect(manifestFromFrontmatter(MEDIA_FM)).toEqual(parseComponentManifest(`---\n${MEDIA_FM}\n---\n<div />`));
  });
});
