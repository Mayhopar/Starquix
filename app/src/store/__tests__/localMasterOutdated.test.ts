/**
 * task-184 — local mode's ↻ ("the master moved past your edit and you are not
 * receiving it").
 *
 * Measured live before this existed: a `.astro` component file was edited on
 * disk, HMR delivered `card px-8 py-6` into the frame, and the scan re-apply
 * (Canvas/viewportMessages/scanning.ts) immediately repainted the stored
 * override `card px-4 py-2 bg-red-500` over it. The un-overridden sibling
 * placement took the change; the overridden one silently did not, and the
 * DesignBar showed no ↻ in any state.
 *
 * The axis is WC's, one tier down (store/masters.ts `masterBaseRev`): a base
 * stamped at override-write time vs the master's value now. These guard both
 * halves — the stamp, and the comparison that must never fire on a placement
 * whose master has NOT moved.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';

vi.mock('@/services/ViteClassWriter', () => ({ viteClassWriter: { writeClassUpdate: vi.fn() } }));
vi.mock('@/services/ViteTextWriter', () => ({ viteTextWriter: { writeTextUpdate: vi.fn() } }));
vi.mock('@/services/ViteImageWriter', () => ({ viteImageWriter: { writeImageUpdate: vi.fn() } }));

const { applyCommand } = await import('../commands');
const { localMasterOutdated, hasLocalMasterOverrides } = await import('../localMasterOverrides');
const {
  sourceClassBaseValue,
  sourceBaseValue,
  stampFileValueForLine,
  noteSourceFileValue,
} = await import('../sourceOverrideEntries');
const {
  setClassWriteBaseline,
  setFileValue,
  noteClassWriteBaseline,
  noteFileValue,
  getObservedFileValue,
  observeScannedValue,
  pendingWriteValue,
  resetClassWriteBaselines,
} = await import('@/services/classWriteBaseline');

const CARD = 'src/components/Card.astro';
/** Placement A of <Card /> on `/` — the live hash from the reproduction. */
const A = 's4db83f82b016cfb0';
const KEY_A = `${CARD}:4:1~${A}`;
/** The second <Card /> on the same route — must stay silent. */
const B = 'sd4ed868355ff2d31';
const KEY_B = `${CARD}:4:1~${B}`;
/** The `<p>` inside placement A — a TEXT-only override (unit B). */
const TEXT_KEY_A = `${CARD}:6:3~${A}`;

const FILE_BEFORE = 'card px-4 py-2';
const OVERRIDE = 'card px-4 py-2 bg-red-500';
const FILE_AFTER = 'card px-8 py-6';

/** The real gesture order: canvas click registers, then the user styles it. */
function clickThenEdit(doc: Y.Doc, key: string, fileValue: string, edited: string): void {
  doc.transact(() => {
    applyCommand(doc, {
      type: 'REGISTER_SOURCE_ELEMENT',
      sourceKey: key,
      classes: fileValue,
      sourceLocation: { file: CARD, line: 4, column: 1 },
    });
  });
  doc.transact(() => {
    applyCommand(doc, { type: 'UPDATE_SOURCE_CLASSES', sourceKey: key, classes: edited });
  });
}

