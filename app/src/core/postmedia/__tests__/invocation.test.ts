/**
 * task-206 Phase 3: pure mutators over the raw <Media/> invocation source.
 * Count rides componentMedia's items contract; width is the v2 class contract
 * (col-span-8 / col-span-12 / col-span-full). task-207: the style knobs are
 * gone — gap/pad/margin/radius are plain props written by setProp.
 */
import { describe, it, expect } from 'vitest';
import { setCount, setWidth, setProp, getProp } from '../invocation';

const SRC = '<Media items={["a.png"]} class="col-span-8" />';

describe('setCount', () => {
  it('grows with nulls', () => {
    expect(setCount(SRC, 3)).toBe('<Media items={["a.png", null, null]} class="col-span-8" />');
  });

  it('shrinks from the END, never index 0', () => {
    const three = '<Media items={["a.png", "b.png", "c.png"]} class="col-span-8" />';
    expect(setCount(three, 2)).toBe('<Media items={["a.png", "b.png"]} class="col-span-8" />');
    expect(setCount(three, 1)).toBe('<Media items={["a.png"]} class="col-span-8" />');
  });

  it('refuses an items expression', () => {
    expect(setCount('<Media items={sources} class="col-span-8" />', 2)).toBeNull();
  });

  it('refuses when no component tag', () => {
    expect(setCount('plain text', 2)).toBeNull();
  });
});

describe('setWidth', () => {
  it('full → col-span-full', () => {
    expect(setWidth(SRC, 'full')).toBe('<Media items={["a.png"]} class="col-span-full" />');
  });

  it('12 → col-span-12', () => {
    expect(setWidth(SRC, 12)).toBe('<Media items={["a.png"]} class="col-span-12" />');
  });

  it('null → col-span-8 (the default measure)', () => {
    const full = '<Media items={["a.png"]} class="col-span-full" />';
    expect(setWidth(full, null)).toBe('<Media items={["a.png"]} class="col-span-8" />');
  });

  it('keeps unrelated classes, replaces only the col-span token', () => {
    const extra = '<Media items={["a.png"]} class="my-class col-span-8 other" />';
    expect(setWidth(extra, 12)).toBe('<Media items={["a.png"]} class="my-class col-span-12 other" />');
  });

  it('adds a class attr when none exists', () => {
    expect(setWidth('<Media items={["a.png"]} />', 12))
      .toBe('<Media class="col-span-12" items={["a.png"]} />');
  });

  it('refuses when no component tag', () => {
    expect(setWidth('plain', 'full')).toBeNull();
  });
});

describe('setProp (task-207)', () => {
  const S = '<Credit role="Design" name="Oleg" />';

  it('replaces an existing string literal, other attrs verbatim (B1)', () => {
    expect(setProp(S, 'role', 'Art Direction'))
      .toBe('<Credit role="Art Direction" name="Oleg" />');
  });

  it('inserts an absent prop after the tag name (B3)', () => {
    expect(setProp(S, 'caption', 'Hi'))
      .toBe('<Credit caption="Hi" role="Design" name="Oleg" />');
  });

  it('numbers and booleans are written as expressions', () => {
    expect(setProp('<Media />', 'gap', 24)).toBe('<Media gap={24} />');
    expect(setProp('<Media />', 'wide', true)).toBe('<Media wide={true} />');
  });

  it('replaces an existing literal expression', () => {
    expect(setProp('<Media gap={8} />', 'gap', 24)).toBe('<Media gap={24} />');
  });

  it('null REMOVES the attribute — never writes "" (B5)', () => {
    expect(setProp(S, 'role', null)).toBe('<Credit name="Oleg" />');
  });

  it('removing an absent prop is a no-op, not a failure', () => {
    expect(setProp(S, 'nope', null)).toBe(S);
  });

  it('escapes a double quote in the value', () => {
    expect(setProp('<Credit />', 'name', 'the "big" one'))
      .toBe('<Credit name="the &quot;big&quot; one" />');
  });

  it('a $-pattern in the value is written literally, never as a backref', () => {
    expect(setProp(S, 'role', "$& $1 $'")).toBe(`<Credit role="$& $1 $'" name="Oleg" />`);
    expect(setProp('<Credit />', 'name', '$&')).toBe('<Credit name="$&" />');
  });

  it('REFUSES a non-literal expression value (B2)', () => {
    expect(setProp('<Media gap={spacing} />', 'gap', 24)).toBeNull();
  });

  it('REFUSES an invocation carrying a spread (B7)', () => {
    expect(setProp('<Media {...props} gap={8} />', 'gap', 24)).toBeNull();
  });

  it('refuses when there is no component tag', () => {
    expect(setProp('plain text', 'gap', 24)).toBeNull();
  });

  it('handles a multi-line invocation (B6)', () => {
    const multi = '<Credit\n  role="Design"\n  name="Oleg"\n/>';
    expect(setProp(multi, 'role', 'PM')).toBe('<Credit\n  role="PM"\n  name="Oleg"\n/>');
  });
});

describe('getProp (task-207)', () => {
  const S = '<Credit role="Design" name="Oleg" />';

  it('reads a string literal, un-escaping a quote', () => {
    expect(getProp(S, 'role')).toBe('Design');
    expect(getProp('<Credit name="the &quot;big&quot; one" />', 'name')).toBe('the "big" one');
  });

  it('reads literal expressions as their real types', () => {
    expect(getProp('<Media gap={24} />', 'gap')).toBe(24);
    expect(getProp('<Media gap={-1.5} />', 'gap')).toBe(-1.5);
    expect(getProp('<Media wide={true} />', 'wide')).toBe(true);
    expect(getProp("<Media align={'left'} />", 'align')).toBe('left');
  });

  it('an absent, non-literal, or null source is undefined', () => {
    expect(getProp(S, 'nope')).toBeUndefined();
    expect(getProp('<Media gap={spacing} />', 'gap')).toBeUndefined();
    expect(getProp(null, 'gap')).toBeUndefined();
  });

  it('round-trips whatever setProp wrote', () => {
    for (const v of ['Art Direction', 'the "big" one', 24, true] as const) {
      const next = setProp(S, 'x', v);
      expect(getProp(next, 'x')).toBe(v);
    }
  });
});
