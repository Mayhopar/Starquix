# Runtime probe harness

Measures the editor on the real surface: an isolated, invisible Electron running the PRODUCTION editor bundle of this worktree, a real project
import, real key presses, a timeline recorder in the editor and in the canvas iframe, and the editor's own accept-lane marks (`app/src/utils/probeMark.ts`).
It produces the numbers the instant-edit gates judge ([design section 4.3](../../docs/plans/2026-11-17-instant-edit-design.md); how it was first used:
[R11](../../docs/plans/2026-11-16-instant-edit-research/R11-runtime-harness.md), [R12](../../docs/plans/2026-11-16-instant-edit-research/R12-probe-round-2.md)).

## Run a gate

```
cd desktop
node probe/gate.mjs smoke                       # 1-3 min: S1@90 once on tiny; proves the harness runs here
node probe/gate.mjs G-L2 --label after-p0a --fixtures <dir> --owner-copy <dir>
node probe/gate.mjs G-0 --dry-run               # prints the plan (bundle hash, fixtures, run2 argv), builds and launches nothing
```

Needs `npm ci` in `desktop/` and `npm run deps --prefix desktop` (the Astro runtime the app boots), macOS (`lsappinfo`, the accessory activation policy),
`python3` + PIL only for generating fixtures. A gate then: builds the production bundle into `<tmp>/sqprobe-bundles/<hash>` (hash of `app/src` without tests,
`index.html`, `package.json`, `vite.config.ts`, the snapshot and the root lock; rebuilt only when it changes), serves it on a free loopback
port as `http://localhost:<port>` (the editor and the canvas on `127.0.0.1:<port>` are two sites = two renderer processes, like the packaged `starquix://app`),
builds missing fixtures, waits until the 1-minute load average is <= 13 (up to `--loadwait`, 180 s), runs `run2.mjs` once per fixture, prints the metric vector
(JSON, stdout) and a pass/fail table against `gates.json`, writes `<out>/metrics.json` + `report.txt`, and kills its server and engine at exit.
Load is recorded before, after the wait and at the end, and per run in the raw JSONs.

| Gate | Cells | Answers |
|---|---|---|
| `smoke` | S1@90 x1 on tiny | does the harness work here: final value on canvas and in the file, every key painted, the editor marks live |
| `G-0` | S1@90 x3 + S3@33 x1 on tiny, big, bigpage, owner at journal depth 1 / 100 / 220 | the baseline of the code before P0a; reproduces R12 within 20% (slope, J=1 service, key-to-paint, 6 scans per edit) |
| `G-L1` | same cells | structural: scans, receipt gets, whole-file reads per edit, layout-plan POSTs, card-source triggers |
| `G-L2` | same cells | time: lane service slope and p95 at depth, lost increments (load <= 13) |
| `scenarios` | S7, S7b, S8, S10, S12, S13, S13H once on tiny, big, comp2 | the harness smoke of the P-1b scenarios: every run completes, the canvas class log (`cc`) is recorded, the CPU throttle reached both targets |
| `G-T3` | the design 4.3 list: S1@40,90,150 x3; S2, S2O, S6, S7, S7b, S8 @90 x3; S3@33 x2; S4@20,60 x2 on tiny (no S4), big, huge, bigpage, owner; S1, S2 @90 x2 on comp2, compbig (80+ runs, a fresh import each, slow) | no late class change on any element, class level and visible-frame level; wrong-value dwell; overlay jumps; painted == typed == disk. REPORT-ONLY until P0b: every check names its target (0) and has no threshold |
| `V2` | S1@90 x6 plain and x6 under CPU throttle x4 (S13) on compbig | the V2 writer probe: [verdict and log](../../docs/plans/2026-11-17-instant-edit-gates/V2-writer-probe.md), see "V2 writer probe" below |
| `G-T1a`, `G-T1b`, `G-D` | | placeholders: exit 2 "not implemented yet" |

Every gate also checks that all planned runs completed and that no run mentioned the owner's relay (`:47821`) or dev editor (`:3061`).
G-0 does not yet cover the persistent-profile relaunch (listed as a `TODO` row; a later P-1 chunk); its V2 writer probe is the `V2` gate.
A gate whose `run2` in `gates.json` is a list runs the entry that names the fixture (G-T3: tiny has two images, so no 4-image burst); `metrics: "scenario"` groups the cells by `<scenario>@<param>` instead of journal depth;
a check with `scn: [...]` judges only the cells of those scenarios; `target` beside a `null` threshold is what the check will gate once its slice lands (printed as `target <= 0`).
Exit codes: 0 pass | 1 a check missed or had no data | 2 not built yet | 3 usage or harness error | 4 incomplete (a fixture skipped, or time checks on a machine that never settled).
A threshold of `null` in `gates.json` is report-only; a threshold map (`owner`, `bigpage`, `big`) gates only the named fixtures; `kind: time` checks are invalid above the load gate.

