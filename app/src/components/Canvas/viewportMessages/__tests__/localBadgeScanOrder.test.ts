/**
 * THE reload badge (↻) guard rail: its answer must not depend on HOW MANY scans
 * ran, or on a scan that lands while a dispatched write is still in flight.
 *
 * The badge has been broken twice by changes nobody thought touched it — a
 * second overlaid preview iframe, and an extra scan fired at 0ms — and both were
 * reverted without a test. The reason it is that fragile is structural, and it
 * is what these two tests pin: the badge compares a WRITE-ONCE anchor
 * (`baseClasses`, only-if-absent in sourceOverrideEntries.noteSourceBaseValue)
 * against a LAST-SCAN-WINS value (`fileClasses`), and BOTH halves are fed by the
 * same ELEMENTS_SCANNED sweep. Change which scans land, and you change the
 * answer — unless the two invariants below hold.
 *
 * Deliberately driven through the REAL handler (handleElementsScanned) rather
 * than the store helpers: localMasterOutdated.test.ts already pins the gate in
 * isolation, and every regression so far arrived as a change to scan ORDER, not
 * to the gate.
 *
 * ponytail: KNOWN CEILING — this pins the two STORE halves the badge reads, not
 * the render join at DesignBar.tsx (`showReload = … || (!!localComponentSource
 * && localOutdated)`), which is still untested. A change that nulls
 * `localComponentSource` — the placement-root scope gate — would leave both
 * tests here green and the badge invisible. Upgrade path: one render test
 * asserting PullFromSourceButton (title 'Updates available — pull from source')
 * appears for a placement-root selection and not for a non-root one.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import { handleElementsScanned } from '../scanning';
import { makeFakeCtx, makeFakeIframe } from './fakeContext';
import { applyCommand } from '@/store/commands';
import { localMasterOutdated } from '@/store/localMasterOverrides';
import {
  sourceClassBaseValue,
  sourceFileValue,
  stampFileValueForLine,
} from '@/store/sourceOverrideEntries';
import { resetClassWriteBaselines } from '@/services/classWriteBaseline';

const CARD = 'src/components/Card.astro';
const LINE = `${CARD}:4:1`;
const PLACEMENT = 's4db83f82b016cfb0';
const KEY = `${LINE}~${PLACEMENT}`;

const FILE_BEFORE = 'card px-4 py-2';
const OVERRIDE = 'card px-4 py-2 bg-red-500';
const FILE_AFTER = 'card px-8 py-6';

const scan = (classes: string) => ({
  key: KEY,
  parentKey: null,
  tagName: 'div',
  classes,
  rect: { top: 0, left: 0, width: 10, height: 10 },
});

function ctxWithIframe() {
  return makeFakeCtx({ refs: { iframe: makeFakeIframe().iframe }, env: { doc: new Y.Doc() } });
}

/** The real gesture: the canvas click registers the element, then the user styles it. */
function clickThenEdit(doc: Y.Doc, classes: string): void {
  doc.transact(() => {
    applyCommand(doc, {
      type: 'REGISTER_SOURCE_ELEMENT',
      sourceKey: KEY,
      classes: FILE_BEFORE,
      sourceLocation: { file: CARD, line: 4, column: 1 },
    });
  });
  doc.transact(() => {
    applyCommand(doc, { type: 'UPDATE_SOURCE_CLASSES', sourceKey: KEY, classes });
  });
}

describe('local ↻ badge — scan-order guard rail', () => {
  afterEach(() => resetClassWriteBaselines());

  /**
   * The realistic lifecycle, then the thing that broke it: MORE SCANS.
   *
   * Every extra scan after the master moved reports one of exactly two values —
   * our own re-applied override (scanning.ts reapplySourceClassOverrides paints
   * it on every scan) or the moved file value again — and neither is new
   * information. The badge must give the same answer after 1, 3 and 5 scans.
   *
   * What makes that non-obvious: the moved-file scan takes the branch that
   * repairs a missing anchor from the PREVIOUS observation, which by then IS the
   * moved value. Only `noteSourceBaseValue`'s only-if-absent guard stops the
   * anchor from following the master, and the moment it does base === now and
   * the badge is dark forever. That is a one-line guard nothing else pins.
   */
  it('stays lit however many scans follow the master change', () => {
    const ctx = ctxWithIframe();
    const { doc } = ctx.env;

    // t0 — the page loads. Nothing is overridden yet, so this scan is the file
    // speaking, and it is the only thing that ever records the pre-edit value.
    handleElementsScanned(ctx, { elements: [scan(FILE_BEFORE)] });

    // t1 — the user styles this placement. An edit is not an outdated master.
    clickThenEdit(doc, OVERRIDE);
    expect(localMasterOutdated(doc, CARD, PLACEMENT)).toBe(false);

    // t2 — the override re-apply repaints; the next scan reports our own paint.
    handleElementsScanned(ctx, { elements: [scan(OVERRIDE)] });
    expect(localMasterOutdated(doc, CARD, PLACEMENT)).toBe(false);

    // t3 — the master file is edited on disk and HMR delivers it. The re-apply
    // shadows it on this placement, which is precisely what ↻ announces.
    handleElementsScanned(ctx, { elements: [scan(FILE_AFTER)] });
    expect(localMasterOutdated(doc, CARD, PLACEMENT)).toBe(true);

    // t4 — every further scan (surface switch, HMR re-delivery, an extra scan
    // someone adds to beat a blink) carries one of those same two values.
    for (const classes of [OVERRIDE, FILE_AFTER, OVERRIDE, FILE_AFTER]) {
      handleElementsScanned(ctx, { elements: [scan(classes)] });
      expect(localMasterOutdated(doc, CARD, PLACEMENT)).toBe(true);
    }
    // The anchor is what the file rendered before the edit — never the master.
    expect(sourceClassBaseValue(doc, KEY)).toBe(FILE_BEFORE);
  });

  /**
   * The surface-switch race, from the owner's report: the master write is
   * dispatched as the user switches surface, so the page frame reload can win
   * and serve PRE-WRITE bytes. Those bytes are the anchor value, so believing
   * them makes base === now and the badge goes dark on the trip that is supposed
   * to light it — indistinguishable from the master having been reverted.
   *
   * A dispatched write knows what the file is about to render; a scan only knows
   * what the frame happens to be showing. The scan may seed, never overwrite.
   */
  it('survives a scan that serves pre-write bytes after a dispatched master write', () => {
    const ctx = ctxWithIframe();
    const { doc } = ctx.env;

    handleElementsScanned(ctx, { elements: [scan(FILE_BEFORE)] });
    clickThenEdit(doc, OVERRIDE);

    // The master write is dispatched (component view → the user switches away).
    stampFileValueForLine(doc, 'sourceClasses', LINE, FILE_AFTER);
    expect(localMasterOutdated(doc, CARD, PLACEMENT)).toBe(true);

    // The page frame navigated first and loaded the pre-write bytes.
    handleElementsScanned(ctx, { elements: [scan(FILE_BEFORE)] });
    expect(localMasterOutdated(doc, CARD, PLACEMENT)).toBe(true);
    expect(sourceFileValue(doc, 'sourceClasses', KEY)).toBe(FILE_AFTER);
  });
});
