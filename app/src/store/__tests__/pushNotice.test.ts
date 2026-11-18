/**
 * Push feedback — ONE builder, both runtimes.
 *
 * Blind review, 2026-08-04: "The Push toast is the loudest tell." Local said
 *   `Feature.astro updated — 1 change written · 2 pages render it`
 * while WC/server said the generic
 *   `Changes pushed to the master component.`
 * Same gesture, same menu, same confirmation — two different reports. The
 * specific one is better, so BOTH now come from here, fed by the same
 * `useComponentUsage` numbers the confirmation modal already prints.
 *
 * Two things the copy must NOT do, and both are pinned below:
 *
 *  1. **Never claim a file write where there is none.** Local's push writes the
 *     real `.astro`; WC/server's writes the doc master overlay. So the verb is
 *     "pushed", never "written to disk", and the subject is the component's
 *     DISPLAY NAME (`Header`) — not a path, and not `Header.astro`, which was
 *     the second tell the same review found.
 *  2. **Never disagree with itself about number.** `1 other placement keep` was
 *     shipped copy; agreement now comes from utils/plural (`plural` + `verb`).
 *
 * These are pure builders so the copy is pinned without rendering the DesignBar;
 * the two handlers feed them react-hot-toast (local under one updated toast id,
 * WC/server resolved immediately — its push is synchronous).
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { pushStartNotice, pushNotice } from '../pushNotice';
import { selectLocalOverriddenPlacements } from '../componentUsage';

describe('push feedback — the start notice', () => {
  it('announces the push the moment it starts, naming component and count', () => {
    expect(pushStartNotice('Header', 3)).toBe('Pushing 3 changes into Header…');
    expect(pushStartNotice('Header', 1)).toBe('Pushing 1 change into Header…');
  });
});

describe('push feedback — the result notice', () => {
  it('success names the component, the changes and the scope', () => {
    expect(pushNotice('Header', { pushed: 3, failed: 0 }, {
      pageCount: 2, overriddenPlacements: 3,
    })).toEqual({
      level: 'success',
      message: 'Header updated — 3 changes pushed · 2 pages render it · 2 other placements still override it',
    });
  });

  it('agrees in number at ONE — the exact strings the review flagged', () => {
    expect(pushNotice('Header', { pushed: 1, failed: 0 }, {
      pageCount: 1, overriddenPlacements: 2,
    })).toEqual({
      level: 'success',
      message: 'Header updated — 1 change pushed · 1 page renders it · 1 other placement still overrides it',
    });
  });

  it('omits what it cannot count — the notice degrades, it never disappears', () => {
    expect(pushNotice('Card', { pushed: 1, failed: 0 }, {})).toEqual({
      level: 'success',
      message: 'Card updated — 1 change pushed',
    });
    // The pushed placement was the only one overriding: nothing is left behind,
    // so the clause is dropped rather than printed as "0 other placements".
    expect(pushNotice('Card', { pushed: 1, failed: 0 }, {
      pageCount: 1, overriddenPlacements: 1,
    })).toEqual({
      level: 'success',
      message: 'Card updated — 1 change pushed · 1 page renders it',
    });
  });

  it('a partial failure says how many landed and how many did not', () => {
    expect(pushNotice('Header', { pushed: 3, failed: 1 }, { pageCount: 2 })).toEqual({
      level: 'error',
      message: 'Header: 1 of 4 changes could not be pushed — 3 pushed',
    });
  });

  it('a total failure never claims a partial success', () => {
    expect(pushNotice('Header', { pushed: 0, failed: 2 }, { pageCount: 2 })).toEqual({
      level: 'error',
      message: 'Header: 2 changes could not be pushed',
    });
  });

  it('a failure REASON is surfaced, not swallowed into the count', () => {
    // task-166. Verified live before this existed: Push said only
    // "MapBar: 1 change could not be pushed" — no cause, no remedy,
    // indistinguishable from a writer timeout — while the component-view
    // route, for the identical rejection, toasted the sentence the user can
    // act on. `pushLocalOverridesToMaster` caught the rejection and counted it;
    // `PushResult` had nowhere to put the message.
    expect(pushNotice('MapBar', {
      pushed: 0,
      failed: 1,
      reasons: ['class:list has no editable leading literal — edit it in the source file'],
    })).toEqual({
      level: 'error',
      message: 'MapBar: 1 change could not be pushed. ' +
        'class:list has no editable leading literal — edit it in the source file',
    });
  });

  it('two distinct reasons are both kept — a second cause is not less true', () => {
    expect(pushNotice('MapBar', {
      pushed: 2, failed: 2, reasons: ['a is dynamic', 'the editor could not write to this file'],
    }).message).toBe(
      'MapBar: 2 of 4 changes could not be pushed — 2 pushed. ' +
      'a is dynamic · the editor could not write to this file',
    );
  });

  it('no reasons leaves the sentence exactly as it was', () => {
    expect(pushNotice('Header', { pushed: 3, failed: 1, reasons: [] }).message)
      .toBe('Header: 1 of 4 changes could not be pushed — 3 pushed');
  });

  it('nothing to push is stated, not swallowed', () => {
    expect(pushNotice('Header', { pushed: 0, failed: 0 }, { pageCount: 2 })).toEqual({
      level: 'info',
      message: 'Nothing to push — Header has no unpushed changes.',
    });
  });

  it('never mentions a file path or an .astro extension — the caller passes a display name', () => {
    const { message } = pushNotice('Header', { pushed: 2, failed: 0 }, { pageCount: 3 });
    expect(message).not.toContain('.astro');
    expect(message).not.toContain('/');
    expect(message).not.toContain('written');
  });
});

/**
 * task-187 — the count fed to the "other placements" clause, END TO END.
 *
 * The clause is built from ONE number (`overriddenPlacements`, minus the
 * placement being acted on) that `store/componentUsage.selectLocalOverriddenPlacements`
 * produces and that BOTH the confirmation modal (`DesignBar/InstanceMenu`) and
 * this toast print. Pinning the copy alone could not have caught the defect —
 * the sentence was well-formed, the number behind it was a lie — so the selector
 * is composed with the builder here, exactly as DesignBar composes them.
 *
 * What Push actually does (store/localMasterOverrides):
 *   - writes + clears the SELECTED placement's overrides;
 *   - ALSO clears the master's own BARE-key overrides (`supersededMasterOverrides`,
 *     task-185) once a write lands.
 * So a bare key is never a placement that "keeps the edits already made there".
 */