Flags: `--label` (names the run and the output dir), `--out` (default `results/<gate>-<stamp>`), `--fixtures` (default `<tmp>/sqprobe-fixtures`), `--owner-copy`,
`--owner-page` (default `src/pages/index.astro`), `--bundle-cache`, `--loadwait <ms>`, `--only fixture,...` (run and judge just those fixtures of the gate: a quick real pass of a slow one, e.g. `node probe/gate.mjs G-T3 --only compbig`), `--dry-run`.
`run2.mjs` flags the scenarios use (gates pass them): `--fresh 1` (a fresh import per run), `--overlay 1` (sample the selection box against the image: overlay jumps), `--rows 1` (journal row kinds into the run),
`--replaycapture 1` (keep capturing until the journal is drained, so the 5 s deferred replay and its canvas refreshes are inside the capture), `--undofocus blur|field` (S7/S7b: where the focus is at Cmd-Z),
`--delay <ms>` (typing cadence of S12), `--throttle <rate>` (S13, default 4), `--img1/--img2/--text/--text2/--zoomfit/--layers` (which images, what is typed). A plan item is `<NAME>@<param>*<reps>`, a name is `S1`, `S7b`, `S13H`, `CELL`.

## Fixtures

`tiny` (1 page, 2 images), `big` (6 pages), `huge` (40 pages), `bigpage` (one 688-line page), `comp`, `comp2`, `compbig` (images inside local components) are generated into
the fixtures dir when missing (`make-fixtures.mjs`, `make-comp-fixture.mjs`, `make-compbig-fixture.mjs`; an existing fixture is never touched).
`owner` is a copy of the owner's real project: private, never generated, never committed, never copied into the repo. It is used as found in `<fixtures>/owner`;
if absent and `--owner-copy <dir>` is given it is prepared from that copy (`prep-owner-copy.mjs`: rsync without `node_modules`, then the first 10 `<img>` of
`--owner-page` get `alt="Probe image N"`). Without either, the owner cells are skipped and the gate is `incomplete`.

## Isolation

The app runs with its own `SQ_USER_DATA`, `SQ_PROJECTS_ROOT`, `SQ_DOWNLOADS`, `STARQUIX_MCP_HOME` under a temp dir and a relay identity (`daemon.json`, 0600) on a free port,
so it never touches `~/Starquix`, `~/.starquix-mcp`, the owner's running app, the `:3061` dev editor or the `:47821` relay. `driver.mjs` `assertIsolated` refuses a launch that could,
and `desktop/test/probe-harness.test.mjs` proves it (including that the real MCP host adopts the pre-written identity). The window never takes focus: `SQ_PROBE_INVISIBLE=1`
(macOS accessory policy, window `show:false`, opacity 0, not focusable, click-through) and `SQ_DEV_EDITOR_LOCALHOST=1` (accept `http://localhost:<port>` as the dev editor; unpackaged only)
live in `desktop/src/probe-mode.mjs` and `editor.mjs`; both change nothing when unset. `results/` is gitignored: raw runs are MBs each and are never committed.

## Files

| File | Job |
|---|---|
| `gate.mjs`, `gates.json` | the gate CLI and the thresholds of design 4.3 |
| `bundle.mjs`, `fixtures.mjs` | bundle build + cache + static server; fixture resolution |
| `metrics.mjs`, `checks.mjs` | run JSONs to the metric vector (journal-depth cells, scenario cells); vector + gate to rows, verdict, table |
| `driver.mjs` | isolated invisible Electron, import and select helpers |
| `recorder.mjs` | in-page timeline recorder (editor + canvas iframe); defines `window.__sqProbeMark`; the canvas side logs the class attribute of ANY element (`cc`) |
| `run2.mjs` | the scenario engine: S1-S8, S10, S12, S13, S13H, S2O, aged-journal `CELL@J`, `GROW`, `REOPEN`, `DRAIN`; `run.mjs` is round 1 (S1-S6) |
| `analyze.mjs` | one run to its analysis (key-to-paint, accept phases, late changes, replay, IPC...) |
| `t3.mjs` | the T3 class-timeline analysis (pure): final value, late changes at class and visible level, dwell, collateral |
| `v2probe.mjs` | the V2 writer probe analysis (pure + CLI `node probe/v2probe.mjs <dir of run JSONs>`): symptoms, mechanism, writer, verdict, log excerpt |
| `aggregate.mjs`, `aged-agg.mjs` | markdown tables over raw runs; the lane-service fit |
| `session.mjs` | long-lived session with a token-guarded eval endpoint (`POST /eval`, header `x-token`, state file) |
| `make-*.mjs`, `prep-owner-copy.mjs` | fixtures |

