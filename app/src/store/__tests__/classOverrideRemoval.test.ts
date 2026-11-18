import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyAllOverrides } from '../selectors';

/**
 * Regression for task-082: removing a class in the Classes tab must STICK.
 *
 * Instance class overrides store the FULL intended class set (every writer —
 * ClassStoreContext, the grid bridge, the AI tool — splits a full class
 * string; the command replaces the breakpoint array). The override is
 * therefore authoritative: resolving it must REPLACE the base class list,
 * not union with it. The old slot-aware merge kept any base class whose slot
 * the override didn't mention, so deleting a class (token gone, no same-slot
 * replacement) re-merged it back from the base — the class "reappeared on
 * Apply" and survived reload. Affects file-mode instances and the
 * master/assets editor alike.
 */

function buildInstance(staticMarkup: string, selector: string, overrideClasses: string[]): Y.Map<unknown> {
  const doc = new Y.Doc();
  const yEl = new Y.Map();
  yEl.set('staticMarkup', staticMarkup);

  const classOverrides = new Y.Map();
  const selectorOverride = new Y.Map();
  const baseArr = new Y.Array<string>();
  baseArr.push(overrideClasses);
  selectorOverride.set('base', baseArr);
  classOverrides.set(selector, selectorOverride);
  yEl.set('classOverrides', classOverrides);

  doc.getMap('elements').set('el-1', yEl);
  return yEl;
}

describe('class override removal (task-082)', () => {
  it('drops a base class the override no longer lists (data-key before class)', () => {
    const markup = '<div class="ring-8 p-4 bg-red-500" data-key="el-1:div-0"></div>';
    // User deleted ring-8 → override is the full set minus ring-8.
    const yEl = buildInstance(markup, 'div-0', ['p-4', 'bg-red-500']);

    const out = applyAllOverrides(markup, yEl);

    expect(out).not.toContain('ring-8');
    expect(out).toContain('p-4');
    expect(out).toContain('bg-red-500');
  });

  it('drops a base class the override no longer lists (class before data-key)', () => {
    const markup = '<div class="ring-8 p-4" data-key="el-1:div-0"></div>';
    const yEl = buildInstance(markup, 'div-0', ['p-4']);

    const out = applyAllOverrides(markup, yEl);

    expect(out).not.toContain('ring-8');
    expect(out).toContain('p-4');
  });

  it('clears all classes when the override is present but empty (user deleted every class)', () => {
    const markup = '<div class="ring-8 p-4" data-key="el-1:div-0"></div>';
    // User deleted every class → override exists but is empty.
    const yEl = buildInstance(markup, 'div-0', []);

    const out = applyAllOverrides(markup, yEl);

    expect(out).not.toContain('ring-8');
    expect(out).not.toContain('p-4');
  });

  it('still adds classes the override introduces', () => {
    const markup = '<div class="p-4" data-key="el-1:div-0"></div>';
    const yEl = buildInstance(markup, 'div-0', ['p-4', 'rounded-lg']);

    const out = applyAllOverrides(markup, yEl);

    expect(out).toContain('p-4');
    expect(out).toContain('rounded-lg');
  });
});
