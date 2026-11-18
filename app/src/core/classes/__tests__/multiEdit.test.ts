/** Multi-selection style edits — merge in, diff out (design ledger §2, D1–D3,
 *  docs/plans/2026-11-16-multi-select-edit-design.md). */
import { describe, it, expect } from 'vitest';
import { mergeMemberTokens, changedGroups, applyGroupEdit, applyOwnedEdit, editMemberAtSlot } from '../multiEdit';

const base = { breakpoint: 'xs', theme: 'light', state: 'default' } as const;
const sorted = (s: string | null) => (s ?? '').split(/\s+/).filter(Boolean).sort();
const edit = (classes: string, shown: string[], after: string[], slot = base) =>
  editMemberAtSlot(classes, slot, e => applyGroupEdit(e, after, changedGroups(shown, after)));

describe('mergeMemberTokens', () => {
  it('shows shared groups, marks differing ones mixed (worked example)', () => {
    const m = mergeMemberTokens([['p-4', 'text-red-500', 'text-lg', 'font-bold'], ['p-2', 'text-blue-500', 'text-lg']]);
    expect(m.tokens).toEqual(['text-lg']);
    expect([...m.mixedGroups].sort()).toEqual(['p-', 'standalone:fontWeight', 'text-'].sort());
  });
  it('"some have none" is mixed', () => {
    expect(mergeMemberTokens([['bg-red-500'], []]).mixedGroups.has('bg-')).toBe(true);
  });
  it('no members → nothing', () => {
    expect(mergeMemberTokens([])).toEqual({ tokens: [], mixedGroups: new Set() });
  });
});

describe('editMemberAtSlot + applyGroupEdit', () => {
  it('colour → green changes only colour on each member (worked example)', () => {
    expect(sorted(edit('p-4 text-red-500 text-lg font-bold', ['text-lg'], ['text-lg', 'text-green-500'])))
      .toEqual(sorted('p-4 text-green-500 text-lg font-bold'));
    expect(sorted(edit('p-2 text-blue-500 text-lg', ['text-lg'], ['text-lg', 'text-green-500'])))
      .toEqual(sorted('p-2 text-green-500 text-lg'));
  });
  it('setting a mixed weight makes it equal: bold → normal, none → normal', () => {
    expect(sorted(edit('font-bold p-1', [], ['font-normal']))).toEqual(sorted('font-normal p-1'));
    expect(sorted(edit('p-1', [], ['font-normal']))).toEqual(sorted('font-normal p-1'));
  });
  it('a removal through the transform removes it on every member (Fill −, ledger C8)', () => {
    expect(sorted(editMemberAtSlot('bg-red-500 p-2', base, e => e.filter(t => !/^bg-/.test(t))))).toEqual(['p-2']);
  });
  it('custom classes are never touched (ledger D2)', () => {
    expect(sorted(edit('my-card text-red-500', [], ['text-green-500']))).toEqual(sorted('my-card text-green-500'));
  });
  it('an md edit writes only the md slot (ledger C9)', () => {
    const md = { ...base, breakpoint: 'md' } as const;
    expect(sorted(edit('p-4 text-red-500', ['p-4'], ['p-4', 'text-green-500'], md)))
      .toEqual(sorted('p-4 text-red-500 md:text-green-500'));
  });
  it('null when nothing changes (no write)', () => {
    expect(edit('p-4', ['p-4'], ['p-4'])).toBeNull();
  });
});

describe('applyOwnedEdit (each write declares what it owns — design §2)', () => {
  const isWeight = (t: string) => /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/.test(t);
  it('a "set to default" (no token) on a Mixed control clears it on every member', () => {
    expect(applyOwnedEdit(['font-bold', 'p-1'], ['text-lg'], isWeight)).toEqual(['p-1']);
  });
  it('siblings a block re-emitted from the shown values are ignored', () => {
    // the block re-emitted `px-0` from the merged view; only weight is owned
    expect(applyOwnedEdit(['px-4', 'font-bold'], ['px-0', 'font-normal'], isWeight)).toEqual(['px-4', 'font-normal']);
  });
});