Not built yet (later P-1 chunks): S9 (kill and relaunch on the same profile), S11 (injected failure), S14 (Cmd-Q), the persistent-profile relaunch (`--keep-profile`), the CDP quota hook.

## Scenarios

| Scenario | What the harness does (param = ms per key unless noted) | What is recorded / expected |
|---|---|---|
| S1 | type `300` into the W of a Fill image | key-to-paint, lane service, late class changes |
| S2, S2O | S1, then image 2 within 300 ms (S2O: plus an outside append to the page file at +1 s and +3 s) | image 1 after the click; the outside writer's regress |
| S3 | hold ArrowUp 2 s at 33 ms repeat (param = repeat ms) | lost increments, backlog after release |
| S4 | 12 rapid edits over images 1, 2, 5, 6 | the 36-row replay; wrong-value dwell |
| S5, S6 | S5: Fit/Fill clicks on a background-image frame; S6: S1, then Fit on image 2 | click-to-paint; a flush boundary on another image |
| **S7** | S1, then Cmd-Z 1 s after the last digit (`--undofocus blur`: the focus leaves the field first, because the editor's shortcut handler ignores inputs; `field`: Cmd-Z with the focus in W = native text undo today) | `A.undo`: the undo painted? ms; class changes after the press that are NOT the undo value; end state == pre-edit class. Today a typed number is 3 undo steps, so one Cmd-Z never reaches the pre-edit class: `endIsPreEdit: false` is the baseline (P2 makes it one step) |
| **S7b** | three single-key class edits inside the 5 s window: image 1 `3` (a first edit of that element: the overlay-restore undo path), image 1 `5`, image 2 `7` (also a first edit), then Cmd-Z x3 at +1 s. Odd digits on purpose: the size field maps 2 to `w-0.5` and 4 to `w-1` (Tailwind scale), 3, 5, 7 stay arbitrary `w-[Npx]` values the undo targets can name | per undo: painted, class changes that are not its target (image 2 pre-edit, image 1 back to `w-[3px]`, image 1 pre-edit); `endIsPreEdit` per image (the last state the canvas really ended on) |
| **S8** | revisit: image 1: `3`, `30`, Backspace to `3`; image 2: three gestures `100`, `150`, `100`, each typed value + Enter, 300 ms apart | every canvas class value over time (`A.t3.elements[].timeline`); late changes after the last value |
| **S10** | V2 (component ROOT, `<Photo>` usage: type 300 into the instance img) then V3 (INNER element of a component, `<Card>`: type 200) from the page, S2's cadence; images picked by the component tag of their alt-tagged usage, else `--img1/--img2` | lane service, key-to-paint, late changes, `A.rows` = the journal row kinds (V2/V3 rows are `file-batch` with no deferral, V1 rows are deferred `class-write`) |
| **S12** | type into image A, select image B, open its image-fill popover, click Fit on B at `param` ms after A's last key (default 5300: A's deferred rows replay at +5.0..6.5 s). A and B are plain `<img>` (V1: deferred class rows): `--img1/--img2` when they are, else the first plain images of the page (comp2: 5 and 6) | A's and B's class timelines; late changes on both |
| **S13**, **S13H** | S1 / S3 with `Emulation.setCPUThrottlingRate` x4 on BOTH CDP targets: the editor renderer (`page`) and the canvas iframe (`context.newCDPSession(frame)`, its own target) | `run.throttle`: per target the measured busy-loop slowdown before/after (`ok` = ratio >= rate / 2): both targets are proven throttled, not assumed |

S7/S7b start from a fresh editor session (a reopen when the project is reused), so the first edits are first edits. New scenarios capture through the replay (`finish(o, true)`).

## T3: late class changes

The canvas recorder (`recorder.mjs`) logs every class-attribute mutation of every element (`cc`: element id, probe image number or DOM id, old and new value; the value of a record is chained through its mutation batch,
because `getAttribute` at callback time would show the last value for every record of a batch). `t3.mjs` turns that into, per element: the states its class went through, the FINAL value (the state it ended on; for a typed or held element the last
state that carries the expected `w-[Npx]` token, so a capture that ends on a stale class still counts it), the first arrival of that value at or after the element's last input, and everything after:
**class level** = every string change after it (a reordered equal class counts: `planAttrPatch` compares strings; a `sq-ai-*` flash class counts as an `other` change, not a wrong value); token sets decide only whether a state IS the final value;
**visible-frame level** = the late wrong states a frame tick stood on (frame times only; rects are never read, so a user CSS `transition` cannot fake a late change). **Dwell** = ms on a wrong value after the final value.
An element the scenario never touched whose class changes is **collateral**. **Overlay jumps** = selection-box width steps after the box first showed the final width (needs `--overlay 1`).
Validation: over the 120 usable R11 raw runs (the `cls` log of runs recorded before `cc` existed is the fallback) the class-level incidence per cell reproduces DV2's table exactly: 23 runs with a late stale class
(small pages S1 6/23, S2 2/22, S3 3/10, S4@20 1/9, S4@60 4/13, S6 0/9, S5 0/6; 688-line page S1 1/6, S2 0/3, S3 2/2, S4@60 4/4; dev editor 0/10) and 12 visible (DV2: 9 plus 3 S3 runs it did not rate).