describe('push feedback — what "other placements" is counted from (local)', () => {
  const FILE = 'src/components/Header.astro';
  const HERE = 'sa36223c3e9daaf17';

  const edited = (doc: Y.Doc, key: string) => {
    const e = new Y.Map();
    e.set('classes', 'bg-slate-500');
    e.set('edited', true);
    doc.getMap('sourceClasses').set(key, e);
  };

  // `placement` is passed explicitly on every call — a default would swallow the
  // master-view case, whose whole point is passing `undefined`.
  const noticeFor = (keys: string[], placement: string | undefined) => {
    const doc = new Y.Doc();
    doc.transact(() => { for (const k of keys) edited(doc, k); }, 'sync');
    return pushNotice('Header', { pushed: 1, failed: 0 }, {
      pageCount: 2,
      overriddenPlacements: selectLocalOverriddenPlacements(doc, FILE, placement),
    }).message;
  };

  it('0 others — the pushed placement was the only one, so the clause is absent', () => {
    expect(noticeFor([`${FILE}:6:1~${HERE}`], HERE))
      .toBe('Header updated — 1 change pushed · 2 pages render it');
  });

  it('the master\'s own bare key is NOT an "other placement" — Push clears it too', () => {
    expect(noticeFor([`${FILE}:6:1`, `${FILE}:6:1~${HERE}`], HERE))
      .toBe('Header updated — 1 change pushed · 2 pages render it');
  });

  it('1 other — a real second placement, which really does keep its edits', () => {
    expect(noticeFor([`${FILE}:6:1`, `${FILE}:6:1~${HERE}`, `${FILE}:6:1~sbbbbbbbbbbbbbbb2`], HERE))
      .toBe('Header updated — 1 change pushed · 2 pages render it · 1 other placement still overrides it');
  });

  it('N others — the bare key never inflates the number', () => {
    expect(noticeFor([
      `${FILE}:6:1`,
      `${FILE}:6:1~${HERE}`,
      `${FILE}:6:1~sbbbbbbbbbbbbbbb2`,
      `${FILE}:6:1~sccccccccccccccc3`,
    ], HERE)).toBe('Header updated — 1 change pushed · 2 pages render it · 2 other placements still override it');
  });

  it('pushing from the MASTER view keeps every real placement in the count', () => {
    // placement === undefined: the bare key IS the one being pushed, and the two
    // real placements keep their overrides — Push does not touch them.
    expect(noticeFor([
      `${FILE}:6:1`,
      `${FILE}:6:1~${HERE}`,
      `${FILE}:6:1~sbbbbbbbbbbbbbbb2`,
    ], undefined))
      .toBe('Header updated — 1 change pushed · 2 pages render it · 2 other placements still override it');
  });
});
