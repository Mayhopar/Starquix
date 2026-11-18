/**
 * task-159/160 — the migration contract.
 *
 * A user with outstanding work has overrides stored under a SUPERSEDED
 * placement address: `…~p<16 hex>` (the original coordinate chain) or
 * `…~q<16 hex>` (task-159's ordinal chain). The scan asserts the
 * correspondence (`legacyKeys` beside `key`, most recent first) and this moves
 * the data across exactly once.
 *
 * task-160 — the list is walked IN ORDER and the first tier holding a value
 * wins, so p→s and q→s each land in ONE hop. There is deliberately no
 * transitive replay: eager stamping means the stamp is written before the first
 * scan ever runs, so nothing was ever stored at the intermediate address.
 *
 * The two cases that must not be got wrong:
 *   - a PERMUTATION (one move's target is another move's source) — that is the
 *     reported defect's own shape, and a sequential set/delete loop loses an
 *     entry there;
 *   - NEVER purging an unmatched legacy key — `store/placementMigration.ts` was
 *     deleted for exactly that and it destroyed live user data.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { migratePlacementKeys } from '../placementKeyMigration';
import { SOURCE_OVERRIDE_MAP_NAMES } from '../sourceOverrideEntries';

const FILE = 'src/components/SiteNav.astro:4:1';
const P_TOP = 'pe6f8cae40c888072';
const P_BOTTOM = 'p93bc2faa3a8ad14c';
const Q_TOP = 'qa7d57c53ae161ed3';
const Q_BOTTOM = 'q82b9ebf2d763c510';
const S_TOP = 's1111111111111111';
const S_BOTTOM = 's2222222222222222';

const legacy = (p: string, n?: number) => `${FILE}~${p}${n ? `#${n}` : ''}`;
const current = (q: string, n?: number) => `${FILE}~${q}${n ? `#${n}` : ''}`;
const stamped = (sId: string, n?: number) => `${FILE}~${sId}${n ? `#${n}` : ''}`;

let doc: Y.Doc;
beforeEach(() => {
  doc = new Y.Doc();
});

function seedClasses(key: string, classes: string): void {
  const entry = new Y.Map<unknown>();
  entry.set('classes', classes);
  entry.set('edited', true);
  const loc = new Y.Map<unknown>();
  loc.set('file', 'src/components/SiteNav.astro');
  loc.set('line', 4);
  loc.set('column', 1);
  entry.set('sourceLocation', loc);
  doc.getMap('sourceClasses').set(key, entry);
}

const classesAt = (key: string) =>
  (doc.getMap('sourceClasses').get(key) as Y.Map<unknown> | undefined)?.get('classes');

describe('migratePlacementKeys — two legacy tiers (task-160)', () => {
  it('migrates a PRE-task-159 `p…` override straight onto the stamped address', () => {
    seedClasses(legacy(P_TOP), 'px-5');
    const moved = migratePlacementKeys(doc, [
      { key: stamped(S_TOP), legacyKeys: [current(Q_TOP), legacy(P_TOP)] },
    ]);
    expect(moved).toBe(1);
    expect(classesAt(stamped(S_TOP))).toBe('px-5');
    // ONE hop — nothing was ever parked at the intermediate `q…` address.
    expect(doc.getMap('sourceClasses').has(current(Q_TOP))).toBe(false);
    expect(doc.getMap('sourceClasses').has(legacy(P_TOP))).toBe(false);
  });

  it('migrates a task-159 `q…` override onto the stamped address', () => {
    seedClasses(current(Q_TOP), 'py-2');
    migratePlacementKeys(doc, [
      { key: stamped(S_TOP), legacyKeys: [current(Q_TOP), legacy(P_TOP)] },
    ]);
    expect(classesAt(stamped(S_TOP))).toBe('py-2');
  });

  it('prefers the MOST RECENT tier when both tiers hold a value', () => {
    seedClasses(current(Q_TOP), 'the-newer');
    seedClasses(legacy(P_TOP), 'the-older');
    migratePlacementKeys(doc, [
      { key: stamped(S_TOP), legacyKeys: [current(Q_TOP), legacy(P_TOP)] },
    ]);
    expect(classesAt(stamped(S_TOP))).toBe('the-newer');
    // Rule 1 — the loser is left exactly where it is, never purged.
    expect(classesAt(legacy(P_TOP))).toBe('the-older');
  });

  it('stays permutation-safe across tiers (one nav’s new id IS another’s old id)', () => {
    seedClasses(legacy(P_TOP), 'top-edit');
    seedClasses(legacy(P_BOTTOM), 'bottom-edit');
    migratePlacementKeys(doc, [
      { key: stamped(S_TOP), legacyKeys: [current(Q_TOP), legacy(P_TOP)] },
      { key: stamped(S_BOTTOM), legacyKeys: [current(Q_BOTTOM), legacy(P_BOTTOM)] },
    ]);
    expect(classesAt(stamped(S_TOP))).toBe('top-edit');
    expect(classesAt(stamped(S_BOTTOM))).toBe('bottom-edit');
  });

  it('is idempotent — a second scan with the same list moves nothing', () => {
    seedClasses(legacy(P_TOP), 'px-5');
    const els = [{ key: stamped(S_TOP), legacyKeys: [current(Q_TOP), legacy(P_TOP)] }];
    expect(migratePlacementKeys(doc, els)).toBe(1);
    expect(migratePlacementKeys(doc, els)).toBe(0);
    expect(classesAt(stamped(S_TOP))).toBe('px-5');
  });

  it('never purges a legacy key the scan did not match', () => {
    seedClasses(legacy(P_BOTTOM), 'orphan-but-alive');
    migratePlacementKeys(doc, [
      { key: stamped(S_TOP), legacyKeys: [current(Q_TOP), legacy(P_TOP)] },
    ]);
    expect(classesAt(legacy(P_BOTTOM))).toBe('orphan-but-alive');
  });
});

describe('migratePlacementKeys', () => {
  it('moves an override from the legacy address to the current one', () => {
    seedClasses(legacy(P_TOP), 'px-5');
    const moved = migratePlacementKeys(doc, [
      { key: current(Q_TOP), legacyKeys: [legacy(P_TOP)] },
    ]);
    expect(moved).toBe(1);
    expect(classesAt(current(Q_TOP))).toBe('px-5');
    expect(doc.getMap('sourceClasses').has(legacy(P_TOP))).toBe(false);
  });

  it('handles a PERMUTATION — one move’s target IS another move’s source', () => {
    // The reported defect's own shape: after a line shift the top nav's NEW id
    // is literally the bottom nav's OLD id. A sequential set/delete loop drops
    // an entry here.
    seedClasses(legacy(P_TOP), 'px-5');
    seedClasses(legacy(P_BOTTOM), 'px-1');
    const moved = migratePlacementKeys(doc, [
      { key: legacy(P_BOTTOM), legacyKeys: [legacy(P_TOP)] },
      { key: current(Q_BOTTOM), legacyKeys: [legacy(P_BOTTOM)] },
    ]);
    expect(moved).toBe(2);
    expect(classesAt(legacy(P_BOTTOM))).toBe('px-5');
    expect(classesAt(current(Q_BOTTOM))).toBe('px-1');
    expect(doc.getMap('sourceClasses').has(legacy(P_TOP))).toBe(false);
  });

  it('migrates ALL FOUR tiers, sourceLinkAttributes included', () => {
    for (const name of SOURCE_OVERRIDE_MAP_NAMES) {
      const v = new Y.Map<unknown>();
      v.set('marker', name);
      doc.getMap(name).set(legacy(P_TOP), v);
    }
    const moved = migratePlacementKeys(doc, [
      { key: current(Q_TOP), legacyKeys: [legacy(P_TOP)] },
    ]);
    expect(moved).toBe(SOURCE_OVERRIDE_MAP_NAMES.length);
    for (const name of SOURCE_OVERRIDE_MAP_NAMES) {
      const m = doc.getMap(name);
      expect((m.get(current(Q_TOP)) as Y.Map<unknown>).get('marker')).toBe(name);
      expect(m.has(legacy(P_TOP))).toBe(false);
    }
  });

  it('keeps nested Yjs values intact (sourceLocation survives the clone)', () => {
    seedClasses(legacy(P_TOP), 'px-5');
    migratePlacementKeys(doc, [{ key: current(Q_TOP), legacyKeys: [legacy(P_TOP)] }]);
    const entry = doc.getMap('sourceClasses').get(current(Q_TOP)) as Y.Map<unknown>;
    const loc = entry.get('sourceLocation') as Y.Map<unknown>;
    expect(loc.get('file')).toBe('src/components/SiteNav.astro');
    expect(loc.get('line')).toBe(4);
    expect(loc.get('column')).toBe(1);
    expect(entry.get('edited')).toBe(true);
  });

  it('leaves the legacy entry ALONE when the new key is already occupied', () => {
    seedClasses(legacy(P_TOP), 'old');
    seedClasses(current(Q_TOP), 'new');
    const moved = migratePlacementKeys(doc, [
      { key: current(Q_TOP), legacyKeys: [legacy(P_TOP)] },
    ]);
    expect(moved).toBe(0);
    expect(classesAt(current(Q_TOP))).toBe('new');
    expect(classesAt(legacy(P_TOP))).toBe('old');
  });

  it('NEVER deletes an unmatched legacy key', () => {
    // Nothing on this scan claims it. It stays, forever, untouched.
    seedClasses(legacy('pdeadbeefdeadbeef'), 'orphaned');
    seedClasses(legacy(P_TOP), 'px-5');
    migratePlacementKeys(doc, [{ key: current(Q_TOP), legacyKeys: [legacy(P_TOP)] }]);
    expect(classesAt(legacy('pdeadbeefdeadbeef'))).toBe('orphaned');
  });

  it('never touches a BARE key — a page file’s own elements have no placement', () => {
    seedClasses('src/pages/index.astro:6:3', 'text-xl');
    migratePlacementKeys(doc, [
      { key: 'src/pages/index.astro:6:3', legacyKeys: ['src/pages/index.astro:6:3'] },
      { key: current(Q_TOP), legacyKeys: [legacy(P_TOP)] },
    ]);
    expect(classesAt('src/pages/index.astro:6:3')).toBe('text-xl');
  });

  it('preserves the #N repeat suffix', () => {
    seedClasses(legacy(P_TOP, 2), 'px-5');
    const moved = migratePlacementKeys(doc, [
      { key: current(Q_TOP, 2), legacyKeys: [legacy(P_TOP, 2)] },
    ]);
    expect(moved).toBe(1);
    expect(classesAt(current(Q_TOP, 2))).toBe('px-5');
  });

  it('never touches instance-child / drawn- / dynamic: / el- keys', () => {
    const untouchable = [
      'el-abc123',
      'el-abc123:h1-0',
      'drawn-xyz',
      'dynamic:div:3@deadbeef',
    ];
    for (const k of untouchable) seedClasses(k, 'keep');
    migratePlacementKeys(doc, [
      // A malformed plan naming an instance key must be rejected by the planner.
      { key: 'el-abc123:h1-0', legacyKeys: ['el-abc123'] },
      { key: current(Q_TOP), legacyKeys: [legacy(P_TOP)] },
    ]);
    for (const k of untouchable) expect(classesAt(k)).toBe('keep');
  });

  it('refuses a move whose ELEMENT half disagrees (two different elements)', () => {
    seedClasses(`src/components/A.astro:1:1~${P_TOP}`, 'a');
    const moved = migratePlacementKeys(doc, [
      { key: `src/components/B.astro:9:9~${Q_TOP}`, legacyKeys: [`src/components/A.astro:1:1~${P_TOP}`] },
    ]);
    expect(moved).toBe(0);
    expect(classesAt(`src/components/A.astro:1:1~${P_TOP}`)).toBe('a');
  });

  it('is idempotent over two scans', () => {
    seedClasses(legacy(P_TOP), 'px-5');
    const els = [{ key: current(Q_TOP), legacyKeys: [legacy(P_TOP)] }];
    expect(migratePlacementKeys(doc, els)).toBe(1);
    expect(migratePlacementKeys(doc, els)).toBe(0);
    expect(classesAt(current(Q_TOP))).toBe('px-5');
  });

  it('transacts with origin "sync" and takes no snapshot', () => {
    seedClasses(legacy(P_TOP), 'px-5');
    const origins: unknown[] = [];
    doc.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin));
    migratePlacementKeys(doc, [{ key: current(Q_TOP), legacyKeys: [legacy(P_TOP)] }]);
    expect(origins).toEqual(['sync']);
  });

  it('is a no-op when nothing carries a legacy key (WC / server)', () => {
    seedClasses('src/components/Card.astro:4:1', 'px-5');
    expect(migratePlacementKeys(doc, [{ key: 'src/components/Card.astro:4:1' }])).toBe(0);
  });
});
