# Instance overrides (files-truth projects): what broke in the blog session, and the architecture to replace it

Investigation 2026-11-23 → 24, branch `investigate/loop-instance-overrides` (worktree `.worktrees/loop-instance-overrides`,
base `main` @ `5ee6ccc` = the installed v0.0.2 editor code). Read-only: no production code changed.
Every load-bearing claim is **CONFIRMED** (file:line, a command, a decoded record) or **INFERRED** (+ what would confirm it).
Times are UTC (the user's clock = UTC+1). "rev N" = row N of the project's durable journal (IndexedDB), decoded.
Method: snapshot of both LevelDB stores + session log + project files (22:44Z); 12 subsystem reports; 4 adversarial
verifiers; a completeness critic; 3 design judges (all local, gitignored, in `tmp/investigation/`).

## 1. TLDR

1. **A loop is not one instance today.** With 4 posts, one `<BlogCard>` tag renders 4 copies; the editor then refuses to write card edits as page props and keeps them **editor-only, per copy**. 0 of 17 card edits after 20:30:54Z reached a file; 84 of 87 before did. CONFIRMED.
2. **Props written while there was 1 post stay on the tag and beat every master edit.** On a loop, Reset and Push cannot remove them, and Reset hides them (no `*`). The user's master edits and Push at 20:35–20:36 changed nothing visible on the page. CONFIRMED.
3. **The editor paints its own copy over the files after every scan.** The "ghost" `…grid…` class was the user's own editor-only edit (20:37:03Z), painted over the agent's fix on all 4 cards. CONFIRMED. Copies that disagree repaint each other every ~500 ms (the flex/grid icon flip): mechanism CONFIRMED, observed state for ≤39 s CONFIRMED, the on-screen flip INFERRED.
4. **Identity is a line number** (`file:line:col`). Agent writes and editor moves shift it; nothing re-keys; one ⌘Z restores every entry. CONFIRMED.
5. Not the cause: the write lane — all 195 rows of the session were written. CONFIRMED.
6. **Fix: the files are the only store.** An override is a prop on the usage tag; the editor holds a value only while its write is in flight; a loop is one instance; Reset/Push are previewed file operations on the tag. Ship in three releases; the first backs up and retires the old stores (§5–§7).

## 2. Timeline (UTC)

| Time | Who | What happened | Evidence | Status |
|---|---|---|---|---|
| 19:28–19:31 | agent | Builds the blog: collection, `/blog/`, `BlogSlot`, `BlogCard.astro` (1 post) | session log | CONFIRMED |
| 19:36:33 | agent | Card image becomes a ternary `{img ? <img/> : <div/>}` | session log | CONFIRMED |
| 19:37:51–20:22:52 | user | Hand-edits the single card; 84/87 edits write a page prop; each edited element becomes `class={Astro.props.xClass ?? "…"}` (rev 1236 time, 1237 h2, 1243 article; img) | journal | CONFIRMED |
| 19:52:17–44 | agent | `edit_file` fails "oldString not found" (the editor had rewritten the file); adds wrapper `<div class={Astro.props.textClass ?? …}>` + `textClass` (rev 1274–1275) | session + journal | CONFIRMED |
| 19:54:12 → 19:57:58 | agent → editor | Agent changes `h2Class` (rev 1276); an editor class edit writes the byte-identical pre-agent value back (rev 1279) — its base was a scan seed of the agent's own earlier value (rev 1275) | journal | CONFIRMED |
| 20:02:41 | user | "I still hover … and I see underline" — same "editor copy over the files" mechanism with **one** copy | session + journal | records CONFIRMED, painting entry INFERRED |
| 20:30:50–54 | agent | 3 posts created (rev 1342–1344): **4 copies** of one tag | journal | CONFIRMED |
| 20:31:09 | user | First card edit with no file command (rev 1345); every page-surface card edit after it is editor-only | journal | CONFIRMED |
| 20:34:25 | user | Copy 0 text div := `…grid…` (rev 1348, editor-only); copies 1–3 hold the page prop `flex flex-col …` | journal + mirror | CONFIRMED |
| 20:34:26–20:35:04 | user | **Reset**: a non-journaled deletion of exactly the placement's 22 entries (orphans included), no file change | Yjs decode of revs 1348/1349 + mirror | deletion CONFIRMED; "DesignBar Reset" INFERRED by elimination |
| 20:35:04 | user | Copy 0 := `flex … flex-row …` (rev 1349, editor-only) | journal | CONFIRMED |
| 20:35:33–20:36:00 | user | Master view: class writes on text div / time / h2 (rev 1350, 1352–1355); **rev 1351 swaps `<time>`/`<h2>`** — an editor move, not the agent | journal (identity maps, origin) | CONFIRMED (master view INFERRED) |
| 20:36:30–35 | user | **Push**: one Push = 9 writes to `BlogCard.astro` (rev 1356–1364), one per stored entry: 3 byte changes, 6 no-ops; overwrote the 20:35 master edits; page props untouched; `article`/`img` not pushed (no entries) | journal + mirror | CONFIRMED |
| 20:37:03 | user | Copy 0 := `…grid…` again (rev 1365, editor-only, key = copy 0) — **the ghost** | journal (Yjs origin chain) | CONFIRMED |
| 20:37:32 | user | "I cannot edit the card, I want to debug it." | session | CONFIRMED |
| 20:42:49 → 20:43:32 | agent | Sets `textClass="contents"` (rev 1366) and more props (1367–1368); three reads show `…grid…` on **all four** text divs: the agent's edits are masked too | session reads R10–R12 | CONFIRMED |
| 20:44–20:48 | both | Agent removes the wrapper and `textClass` (rev 1369–1371); editor move swaps h2/time again (rev 1372); deleting the ternary's `<div>` branch leaves `: }` = invalid Astro (rev 1375, restored rev 1377); 3 agent `edit_file` fail | journal + session | CONFIRMED |
| 21:13–21:17 | user | 13 more editor-only card edits; second Push (rev 1389–1392); second Reset (21:17:45); one ⌘Z re-creates 16 entries (rev 1401), redo 2.3 s later | journal + mirror | CONFIRMED |
| 21:21:28 | user | "The component itself looks differently. The instance looks differently. I want you to make component look like instance and then be them be synchronized." | session | CONFIRMED |
| 21:21:49–50 | agent | Rewrites the card and removes every class prop from the page — the workaround in the project today | journal + file | CONFIRMED |

## 3. Root causes

Two statuses: does the mechanism exist / did it act in this session. REPRO = `it.fails` test asserting the DESIRED behaviour
(fails today; the suite stays green); each was run as a plain `it` and fails at its intended assertion, not at setup.

| # | Root cause | Mechanism (code) | Exists / in session | REPRO |
|---|---|---|---|---|
| RC1 | **A loop usage cannot carry an override** | `sharedChain` (`utils/propOverrides.ts:69-76`, checked per element: any element ≥2 copies render) → `capturePropOverride` null (`services/durableEdits/propOverrideCommands.ts:31-34`; `console.warn` only) → stored per copy key, no file command | CONFIRMED / CONFIRMED (0/17 vs 84/87; null reason not logged ⇒ "sharedChain for all 17" INFERRED) | `loopInstanceOverrides` › "an edit on any copy…" |
| RC2 | **Reset/Push on a loop drop nothing from the files, then hide it** | `dropPropOverrides` uses the same capture → `[]` (`propOverrideCommands.ts:112-124`); entries deleted anyway; keys marked `settling` until a scan renders the master (`propOverrides.ts:364-373`); Push writes per entry, only entries that exist (`store/localMasterOverrides.ts:377-404`) | CONFIRMED / CONFIRMED (page tag unchanged across Reset #1 and both Pushes; Push wrote only the 3 elements with entries; settling as the reason `article`/`img` had none: INFERRED, strong) | `loopInstanceOverrides` › Reset ×2, Push ×3 |
| RC3 | **Per-copy store × per-placement paint × re-apply = a loop that never settles** | bridge paints every `[data-sq-source][data-sq-placement]` match, no hold check (`bridge/parts/dom-updates.ts:345-372`); intent-less re-apply of every differing entry (`components/Canvas/viewportMessages/scanning.ts:456-471`); computed-layout changes bypass `MAX_RESCANS` (`bridge/parts/scanning.ts:644-654`); no production gate stops it | CONFIRMED / INFERRED (disagreeing copies proven for ≤39 s, rev 1348 → Reset; after 20:37 contested, §8) | `loopCopiesClosedLoop` (5) |
| RC4 | **The scan reconciles from the painted DOM** | `seedFileOverride` turns a DOM class ≠ master literal into an edited entry per copy (`viewportMessages/scanning.ts:89-101`, for prop-fallback elements without an entry); anchors and the file-value cache record painted values | CONFIRMED / CONFIRMED (`sq-ai-appear` animation class stored as an override; rev 1279's base) | `loopCopiesClosedLoop` › painted value; `agentVsEditor` › sq-ai-appear |
| RC5 | **The editor's copy outranks the files** | an entry is compared with the master literal, never with the page prop (`viewportMessages/scanning.ts:60,189-214`; `store/sourceOverrideEntries.ts:80-101`); re-applied over the DOM; often the merge base of the next edit; a new session writes it back (`migrateEditorOverrides`) | CONFIRMED / CONFIRMED (ghost over the agent's props 20:42:57–20:43:32; 1276 → 1279) — merge-base path not always taken (revs 1290, 1297 used the file); new-session write-back did not run this evening | `loopGhostRepaint`; `agentVsEditor` › 1, 2 |
| RC6 | **Identity is a coordinate** | keys `file:line:col(~placement)(#N)`; 28/28 agent writes carry no identity maps (`utils/localElementSource.ts:43-48`); nothing re-keys the override maps; `planOverride` has no version/tag check | CONFIRMED / INFERRED (h2 changed key 5× in 78 min; `…:26:3~P` named the text div, later the h2) | `agentRewriteShiftsKeys` (2); `agentVsEditor` › stale coordinate |
| RC7 | **Undo is map-wide and judged at undo time** | one ⌘Z re-applies the whole `sourceClasses` snapshot (`context/UndoContext.tsx:627-654`); scope captured at undo (`:1165`) — in the master view an instance step becomes a master write; a refused step wedges the stack (`:1207-1209`) | CONFIRMED / minor (rev 1401: 16 entries re-created, one h2 copy pulled back 5 steps, user redid in 2.3 s; master-view mode did not fire) | `instanceUndo` (3) |
| RC8 | **The "migrated" record lies** | `sq:override-migrated` set before capture (`propOverrideCommands.ts:159-165`): loop edits marked migrated without a write; N → 1 never writes them; grows only (37 → 38 keys) | CONFIRMED / not in session (no N → 1) | `loopInstanceOverrides` › record, N → 1 |
| L1 | Latent: pending-write guard has no expiry | armed by every materialized class write (`services/classWriteBaseline.ts:184-226`); a permanent wedge for every `Astro.props.X ?? "lit"` element (all BlogCard elements) when another writer moves the file on; plain literals record the painted value as the file value | CONFIRMED / armed for `26:3` this session, wedging not shown | `pendingWriteWedge` (2) |
| L2 | Latent: an unchanged-value edit leaves an intent at `rev = Infinity`, re-posted with `hold:true` on every reload | `services/classIntents.ts` | CONFIRMED / not in session | scratch only |

Ruled out (CONFIRMED): the durable journal (healthy; its `yjsUpdate` is never replayed); bridge holds/seq gates as the reason manual edits stopped (a manual edit always carries a newer intent).

### Symptom → cause

| Symptom (user's words) | Causes, ranked |
|---|---|
| Design bar registered changes inconsistently | RC3 (edit repainted by sibling copies + click adoption of painted values); the bar and the canvas read different stores (bar: draft → carrier → scan → entry); RC5; RC7. Variant classes (`group-hover`) not shown by the bar (user 19:59:02) — unmapped, separate |
| Layer icon switching flex/grid | RC3 — the icon is the computed style at the last scan; also the user's own grid/flex toggles broadcast to all copies |
| Component and instance never matched | RC2 (1-copy-era props on the tag beat every master literal; Push wrote only entries); RC5; ternary: master view renders `<div>`, page renders `<img>` |
| Reset did not look like master | RC2 |
| Ghost class after Reset + Push | RC1 + RC5: rev 1365, the user's own editor-only edit, re-applied after every scan and broadcast to all 4 copies |
| Card stopped responding; AI edits still worked | RC2 (master edits and Push invisible: the tag passed all 5 props), RC1 (no card edit reached a file), RC3 (contested at 20:37, §8). "AI still worked" is true only in the files: on canvas its 20:42–20:43 edits were masked too |
| Instance and master "not connected" | RC2, RC6, RC7; fixed only by the agent moving every value into the component (rev 1409–1410) |

### Corrections to the first-pass brief

The ghost was a fresh editor-only edit 28 s after the Push, not a leftover the stores failed to clear · `<time>`/`<h2>` were swapped by editor moves (rev 1351, 1372), not by the agent · the editor converted only edited elements to props, not every class · the first pass missed the second Push (rev 1389–1392) and second Reset (21:17:45) · `sq:override-migrated` grew 37 → 38 keys · mirror records 1751–1763 are 21:17–21:22Z (the LevelDB LOG is local time).

### Adjacent defects (not causes here; each needs its own fix)

- **The blog binding writer drops override props from the card tag** when it re-emits the posts fragment (`utils/blogBinding.ts:300-311`); saved today only by a regex miss. Under §5 that is permanent data loss → fix first (R0). CONFIRMED by scratch test.
- **The master view stubs destructured override props as `''`**, and `'' ?? "lit"` is `''`: such a master renders no class (an `<img>` override shows the placeholder tile), and a master edit starting from it can wipe the literal (`SqComponentView.astro` stub builder). CONFIRMED by running the real `buildStubProps` (2026-11-24): `{ h2Class: '', imgSrc: <stub>, post }` → fixed in R0.
- **The master view renders the card without a post**, so the ternary's master (`<div>`) and instance (`<img>`) are different elements. CONFIRMED.
- **Deleting one ternary branch in the master view leaves invalid Astro** (`: }`, rev 1375). CONFIRMED row.
- **The journal is never pruned and read whole per acceptance**: 1410 rows ≈ 38 MB + receipts ≈ 45 MB; 0.13–0.73 s per acceptance. CONFIRMED.
- **A master class write waits a 5 s idle debounce and rows land in strict order**, so a Reset/Push/instance edit right after it lands ≥5 s late. CONFIRMED (code + 4.6–7.8 s lags).
- **The blog card's wrapper `<a>` cannot be styled in the editor** (transparent chrome). CONFIRMED.
- **AI `reset_instance`/`push_instance_to_source` report outcomes they do not check.** CONFIRMED.

## 4. Store map — where an instance override lives today

| Place | Keyed by | Written by | Read by | Cleared by | Disagrees with |
|---|---|---|---|---|---|
| Page prop on the usage tag | usage tag + prop name (one value, all copies) | edit gesture via `planOverride` — 1 copy only | Astro render | Reset/Push via `dropPropOverrides` — not for loops | editor entries (RC1, RC2, RC5) |
| Component fallback `Astro.props.x ?? "lit"` | element | first instance edit (`ensureProp`); Push; master-view edits | Astro; tagger `data-sq-cf` | never (plumbing stays) | — |
| Yjs `sourceClasses` / `sourceText` / `sourceImageAttributes` / `sourceLinkAttributes` | `file:line:col~placement#N` | edits, scan seed, click adoption, undo, mirror restore | design bar, scan re-apply, `#sq-ov`, `*`/Reset/Push | Reset/Push (file + placement), undo | files — no reconciler |
| `sq:source-classes|text|images:<pid>` (keyScheme 4 + `setAside`) | same key, no version | 300 ms debounce of edited entries | restore at open | never ("NEVER purged") | files |
| `sq:override-migrated:<pid>` | `kind|key` → value | `migrateEditorOverrides`, before the write | the same | never | files |
| `#sq-ov=` URL fragment | full key, own copy counter | every render | bridge pre-paint, per copy | rebuilt | bridge broadcast (per placement) |
| Bridge DOM paint + holds | `data-sq-source` + `data-sq-placement` (all copies) | `UPDATE_CLASSES` | scan, layer icon | reload | per-copy store |
| `settling` (memory) | `kind|key` | Reset/Push | scan seeding | a scan rendering the master | files |
| `pendingDispatch`, file-value cells (memory) | `file:line:col` | every published class write; scan | scan staleness, writers, `↻` | exact-string scan | coordinates moved by others |
| `acceptedSourceClassCarriers` (Yjs) | `[file, version, revision, line, col]` | file-backed class edits | design bar, next anchor | never | per-copy entries |
| Durable journal (IndexedDB) | revision | every accepted gesture | materializer, undo | never pruned | — (`yjsUpdate` never replayed) |
| Undo stacks | whole-map snapshots | `takeSnapshot` | undo/redo | session | everything above (RC7) |

Full map with every writer/reader line and the iframe state: `tmp/investigation/map-override-stores.md` §2.

## 5. Target architecture

### 5.1 Principles

- **P1. The files are the only persistent store of an override.** Component: `class={Astro.props.h2Class ?? "m-0 text-2xl"}` (the literal is the master). Usage tag: `<BlogCard post={post} h2Class="m-0 text-4xl" />`. No Yjs entry, mirror or record holds an accepted override. Allowed pre-acceptance durability only: the gesture stash and `.sq/drafts` (input not yet accepted).
- **P2. The editor's copy exists only while a write is in flight**, and that state is visible: "Saving…" on the selected element after 10 s unlanded, "Not saved" + Discard on a materializer issue.
- **P3. Sync is one-way: files → canvas → editor.** A scan never paints a stored value over the DOM and never writes a file. Only a gesture or an agent tool writes files.
- **P4. Instance = one usage tag at one level** (the view's root file: the page, or the component open in the master view). Override target = (usage chain, master element, kind). `#N` only addresses a DOM node (rectangles, hover, drafts, stash keys map to the instance). An edit on any copy writes the one prop.
- **P5. The override ↔ master link is the prop name**, not a coordinate: `h2Class` on the tag ↔ every element reading `Astro.props.h2Class ?? …` (both ternary branches). Coordinates live inside one scan generation; a write planned from one carries the scan's source version and is rebased through identity maps or refused.
- **P6. Reset and Push are previewed file operations on the tag**, planned from the sources, per level.
- **P7. Inexpressible edits are refused at selection time** (control disabled, reason inline, redirect action); a lane-time refusal stays as the race backstop.
- **P8. One write lane with real compare-and-swap**, including agent `write_file` (checked against the agent's last read) and visible refusals for user rows whose rebase is not clean.
- **P9. No writer drops attributes of a usage tag it rewrites** (the blog binding writer).

### 5.2 Definitions (derived, never stored)

- **Inventory of an instance at a level** = the literal props the usage tag at that level passes that elements of this instance read through the prop thread. Pure function of the sources, cached by source version. Returns `unknown` for chains it cannot parse (aliases, spreads it cannot follow) — shown as unknown, never as "clean". The tagger's `data-sq-cf/tf/sf` become display hints only (they do not exist for `class:list`, non-literal fallbacks, `alt`, markup-form text).
- **Overridden element** = it is in the inventory. `*`, Reset/Push enablement and the per-property list all come from the inventory.
- **One precedence rule** for the displayed value, `*`, enablement and the edit base: in-memory draft → unlanded journal row → scan/inventory. Editor-owned `sq-*` classes are stripped everywhere.

### 5.3 Operations (each = one journaled file batch; existing command kinds only)

| Operation | File change | Rules |
|---|---|---|
| Edit an instance element (class, text, img src/alt, grid placement) | set/replace the prop on the tag at this level; add plumbing the first time | equal to the **effective value at the next level** (an intermediate's literal, else the component literal) ⇒ drop the prop; never auto-drop when that value is not a literal; loop ⇒ all copies, by construction |
| Reset instance | remove the literal props whose thread ends in this instance's elements, at this level | show the exact list (name, current → result) before applying; expressions are read-only; the agent tool returns the same list |
| Push instance to master | each reader's fallback literal := the prop value (every reader, e.g. both ternary branches); remove those props at this level | refuse (or confirm "replaces the class logic") for non-literal fallbacks; refuse expressions; target the nearest level that owns the value; one batch over all files |
| Edit master (component view) | the component literal | unchanged (`class-write`); fix the stub props so the master renders its literals |
| Agent `write_file` / `edit_file` | arbitrary | `write_file` refuses "changed since you read it — read_file again" when the bytes differ from the agent's last read |

**Refusal list (P7)**, decided at selection time: today's five plan throws (markup over plain-text prop, dynamic/`astro:assets` img src, text with expressions, component not placed exactly once, missing file — `propOverrides.ts:176,188,191,262,297`) + grid drag of a loop item (all copies would stack; refuse at drag start) + data-dependent master inside a loop + removing a static token next to `class:list` + a usage-side expression + a prop shadowed by a spread on the usage tag + typed `Props` that cannot be declared + an unresolvable import alias + link href/target on an instance element (no override kind yet).

### 5.4 Gesture lifecycle and holds

1. Target from the current scan; base per the precedence rule.
2. Optimistic paint on all copies; hold keyed by (placement, element, kind) — no `#N` — with the latest seq. Text and image paints broadcast like class paints.
3. Plan against the projected bytes; assert the coordinate still names the scanned element (source version or identity map, plus tag name); else rescan and retry once, then refuse.
4. Materialize. Reset and Push flush the lane (a deferred master class write must not hold them back 5 s; `waitForIdle` stops waiting when a later row is not deferrable).
5. Release the hold when every file of the batch shows the accepted bytes (or later/unknown bytes) in a per-scan file → content-hash map; at once for a no-op; with a toast on an error overlay or timeout. An unsettled hold never releases on a value comparison (the backstop stays); `alive` refreshes only the holds it names.

### 5.5 Agents

- `write_file`/`edit_file`: compare-and-swap against the agent's last `read_file` hash (P8).
- `read_element_html` / `read_source_elements`: flush accepted writes, wait (bounded) for the render, mark held elements `pending`, strip `sq-*`, return `stale: true` while refreshes are held.
- `update_element_by_key` on an instance element writes the prop (a loop restyles every copy) or fails with the P7 reason. `reset_instance`/`push_instance_to_source` work from the inventory (including props typed by hand) and return what the files now say; an optional usage address reaches instances that render 0 copies. Schemas change additively only.
- Open item: the agent's `undo` tool shares the user's stack and can undo the user's last manual step.

### 5.6 Undo

One step = one gesture. Undo/redo re-issue the inverse operation through the same function as the gesture (set prop / remove prop / set master literal) with the target and the write scope recorded **at the gesture**: paint, hold, lane and refusal come for free. Plumbing stays after undoing a first edit. When the prop is no longer read or the bytes conflict, the step is refused with a toast and removed — it never wedges the stack. (Today undo has no text re-merge: `replayClasses` refuses on any byte change.)

### 5.7 Loops, nesting, ternaries, `↻`

- **1 ↔ N**: no special case. **N = 0**: the Layers tree comes from the scan, so a usage that renders nothing has no row — owner picks: a source-derived "instances on this page" list, agent tools only, or "needs one rendered copy".
- **Nesting**: `*`, Reset and Push are defined per level; a component-view edit of a nested instance is an override at the component level.
- **Ternary**: one prop read by both branches is one override; Push writes both fallbacks; the master view needs data variants (first usage's props or the first collection entry — owner decision).
- **`↻` ("the master changed since you overrode it")**: drop the stored anchor. Replace it with derived signals: on the instance, `*` + the master value inline + per-property Reset; in the master view, "overridden in N instances" per element (reverse-import walk + inventory) and a notice after a master edit: "N instances override this and did not change [Show]". Keep the blog-settings `settingsOutdated`.

### 5.8 What gets deleted (files-truth runtime)

`sharedChain` refusal · per-copy override keys · scan re-apply of class/text/image/link-markup entries · `#sq-ov` pre-paint · `seedFileOverride` · `settling` · `migrateEditorOverrides` + `sq:override-migrated` · the `sq:source-*` mirrors (after backup, §6) · `baseClasses`/`fileClasses` stored anchors (the gesture-time base stays inside the class-write command) · the pending-write guard and file-value cells · `localOutdated` · per-entry Push · the whole-map undo restore of the `source*` maps · the intent-less grid-drag sync path. **Kept**: the export guard for unpushed overlays (a cheap invariant; 6 call sites), the gesture stash, `.sq/drafts`, every v0.0.2 journal adapter.

### 5.9 Why the alternatives lose

- **Keep both truths, fix the bugs** (collapse copy keys, let Reset drop loop props, expire the guard…): smallest diff, but the defects are independent failures of the reconciliation layer itself (RC3–RC6, RC8, L1), and coordinate-keyed overlays cannot survive writes from agents, IDEs and git, which will never send identity maps.
- **Editor store is the truth, files are output**: agents, IDEs, git, export and deploy all work on files; the owner already ruled files-first (2026-10-07); it is today's failure with the roles swapped.
- **Per-copy overrides as a feature**: one tag cannot carry them; if ever wanted, an explicit data-driven variant prop.
- **Stable ids stamped into every element**: pollutes user source, breaks on copy/paste, unnecessary once nothing persistent is keyed by element.
All three judges (state space, old contract, live editing/agents/undo/performance) independently: adopt the files-only model with the changes above; none found a better alternative.

### 5.10 Owner decisions

1. `↻` replacement as in §5.7 (recommended) vs dropping the signal.
2. N = 0 instances: source-derived list (recommended) / agent-only / not supported.
3. P7 is a behaviour change: today such edits silently stay in the editor and never ship.
4. Master preview with real data for ternaries (first usage's props, or first collection entry).
5. Push of a non-literal fallback: refuse (recommended) or confirm.

## 6. What still speaks the old contract — and the migration

| Old contract | Plan |
|---|---|
| `sq:source-classes|text|images:<pid>` (incl. `setAside` buckets and unparseable blobs) and `sq:override-migrated:<pid>` | **M0**, synchronously at every app start, idempotent: append `{at, appVersion, key, raw}` for each legacy key to `sq:legacy-overrides-backup:<pid>`; remove the live key only after that write succeeds (if it fails: ignore the live key and say so); never auto-delete the backup. **Files win; nothing is written at migration.** One notice per project (Details, Download). Optional per-item "Apply again" = the normal gesture on the element currently at that key, after a tag check. |
| Shipped promises: `setAside` "NEVER purged", toast "Nothing was deleted" | kept by the verbatim backup |
| Installed v0.0.2 (same origin, same IndexedDB) | no new journal command kinds (an unknown kind silently halts v0.0.2's strict-order materializer, `materializer.ts:163-165`) — undo emits `file-batch`; keep every v0.0.2 adapter and payload shape (change the `class-write` adapter, don't drop it); Dexie changes additive; keep `wc://` paths. Downgrade re-creates the mirror keys → M0 runs every start and appends a new generation. v0.0.2 cannot Reset/Push loop props the new client writes → release note |
| Props already on usage tags (written by the editor, the user or an agent) | the truth, unchanged; editor-written plumbing (`Props` edits, rewritten spreads, `?? (expr)` fallbacks) survives Reset/Push |
| Gesture stash (24 h, `#N` keys), `.sq/drafts` | kept; replay maps a copy key to its instance; scan keys keep `#N` so drafts match |
| AI/MCP tools | each tool changes in the release that changes its behaviour; schemas additive; truthful results |
| `↻` on existing overrides | disappears (no trustworthy anchors exist) — release note |
| Export guard | kept |

## 7. Implementation plan (releases; each gate = named tests + full suite at its baseline)

| Release | Content | Gate |
|---|---|---|
| R0 (alone) — **built 2026-11-24**, branch `fix/r0-usage-tag-attrs`, commit `d0beb6a` (local) | The binding writer edits the posts fragment **in place** (span-exact, `scanTags`): only the list, the wrapper's kind/link/stamp/owned class token and the entry prop (+ the card name on a switch) change; override props, wrapper classes and formatting stay; any other fragment shape is `custom` (shown as hand-wired). Card detection is attribute-order independent; the card picker / missing-card heal (`planCardMove`) swaps tags by span. A card switch keeps the page's props (one rule). Component view: a destructured name the component never uses as a local is not stubbed | 25 new tests; affected area 314 → 339 vs a clean `origin/main` run (0 lost); full suite green (9864 passed, 0 failed); two adversarial review rounds — every regression they found fixed; a simplify pass proven behavior-identical by an old-vs-new differential run (1.19M comparisons; only intended difference: wrapper attribute names match case-insensitively) (1 pre-existing item noted: the stub builder reads only the first `Astro.props` destructure) |
| **R1 (ships whole)** | M0 backup + retire the old stores (stop restore/persist/migrate; delete `migrateEditorOverrides`); a loop is one instance (no `sharedChain` refusal; holds and editor state keyed without `#N`); P7 at selection time + refusal list; `update_element_by_key` parity | M0 tests (verbatim backup incl. `setAside`/unparseable; remove only after a successful backup; idempotent; a simulated v0.0.2 restore finds nothing); `loopCopiesClosedLoop`, `loopGhostRepaint`, `agentVsEditor` 1/2/4, `loopInstanceOverrides` "edit on any copy" rewritten as plain tests; `directMutationOwners.ts` updated |
| R2 | One-way sync for every element with an override chain (delete all re-apply paths, `#sq-ov`, seeding, grid-drag sync); inventory + previewed Reset/Push per level (pure planners); identity check in the plan; hold rules + visible pending state; Reset/Push flush; agent tools: inventory-based reset/push, CAS `write_file`, flushed reads | planner unit tests per case (ternary, threaded props, layered overrides, authored props, `class:list` refusal, spreads, N = 0); `loopInstanceOverrides` Reset/Push rewritten against the planners; `agentVsEditor` stale coordinate; `agentRewriteShiftsKeys`; one bridge test per hold scenario (agent row first, Reset on a held element, burst) |
| R3 | Undo as inverse operations through the gesture path; delete the pending-write guard, file-value cells, `localOutdated`, dead code; bounded journal reads (`[projectId+revision]` index) + compaction | `instanceUndo` (3); `pendingWriteWedge` (2); journal rows read per acceptance fall from ~1410 to the in-flight rows |
| E2E | Desktop replay of this session: 1 post → edit → 4 posts → edit copy 3 → Reset → Push → agent rewrite → edit → undo | `desktop` e2e |

**Using the REPRO gates during the rewrite.** An `it.fails` test also passes when its arrange throws (a deleted export is
`undefined`, a removed module), so a green suite proves nothing about a REPRO. At each release: flip that release's gate
tests to plain `it` and make them pass; run the others as plain `it` in a temp copy and check they still fail at the
intended assertion. Several arranges/assertions touch internals the plan deletes; switch them to the behaviour-level form
when their release lands:
- `loopInstanceOverrides`: arrange via `migrateEditorOverrides` → write the 1-copy bytes directly; `*` via `localOverridesForPlacement` → `hasLocalMasterOverrides` / the inventory; Push via `writeClassUpdate` call counts → card-file writes logged by the file mock (1 write, ≤ 1 value); "captured as one prop" via `capturePropOverride` → edit copy #1 through `acceptEditorCommands` and assert the page carries the prop; the migrated-record test retires with R1.
- `agentVsEditor`: drop the store-value assertions (keep the repaint one); new-session act `migrateEditorOverrides` → `scanInto` + flush; `sq-ai-appear` → no file write carries `sq-`; narrow `rejects.toThrow()` to the refusal message.
- `loopCopiesClosedLoop`: sanity test → keys from the `ELEMENTS_SCANNED` payload; "one stored value" → the second `round().paints === 0`; the painted-file-value test retires at R3.
- `pendingWriteWedge`: arrange through a gesture + `flushDurableSourceWrites`; drop the file-value-cell assertion.
- `instanceUndo`, `agentRewriteShiftsKeys` (orphan test): read the page tag / DOM / inventory instead of Yjs entries at R2–R3.

Risks to manage: shipping part of R1 loses data silently (flip before backup) or regresses visibly (P7 before "loop = one instance") — R1 ships whole. Every loop edit becomes a disk write + re-render (today a 22 ms no-command row): holds hide it on canvas, undo/agent flushes/bursts feel it. More file writes mean more chances of a deterministic materialization failure, which blocks every later row until Discard — the visible pending state (R2) must not lag far behind. Hold-rule changes touch the mechanism that makes edits feel instant: one bridge test per scenario.

## 8. The claim most likely to be wrong

**"At 20:37 the card stopped responding because sibling copies repainted the user's new edit"** (RC3 at that moment). It
contradicts this report's own ghost model, in which copies 1–3 had no entries after the Push (the `loopGhostRepaint` state).
Under that model nothing repainted the 20:37:03 edit, and the better-supported cause is RC2: six master edits and a Push
that changed nothing visible because the tag still passed all five props. Three identical reads at 20:42:57–20:43:32 (all
four copies = the ghost) favour it; the code path (a Push can clear the siblings' settling marks mid-write and let them be
re-seeded), the 29-second timing and "kept switching" favour the sibling-repaint story. The deciding mirror record was lost
(PARSEFAIL in the first pass). To settle it: a harness test running the real Push + scan + bridge with HMR rescans
interleaved between the writes and the clear. The architecture does not depend on the answer: both mechanisms are
CONFIRMED in code and both disappear under §5.

## Appendix A — files created (nothing else changed)

REPRO tests, untracked, under `app/src/`:
- `services/durableEdits/__tests__/loopInstanceOverrides.repro.test.ts` (8)
- `services/durableEdits/__tests__/agentVsEditor.repro.test.ts` (4)
- `bridge/parts/__tests__/loopCopiesClosedLoop.repro.test.ts` (6: 1 sanity `it` + 5 `it.fails`)
- `bridge/parts/__tests__/loopGhostRepaint.repro.test.ts` (1)
- `components/Canvas/viewportMessages/__tests__/agentRewriteShiftsKeys.repro.test.ts` (2)
- `components/Canvas/viewportMessages/__tests__/pendingWriteWedge.repro.test.ts` (2)
- `context/__tests__/instanceUndo.repro.test.tsx` (3)

This document. Local only (gitignored `tmp/`): evidence snapshot, decoders, reports, scratch tests. Worktree dependency
symlinks (`node_modules`, `app/node_modules`, `preview-template/node_modules`, `desktop/node_modules` → main checkout).

Simplify pass (4 reviewers: reuse, simplification, efficiency, altitude) on the REPRO files: removed no-op stubs
(`resolveAssetRefs`, `_assetMap`), redundant casts, an unused `vi`/`doc`, a dead `runtime?.close()`; reused
`makeFakeIframe()`; deduplicated edit setup; JSX in the `.tsx` test. One assertion changed on purpose: `instanceUndo`
test 1 now expects copy #1 to equal copy #0 after undo (one instance, P4); it still fails today (`flex flex-col`). All 25
`it.fails` re-verified at their intended assertions; the 7 files typecheck. Known: `instanceUndo` test 1 leaves a 250 ms
materializer retry that fires in the next test of the same file (isolated worker; harmless today, watch for flakes).

## Appendix B — test counts (`cd app && npx vitest run`)

| Run | Test files | Tests passed | Failed | Todo |
|---|---|---|---|---|
| Baseline, `main` @ 5ee6ccc (2026-11-23 23:48 CET) | 1101 passed + 1 skipped | 9829 | 0 | 33 |
| After: + 7 REPRO files (2026-11-24 10:13 CET) | 1108 passed + 1 skipped | 9855 | 0 | 33 |

Delta: +7 files, +26 passing (25 `it.fails` + 1 sanity `it`), 0 tests lost (per-test name diff of the two JSON reports).
Baseline only became valid after linking `preview-template/node_modules` into the worktree (first attempt: 137 files failed
on a missing `@astrojs/compiler` — an environment artefact, discarded). Raw reports: `tmp/gate/{baseline,final}.json`.