## The editor marks

`pm(name, data)` calls (`acc:*` accept lane, `sc:*` and `ps:*` journal scans and receipt reads, `pci:*`, `mat:*` materializer, `cls:set`, `lf` every `/__sq/local` call) are one-liners
that do nothing unless the recorder defined `globalThis.__sqProbeMark`; lazy data is a function so nothing is computed otherwise. `desktop/test/probe-harness.test.mjs`
fails if a mark the analysis reads loses its call site, and the app tests pin the `acc:*`, `lf` and `v2:*` contracts.
The V2 writer probe adds: `cls:set` (with `op`, the operation tail the durable-edit transaction origin ends with) and `cls:accepted` (the class the live doc holds when the acceptance resolves), `v2:write` (every class write the
observer sees on the live `sourceClasses` doc: transaction origin, old and new value), `v2:csv` + `v2:sync` (the value SYNC_CLASSES_TO_IFRAME carries and the branch of `currentSourceClassValue` that produced it: carrier, scan-stale-owner, entry,
scan-fallback), `v2:seed` (a scan seeding a file-backed override), `v2:reg` (registerElement writing an entry).

## V2 writer probe

Question (design 3.1): why does a component-ROOT (V2) edit sometimes post an OLDER class to the canvas (R12 3.3: the third SYNC of a typed `300` carried `3px`)? Candidate 1, the **stale scan**: the observer's SYNC value is
`currentSourceClassValue(...)`, which returns the latest SCAN class when the entry owner's `sourceVersion` differs from the scan's. Candidate 2, the **client-id overwrite**: another writer's `Y.Map` set of the same entry class races the staged update and wins by client id
(the P-1b task text numbers the two the other way round; the design's own numbers are used here).
The marks (`cls:set`, `v2:write`, `v2:csv`, `v2:sync`, `v2:seed`, `v2:reg`, `cls:accepted`, plus the canvas's `ELEMENTS_SCANNED`) log every class write on the live doc with its origin, the value SYNC carried and the branch that produced it; `v2probe.mjs` pairs them per edit.

**Verdict (compbig, 12 runs, 36 edits; `node probe/gate.mjs V2`): the stale scan is real; the client-id overwrite was not observed.**
- 3 of 6 runs under CPU throttle x4 (0 of 6 plain: in this topology edit 3's lane window closes before the first scan) posted `w-[3px]` for the `300` edit, through branch `scan-stale-owner`, while the live doc held `w-[300px]`; in each of the 3, a scan landed INSIDE edit 3's lane window,
  in none of the other 9 runs did one, and those 9 posted the right class.
- All 36 live-doc class writes had a `durable-edit:` origin: no scan seed, no `registerElement`, no other writer ever wrote the class; the doc equalled the typed class after every apply and acceptance.
- Excerpt (first throttled run; the scan lands at +886 ms inside edit 3's window, apply at +1035 ms): `msg:ELEMENTS_SCANNED` -> `v2:write ... now: rounded w-[300px]` -> `v2:csv {"b":"scan-stale-owner"}` ->
  `v2:sync {"v":"rounded w-[3px]","e":"rounded w-[300px]","s":"rounded w-[3px]","sv":"seb2ffc1e:","ov":"s50a8f81a:"}` -> `cls:accepted ... doc: rounded w-[300px]`.
Full table, excerpt, caveats and the reading for P0b/P1: [docs/plans/2026-11-17-instant-edit-gates/V2-writer-probe.md](../../docs/plans/2026-11-17-instant-edit-gates/V2-writer-probe.md). Rerun: `node probe/gate.mjs V2 --fixtures <dir>`, or `node probe/v2probe.mjs <dir of run JSONs>` for any set of runs.

## Reading the numbers

Gates run on the production bundle at load <= 13: the dev editor is 3-5x slower (R11). The editor on `localhost` puts the canvas in its own renderer process; R11/R12 ran same-site
(one process), so lane service reproduces but canvas-frame metrics may differ a little. `G-0` is the baseline of the code before P0a: after P0a, G-L1/G-L2 are the judges.
