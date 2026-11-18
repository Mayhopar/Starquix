import { describe, it, expect } from 'vitest';
import { resolveOverrideClasses } from '../masters';

/**
 * The single decision shared by every instance class-override read path
 * (getClassesFromYjs, the live iframe sync): the override — when one exists —
 * is the FULL intended class set and REPLACES the base; absent override falls
 * back to the base. An override present-but-empty means the user deleted every
 * class, so it resolves to '' (NOT the base). task-082.
 */
describe('resolveOverrideClasses', () => {
  it('no override (null) → base classes', () => {
    expect(resolveOverrideClasses('hero p-4', null)).toBe('hero p-4');
  });

  it('override replaces the base (deleted class is gone)', () => {
    // base had ring-8; override is the full set minus ring-8
    expect(resolveOverrideClasses('hero ring-8 p-4', ['hero', 'p-4'])).toBe('hero p-4');
  });

  it('present-but-empty override → empty string (user cleared all classes)', () => {
    expect(resolveOverrideClasses('hero p-4', [])).toBe('');
  });
});