describe('task-184 local ↻', () => {
  beforeEach(() => {
    resetClassWriteBaselines();
    localStorage.clear();
  });

  it('stamps the pre-edit file value on the override entry', () => {
    const doc = new Y.Doc();
    clickThenEdit(doc, KEY_A, FILE_BEFORE, OVERRIDE);
    expect(sourceClassBaseValue(doc, KEY_A)).toBe(FILE_BEFORE);
  });

  it('a SECOND edit does not re-base the anchor onto the first edit', () => {
    const doc = new Y.Doc();
    clickThenEdit(doc, KEY_A, FILE_BEFORE, OVERRIDE);
    doc.transact(() => {
      applyCommand(doc, {
        type: 'UPDATE_SOURCE_CLASSES', sourceKey: KEY_A, classes: `${OVERRIDE} italic`,
      });
    });
    expect(sourceClassBaseValue(doc, KEY_A)).toBe(FILE_BEFORE);
  });

  it('fires when the master file moved past the override', () => {
    const doc = new Y.Doc();
    clickThenEdit(doc, KEY_A, FILE_BEFORE, OVERRIDE);
    setClassWriteBaseline(KEY_A, FILE_BEFORE);
    expect(localMasterOutdated(doc, CARD, A)).toBe(false);

    // HMR delivers the edited master; the scan records what the FILE renders.
    setClassWriteBaseline(KEY_A, FILE_AFTER);
    expect(localMasterOutdated(doc, CARD, A)).toBe(true);
  });

  it('stays silent on a placement that carries no override', () => {
    const doc = new Y.Doc();
    clickThenEdit(doc, KEY_A, FILE_BEFORE, OVERRIDE);
    setClassWriteBaseline(KEY_A, FILE_AFTER);
    setClassWriteBaseline(KEY_B, FILE_AFTER);
    expect(localMasterOutdated(doc, CARD, B)).toBe(false);
  });

  /**
   * Measured live on the local rig (rig-owner, `local_1tng7gv`): select the
   * placement root in the LAYERS PANEL, Classes tab → Apply. The persisted
   * payload came back `{"classes":"card px-4 py-2 bg-red-500"}` — no anchor.
   * ClassStoreContext's `originalClasses` is `stateRef[key] ?? ''`, and that
   * tier is only pre-populated by the canvas-CLICK path, so no
   * REGISTER_SOURCE_ELEMENT preceded the edit and UPDATE_SOURCE_CLASSES took
   * its `else` branch, which stamped nothing.
   *
   * The scan is the only other thing that knows what the FILE renders, and it
   * already put it in `classWriteBaseline` — the same value the `if (yEntry)`
   * branch reads off the registration. Reuse it; do not invent a second one.
   */
  it('anchors an edit that no registration preceded (Layers-panel selection)', () => {
    const doc = new Y.Doc();
    // The scan recorded what the file renders. No canvas click, so no
    // REGISTER_SOURCE_ELEMENT and no sourceClasses entry.
    setClassWriteBaseline(KEY_A, FILE_BEFORE);
    doc.transact(() => {
      applyCommand(doc, { type: 'UPDATE_SOURCE_CLASSES', sourceKey: KEY_A, classes: OVERRIDE });
    });
    expect(sourceClassBaseValue(doc, KEY_A)).toBe(FILE_BEFORE);

    // The master then moves; ↻ must light on the shadowing placement.
    setClassWriteBaseline(KEY_A, FILE_AFTER);
    expect(localMasterOutdated(doc, CARD, A)).toBe(true);
  });

  it('stays silent when the anchor is unknown (pre-task-184 entry)', () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      const e = new Y.Map();
      e.set('classes', OVERRIDE);
      e.set('edited', true);
      doc.getMap('sourceClasses').set(KEY_A, e);
    });
    setClassWriteBaseline(KEY_A, FILE_AFTER);
    expect(localMasterOutdated(doc, CARD, A)).toBe(false);
  });

  /**
   * unit B — the gate itself must not care WHICH tier the override lives in.
   * Before this it early-returned on `kind !== 'classes'`, so a text-only edit
   * could never light ↻ however far the master moved (measured live on rig
   * `local_63cmon`: verdict=false with kinds=["text:…"] while the canvas showed
   * the pre-edit copy on the overridden placement and the new one beside it).
   */
  it('fires for a TEXT-only override when the master moved past it', () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      const e = new Y.Map();
      e.set('textContent', 'OVERRIDDEN body copy');
      e.set('baseText', 'Some body copy that nobody reads.');
      doc.getMap('sourceText').set(TEXT_KEY_A, e);
    });
    setFileValue('text', TEXT_KEY_A, 'Some body copy that nobody reads.');
    expect(localMasterOutdated(doc, CARD, A)).toBe(false);

    setFileValue('text', TEXT_KEY_A, 'MASTER MOVED body copy');
    expect(localMasterOutdated(doc, CARD, A)).toBe(true);
  });

  /**
   * The case the scan-side repair CANNOT cover, measured live on rig
   * `local_63cmon`: a real canvas text edit changes no structure, so no scan
   * fires between the edit and the master moving. The first scan to see the
   * key already carries the MOVED text, and repairing from it anchors
   * `baseText` to the value ↻ is supposed to be compared against — persisted
   * as {"textContent":"OVERRIDDEN body copy","baseText":"MASTER MOVED body
   * copy"}, base === now, badge dark. The anchor has to be stamped at
   * write time off the scan's pre-edit value, exactly like baseClasses.
   */
  it('anchors a text edit at write time, from what the scan saw the file render', () => {
    const doc = new Y.Doc();
    setFileValue('text', TEXT_KEY_A, 'Some body copy that nobody reads.');
    doc.transact(() => {
      applyCommand(doc, {
        type: 'UPDATE_SOURCE_TEXT', sourceKey: TEXT_KEY_A, textContent: 'OVERRIDDEN body copy',
      });
    });
    expect(sourceBaseValue(doc, 'sourceText', 'baseText', TEXT_KEY_A))
      .toBe('Some body copy that nobody reads.');

    // A second edit must not re-base the anchor onto the first edit.
    doc.transact(() => {
      applyCommand(doc, {
        type: 'UPDATE_SOURCE_TEXT', sourceKey: TEXT_KEY_A, textContent: 'OVERRIDDEN twice',
      });
    });
    expect(sourceBaseValue(doc, 'sourceText', 'baseText', TEXT_KEY_A))
      .toBe('Some body copy that nobody reads.');

    // Only now does the master move — and ↻ must light.
    setFileValue('text', TEXT_KEY_A, 'MASTER MOVED body copy');
    expect(localMasterOutdated(doc, CARD, A)).toBe(true);
  });

  it('stays silent for a TEXT override whose anchor is unknown', () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      const e = new Y.Map();
      e.set('textContent', 'OVERRIDDEN body copy');
      doc.getMap('sourceText').set(TEXT_KEY_A, e);
    });
    setFileValue('text', TEXT_KEY_A, 'MASTER MOVED body copy');
    expect(localMasterOutdated(doc, CARD, A)).toBe(false);
  });

  /**
   * REGRESSION (owner-reported 2026-08-05, screenshot): ↻ lit on a placement
   * whose master had NOT moved. Cause: the gate read `getFileValue`, which
   * returns GUESSED cells too, and ClassStoreContext seeds a restored overlay
   * key from the OVERRIDE value at boot. So on every reload with an override
   * present, `now` was the override, `base` was the pre-edit file value, they
   * differed, and ↻ lit forever. A false ↻ invites the user to discard their
   * own work — the gate needs an OBSERVED file value, same proof bar
   * `isEditedSourceClassEntry` already demands.
   */
  /**
   * Owner-reported 2026-08-05 ("still need to go to assets twice"): the file
   * value was keyed per PLACEMENT, but a master write records it under the
   * placement-free key. So `setClassWriteBaseline` after a successful master
   * write updated `classes <file>:6:1` while the gate read
   * `classes <file>:6:1~<placement>` — a different cell — and ↻ stayed dark
   * until a later scan happened to observe the moved file. The file renders ONE
   * value for one source line; placements cannot disagree about it.
   */
  it('a master write updates the file value for every placement of that line', () => {
    const doc = new Y.Doc();
    clickThenEdit(doc, KEY_A, FILE_BEFORE, OVERRIDE);
    // The master write landed: persistClassToFile records it under the
    // placement-FREE key, which is all the writer ever knows.
    setClassWriteBaseline(`${CARD}:4:1`, FILE_AFTER);
    expect(localMasterOutdated(doc, CARD, A)).toBe(true);
  });

  /**
   * Owner-reported 2026-08-05, third round ("still need to go to Assets
   * twice"), captured verbatim in the scan probe:
   *
   *   scan AGREES  key=…:6:1
   *     scanned(now)   = bg-neutral-300   <- the file's NEW value
   *     override       = bg-neutral-300
   *     observedBefore = bg-white
   *     action = note only-if-absent (FROZEN - file value cannot update here)
   *
   * A master edit writes the file AND leaves the doc override equal to it, so
   * the post-reload scan takes the `override === now` branch, finds a previous
   * observation, and DISCARDS the file's new value. The gate then compares the
   * stale value against the anchor and stays dark until a later disagreeing
   * scan re-observes - the second trip.
   *
   * The fresh DOM after an iframe reload has had nothing re-applied to it, so
   * its first scan of every key is the file speaking and must be allowed to
   * observe. handleIframeReady drops the observed marks for exactly that.
   */
  it('an agreeing scan records the file value when nothing is pending', () => {
    const doc = new Y.Doc();
    clickThenEdit(doc, KEY_A, FILE_BEFORE, OVERRIDE);
    setFileValue('classes', KEY_A, FILE_BEFORE);

    // No dispatched write outstanding: the scan is the only source of truth and
    // is believed immediately, even when it agrees with the override.
    expect(observeScannedValue('classes', KEY_A, FILE_AFTER)).toBe('recorded');
    setFileValue('classes', KEY_A, FILE_AFTER);
    expect(getObservedFileValue('classes', KEY_A)).toBe(FILE_AFTER);
    expect(localMasterOutdated(doc, CARD, A)).toBe(true);
  });

  /**
   * Owner-reported 2026-08-05, final round: "went to Assets a few times before
   * it appeared". The gate's "now" half lived only in the classWriteBaseline
   * module singleton, which every iframe reload destroys — and one master write
   * produced FIVE bridge reloads. Whether the badge showed depended on a scan
   * landing between two reloads and surviving until the badge was read.
   *
   * The scan now persists the file value on the entry (noteSourceFileValue, from
   * the branch where the scan disagrees with the override, so it cannot be our
   * own re-apply). The gate compares two DURABLE values: no timing, no reload
   * sensitivity.
   */
  it('lights from the persisted file value alone — no in-memory baseline at all', () => {
    const doc = new Y.Doc();
    clickThenEdit(doc, KEY_A, FILE_BEFORE, OVERRIDE);
    // The scan saw the master move and persisted it on the entry.
    noteSourceFileValue(doc, 'sourceClasses', KEY_A, FILE_AFTER);
    // Every reload-destroyed in-memory state is gone; the gate must not care.
    resetClassWriteBaselines();
    expect(localMasterOutdated(doc, CARD, A)).toBe(true);
  });

  /**
   * THE user-visible contract, stated without any scan in the loop:
   * change the master, come back, and an overridden placement shows the badge.
   *
   * A landed write is the only unambiguous statement of what the file renders —
   * nothing can have re-applied over it yet — and it names the source line. So
   * it stamps every placement of that line directly. Deriving this from a later
   * DOM scan is what made it depend on which of the five bridge reloads after
   * one master write a scan landed between ("go to Assets a few times").
   */
  it('a landed master write lights every overridden placement immediately', () => {
    const doc = new Y.Doc();
    clickThenEdit(doc, KEY_A, FILE_BEFORE, OVERRIDE);          // placement A: overridden
    clickThenEdit(doc, KEY_B, FILE_BEFORE, FILE_BEFORE);       // placement B: no edit
    resetClassWriteBaselines();                                // no in-memory state at all

    // The master edit lands in the file. The writer knows only the line.
    stampFileValueForLine(doc, 'sourceClasses', `${CARD}:4:1`, FILE_AFTER);

    expect(localMasterOutdated(doc, CARD, A)).toBe(true);   // overridden -> badge
    expect(localMasterOutdated(doc, CARD, B)).toBe(false);  // not overridden -> silent
  });

  /**
   * Measured 2026-08-05, the last failure in this chain: the dispatched write
   * stamped the correct new value on both keys, then the page scan — which ran
   * before HMR had delivered the new markup — read the PREVIOUS bytes off the
   * DOM and overwrote it. base === fileNow again, badge dark, every trip.
   *
   * A dispatched write knows what the file is about to hold; a scan only knows
   * what the frame happens to be showing. The scan may seed, never overwrite.
   */
  it('a stale scan cannot overwrite the value a dispatched write recorded', () => {
    const doc = new Y.Doc();
    clickThenEdit(doc, KEY_A, FILE_BEFORE, OVERRIDE);
    resetClassWriteBaselines();

    stampFileValueForLine(doc, 'sourceClasses', `${CARD}:4:1`, FILE_AFTER);
    expect(localMasterOutdated(doc, CARD, A)).toBe(true);

    // The scan lands before HMR: it still sees the PRE-write bytes, and the
    // guard tells the caller not to believe them.
    expect(observeScannedValue('classes', KEY_A, FILE_BEFORE)).toBe('stale');

    expect(localMasterOutdated(doc, CARD, A)).toBe(true); // must survive
  });

  /**
   * Measured 2026-08-06 (owner log): after clicking ↻ the instance override was
   * correctly gone, but the MASTER's own bare-key entry survived and lit the
   * badge in the component view —
   *   GATE src/components/Header.astro:6:1 base=…green-50 fileNow=…stone-400 -> LIGHT
   * `isEditedSourceClassEntry` only consulted the IN-MEMORY file value, which
   * the reloads a write triggers had already wiped, so an entry holding exactly
   * what the file renders still counted as an edit.
   */
  it('an entry holding what the file renders is inert, using the PERSISTED value', () => {
    const doc = new Y.Doc();
    clickThenEdit(doc, KEY_A, FILE_BEFORE, OVERRIDE);
    resetClassWriteBaselines();                    // reloads wiped memory
    expect(localMasterOutdated(doc, CARD, A)).toBe(false); // nothing observed yet

    // The file is written to exactly what the override holds.
    stampFileValueForLine(doc, 'sourceClasses', `${CARD}:4:1`, OVERRIDE);
    resetClassWriteBaselines();                    // and memory wiped again

    // The entry is now a no-op: not an edit, so no `*` and no badge.
    expect(hasLocalMasterOverrides(doc, CARD, A)).toBe(false);
    expect(localMasterOutdated(doc, CARD, A)).toBe(false);
  });

  /**
   * The frame can serve bytes older than a write we already dispatched — that is
   * "changed the master, came back, no update". A scan that reports stale bytes
   * nudges exactly one reload per dispatched value, never a loop.
   */
  it('reports a stale frame, and clears once the dispatched value arrives', () => {
    const doc = new Y.Doc();
    clickThenEdit(doc, KEY_A, FILE_BEFORE, OVERRIDE);
    stampFileValueForLine(doc, 'sourceClasses', `${CARD}:4:1`, FILE_AFTER);

    // The frame is still serving pre-write bytes.
    expect(observeScannedValue('classes', KEY_A, FILE_BEFORE)).toBe('stale');
    // …and the value to paint over them is known, so nothing has to reload.
    expect(pendingWriteValue('classes', KEY_A)).toBe(FILE_AFTER);

    // HMR delivers it: scans are trusted again and nothing is pending.
    expect(observeScannedValue('classes', KEY_A, FILE_AFTER)).toBe('arrived');
    expect(pendingWriteValue('classes', KEY_A)).toBeUndefined();
  });

  /**
   * Owner-reported 2026-08-06: "when I update the master and the instance has
   * NO override, the instance must update when I go to Design — instead it
   * stays the same, and I have to go back to master and back."
   *
   * The stale-frame state used to be keyed by override ENTRY, so an element
   * with no override had nothing to hang it on: no entry, no pending, no nudge,
   * and the frame kept serving the pre-write bytes until another navigation.
   * It is keyed by SOURCE LINE now, which exists whether or not anyone has
   * overridden that element.
   */
  it('detects a stale frame for an element that has NO override at all', () => {
    const doc = new Y.Doc();               // deliberately empty: no entries
    const UNOVERRIDDEN = `${CARD}:4:1~snoOverride`;

    stampFileValueForLine(doc, 'sourceClasses', `${CARD}:4:1`, FILE_AFTER);

    // The frame is still serving the pre-write bytes for that element, and the
    // value to paint is known even though nothing in the doc mentions the key.
    expect(observeScannedValue('classes', UNOVERRIDDEN, FILE_BEFORE)).toBe('stale');
    expect(pendingWriteValue('classes', UNOVERRIDDEN)).toBe(FILE_AFTER);

    // HMR lands: the frame is trusted again.
    expect(observeScannedValue('classes', UNOVERRIDDEN, FILE_AFTER)).toBe('arrived');
    expect(pendingWriteValue('classes', UNOVERRIDDEN)).toBeUndefined();
  });
});
