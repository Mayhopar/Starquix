# Culture: how editor chrome looks

**The Figma is the spec.** The kit follows the Starquix UI design file; tokens are named after its variables. When this
doc and the Figma disagree, the Figma wins; then fix this doc.

## How the Figma is organized (copy the organization, not only the look)
- **The pages are atomic.** `🦠 COMPONENTS` (Buttons, Segmented Control, Row, Dropdown, Toggle, Input) → `🌸 ORGANISMS`
  (Design Bar) → `UI` (screens). A screen holds only instances of those atoms in auto-layout frames. Nothing is drawn by
  hand. Code mirrors this: a screen is kit pieces (`components/ui/`) in flex columns, and nothing else.
- **Every atom is a variant matrix:** Size × State (Default · Hover · Active · Selected · Disabled · Error · Readonly),
  next to a Light/Dark review frame. A kit piece you add needs every state, in both themes.
- **Every atom has one skeleton:** a `.background` layer (fill or stroke), one slot box per icon (a 16px glyph + 8px
  around: 32px in rows, 24px inside fields), and text padded 8px. That is why a row's label sits 16px past its icon.
- **Values are variables, named like our tokens.** Background/Bg · Background/Hover · Stroke/Default · Stroke/Darker ·
  Text/Default · Text/Secondary · Active/Secondary · Buttons/* map to `bg-bg` · `bg-bg-contrast` · `border-stroke` ·
  `border-stroke-darker` · `text-text` · `text-text-secondary` · `text-text-muted` · `btn-*`.
  - Spacing comes only from 4 · 8 · 16 · 24 · 48.
  - Type comes only from the theme.css TYPE variables: text-xs 12/16 · text-sm 14/20 · text-lg 18/28 medium (a window's title),
    their `-medium` twins (text-xs-medium, text-sm-medium…, ONE class) and our micro text-2xs 11/14 · text-3xs 10/12.
    Two weights only: font-normal 400, font-medium 500. `font-semibold/bold/light`, `text-base`+ are lint errors.
- **An Input is a label row + a field + a helper.** In a window a setting is never "label left, value right". The label
  sits 4px above a 32px field, and the helper or error sits 4px below it.

**Two densities, one system:**
- **Panels** (Layers, Assets, DesignBar, Pages) follow the Figma's Design Bar: dense, 12px rows, actions on hover. Copy
  these references:
  - `components/AssetsPanel/AssetsPanel.tsx` ~L1398–1530: panel sections and lists
  - `components/DesignBar/sections.tsx` + `DesignBar/blocks/StrokeBlock.tsx`: property UI
  - `components/SeoPanel/sections/SearchSection.tsx` + `SeoPanel/SeoTextField.tsx`, `components/PagesPanel/`
- **Windows** (Publish, Versions, any dialog) follow the Figma window (Publish): the Window recipe
  below. The reference is `components/DeployModal/` (`publishParts.tsx`, `PublishFlow.tsx`, `CloudflarePublish.tsx`).

**The kit already sets the scale.** Row, Field, Button, Badge and MenuItem carry their own type size, height and padding.
Your job is to put kit pieces next to each other with nothing added between them. Every size, weight, padding, border or
sentence you add on top breaks the scale. That is why screens that pass lint and use only `Row`s still look wrong.

## Measured

| | Reference surfaces | Windows that don't follow these rules |
|---|---|---|
| Rows with a `caption` | 7% (8 of 117) | 50–88% |
| `variant="primary"` | 0 per panel | 1–6 per file |
| `<p>` / `<h1–6>` | 3 / 1 in 14.8k lines of DesignBar | 1–5 / 1–3 per file |
| `Card` or bordered box around rows | 0 | 2–3 per file |
| `text-sm` or larger, hand-written | ~0 | up to 9 per file |
| Buttons `size="sm"` / `ghost` | 88% / 72% | 80% / 31% |

## The scale (never add to it)
| | Panels | Windows (Figma) |
|---|---|---|
| Type | Row md title `text-sm` + `font-normal`; Row sm, Field, Button, MenuItem `text-xs`; captions, `rightText`, badges `text-2xs`/`text-3xs` | title `text-lg` (medium) (`Window` draws it); option labels and field values `text-sm` regular, ink (Row md, `Field size="lg"`); labels, helpers, status `text-xs` (`Labeled`, `Status`) |
| Height | Row sm 32 (lists, settings); `h-7` trees; Button sm 24 (md 32 only in a footer) | header 56; option rows 40 (Row md); fields, buttons, segmented 32 (`Field size="lg"`, Button md, `SegmentedControl size="lg"`); footer 56 (Button lg 40) |
| Left edge | 12px (`pl-3` header; `px-1` list + `px-2` row) | 16px for the title, the radios and the status; 48px for option labels and everything under the picked option |
| Gaps | `gap-1`/`gap-2`, `space-y-1`; a section = a header Row (`mt-2`) or one `border-t` | 4 · 8 · 16 · 24 · 48 only: label → field 4; items 16; under the picked option 8 on top, 16 below, 24 on the right |
| Color | values `text-text`, labels `text-text-muted`, meta `text-text-secondary` | values and option labels `text-text`; field labels, placeholders, helpers and status `text-text-secondary` (labels are dimmed by the token, in `Labeled`); rules and fields `border-stroke` (the header/footer rules are as subtle as Layers') |

Write type classes only where the recipes do: `text-xs` (one sentence) or `text-2xs text-text-secondary` (meta) in panels.
In windows the kit and `publishParts` write the type for you. Semantic color goes only through `Badge` / `OperationNotice`.
Never use `p-5`/`p-6`/`gap-5`+ anywhere, and in panels never `p-4`/`gap-4`/`space-y-4`/`mb-4`/`mt-4`.

## Laws
1. **One-line rows.** A panel row is a label plus a value, a control or an action. Add a `caption` only when the title
   alone is ambiguous, use at most one caption pattern per list, and never put captions on settings rows. A window's
   option rows are one line too, and its settings are Inputs (label on top, Law 9).
2. **No boxes.** No `Card`, `border rounded` or `divide-y` box around rows, and no box inside a box. `Card` is only for
   dashboard project cards. A field is a control, not a box around rows.
3. **No prose.**
   - No subtitles, helper paragraphs or `<p>` explanations.
   - Make the label explain itself. Put guidance in a `placeholder`, a `Tooltip`, or a field's one helper line.
   - Problems go in an `OperationNotice`.
   - Non-technical users need plainer words, not more words.
4. **Headers are Rows.** A section title is a Row with `hover={false}`, never `<h2>`/`<h3>` or a `font-medium` div.
   Section actions are ghost `iconOnly` sm Buttons in the header's `right` slot (like the Assets "+"). A window's header
   is `Window`: its name and Close, nothing else.
5. **Ghost by default, one primary.**
   - At most one live `variant="primary"` per view: the decision, bottom-right in a window footer. Panels have none.
     When the decision waits on a step the user must take first (GitHub Log in while signed out — Publish and Back up
     stay disabled until then), that step is the primary (it is the target action) and the footer's decision waits
     disabled.
   - Row actions are ghost buttons with `showOnHover`, or a row `Menu`. Never inline expanders or a column of identical
     outline buttons. Six "Copy" buttons become one Copy action per row, shown on hover.
   - In a window, an action on a value goes inside its field as an icon: the link icon opens an address, a chevron opens
     the value's menu (clicking the field opens it too). A value the user can switch (a repository, a site branch, a
     domain) is always such a dropdown field — never a value plus "Show X" / "Back to Y" buttons. A text action on a value is an outline md button right after the field.
6. **Delete anything, undo anything — never ask.**
   - A delete or any destructive edit acts at once; ⌘Z brings it back exactly, ⇧⌘Z does it again. Make it undoable
     (claimed snapshot carrying the files; a snapshot side effect for data outside the doc) instead of asking.
   - Never a question: no native `confirm`, no "Delete X?" row, no Modal on a Modal.
   - Outside ⌘Z (publish/unpublish, disconnect a repo, restore a version) just act: the way back is the opposite action
     (after an unpublish, just publish again). The AI deploys only when the user asked in the chat.
   - The one decision a footer still holds (`FooterConfirm`): a choice the user must make to go on — a branch switch with
     unsaved changes (Save version & switch / Discard & switch). Never a yes/no about a delete.
7. **Left-aligned.** Nothing is centered except `EmptyState`.
8. **Icons are 16px** (`w-4 h-4`) and go in slots. Use identity icons only where the list needs them (Layers, Assets).
   No emoji.
9. **Choices unfold in place (windows).** A pick-one list is option rows (radio + name). The picked option's settings sit
   right under its row, indented to its label (48px). Never put a separate settings block below the list, and never a
   highlight band: the radio's dot shows the pick.
10. **Accounts live where they are used.** A destination's account is one of its items ("GitHub": Log in, or the name +
    Log out). Never a ⋯ account menu in a header.

## Recipes (copy them, don't improvise)

### Panel section (as in AssetsPanel)
```tsx
<Row title="Backups" size="sm" className="pl-3 pr-1" hover={false}
  right={[{ type: 'custom', unboxed: true, node: <Button variant="ghost" size="sm" iconOnly
    aria-label="Back up now" title="Back up now" icon={<PlusIcon className="w-4 h-4" />} onClick={backUp} /> }]} />
<div className="flex-1 overflow-y-auto scrollbar-thin px-1 pb-1">
  <Row title="Today" size="sm" className="pl-2 pr-1 mt-2" hover={false} />{/* group label */}
  {items.map(b => (
    <Row key={b.id} size="sm" className="px-2" title={b.kind} rightText={b.time}
      left={[{ type: 'icon', icon: <HistoryIcon className="w-4 h-4" /> }]}
      right={[{ type: 'custom', unboxed: true, showOnHover: true, node: <Button variant="ghost" size="sm"
        iconOnly aria-label="More" icon={<MoreIcon className="w-4 h-4" />} onClick={openMenu} /> }]}
      onContextMenu={openMenu} />
  ))}
</div>
```
Row actions go in a `Menu`/`MenuItem` opened from the hover button or a right-click, the same way AssetsPanel's
`RowMenu` works.

### Settings in a panel (property rows)
```tsx
<Row title="Keep last" size="sm" className="px-2" hover={false}
  right={[{ type: 'custom', unboxed: true, node: <div className="w-16">
    <Field type="number" value={String(keep)} onChange={v => setKeep(Number(v))} aria-label="Keep last" /></div> }]} />
<Row title="Before every publish" size="sm" className="px-2" hover={false}
  right={[{ type: 'toggle', value: on, onChange: setOn, 'aria-label': 'Back up before every publish' }]} />
```
For long text inputs in a panel, put a label Row above a full-width Field and the guidance in the placeholder, as in
SearchSection (`SeoTextField`).

### Window (the Figma)
Reuse the parts in `components/DeployModal/publishParts.tsx`; never re-draw them.
```tsx
<Window isOpen onClose={close} title="Publish">{/* 56px header: the name (text-lg medium) only — no ✕ */}
  <Pane footer={<>                       {/* 56px footer: pl-4 pr-2 py-2, a border-stroke rule (as subtle as Layers') */}
    <Status>{status}</Status>            {/* text-xs secondary on the 16px edge; empty = a spacer */}
    <Button variant="ghost" size="lg" label="Unpublish" onClick={askUnpublish} />
    <Cancel />                           {/* secondary lg: closes the window (or cancels what's pending: onClick) */}
    <Button variant="primary" size="lg" label="Publish" onClick={publish} />{/* 8px from the right edge */}
  </>}>
    <DestinationList pick={pick} onPick={setPick} current={host} badge={badge} disabled={busy}>
      {/* the picked option's items: 48px in, 24px from the right, 16px apart */}
      <Prop label="Address" value={bare(url)} icons={openIcon(url, 'Open site')} />
      <Prop label="Repository" value="acme/site" onOpen={toggleMenu}
        icons={<Button ref={menuRef} variant="ghost" size="sm" iconOnly aria-label="Repository options"
          icon={<ChevronDownIcon className="w-4 h-4" />} onClick={toggleMenu} />} />
      <Prop label="GitHub" actions={<Button variant="primary" size="md" label="Log in" onClick={signIn} />} />{/* signed out: the live primary */}
      <Notices flush>{notice && <NoticeView notice={notice} />}</Notices>
    </DestinationList>
  </Pane>
</Window>
```
- An editable setting is `<Labeled label="Repository" error={e}>` around `<InputGroup layout="row" gap={2}>` with
  `<Field size="lg" className="flex-1" …/>` and the field's outline md buttons.
- A value with no field (only an action) is `<Prop label="Domain" actions={<Button variant="outline" size="md" …/>} />`.
- A form that is a whole sub-view puts its items in `<Form>` (16px edge, 16px apart). The footer keeps Back + the primary.
- A choice the user must make to go on (Law 6: never a yes/no about a delete) is the same footer with
  `<FooterConfirm question="You have 2 unsaved changes…" actions={…} />` and its options.
- No ✕ in a window header: the footer's
  `Cancel` closes it — every view of the window has a footer, even while loading: `<LoadingFooter />` = Cancel + the
  primary, disabled, in their loaded places, so nothing jumps when the data arrives. Esc and a click
  outside also close. `Window closeButton` is only for a window not yet on this recipe (Versions).
- A dense list inside a window (choose a repository, search results) stays panel-style: Row sm in a `Block`.

### Status, progress, failure, empty
- Loading (a window's first read, a list fetching, a form reading its values): the same atoms in their `skeleton`
  state — rows (`Row skeleton`, `ChoiceRow skeleton`) and fields (`Prop skeleton` = `Labeled` + `Field` skeleton) —
  the kit's loading state, no per-surface placeholder. Never a
  lone "Loading…" row, never hand-placed bars or guessed widths. A spinner row is only for an action in progress
  ("Checking <repo>…").
- Status: `right={[{ type: 'badge', label, variant }]}`, one per row.
- Progress: `<Row size="sm" title="Backing up…" left={[{ type: 'spinner' }]} rightText="43 / 112" />`, or `Button loading`.
- Failure: `<OperationNotice title detail action />`.
- Empty: `<EmptyState title="No backups yet" action={{ label: 'Back up now', onClick }} />`, with no extra caption.

### Before → after
```tsx
// ❌ a hand-made title, a subtitle, p-6, rows boxed in a bordered section, captions on every row
<Modal size="md" className="p-6">
  <h2 className="text-lg font-medium text-text">Custom domain</h2>
  <p className="mt-0.5 text-sm text-text-muted">Let visitors reach your site at an address you own.</p>
  <section className="rounded-outer border border-stroke divide-y divide-stroke">
    <Row title="studio-mara.com" caption="Your domain · 1 of 2 records found" … />
// ✅ use the Window recipe above: Window, label-on-top items, the decision in the footer
```

## Spacing spec (measured)
Pixels are judged by eye. These are numbers, checked on a real screenshot before anyone sees it.

| What | Panel | Window (Figma) |
|---|---|---|
| Title, radios, status → the edge | 12 | 16 |
| Option label → the edge; everything under the picked option → the edge | — | 48 |
| Under the picked option: above · below · right · between items | — | 8 · 16 · 24 · 16 |
| Label → its field; field → its helper | — | 4 · 4 |
| Text → the edge of any fill or border it sits in (field, notice, selected row) | 8 | 8 |
| Radio → its label | 8 (sm rows) | 16 (md option rows, 16px radio) |
| Icon → its label in a Row | 4 (sm) · 6 (md) | 16 (the 32px slot box) |
| Height: row · field/button · header · footer | 32 (trees 28) · 24 | 40 · 32 · 56 · 56 |
| Buttons side by side | 8 | 8; the footer's last button 8 from the right edge |
| Between sections | one `border-t`, or 8 | the header and footer rules only (`border-stroke`, as in Layers) |

The Publish window matches its Figma frame to the pixel: 57px header,
40px rows, 212px GitHub Pages group, 57px footer, 502px total. Hold any new window to the same check against its frame.

Never put Rows inside a bordered or filled box: the Row's own 4px padding lands the text 4px from the border. A Row that draws its own fill or border gets the inner padding above.

Measure it, don't eyeball it: in the screenshot spec, run this on the open surface and fix every line it prints.
```js
await page.evaluate(sel => {
  const root = document.querySelector(sel).getBoundingClientRect(); const out = [];
  for (const el of document.querySelectorAll(`${sel} *`)) {
    const t = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) || /^(INPUT|SELECT)$/.test(el.tagName);
    if (!t) continue;
    const r = el.getBoundingClientRect(); if (!r.width || el.closest('button')) continue; // a button's own padding is the kit's
    const left = r.left + (/^(INPUT|SELECT)$/.test(el.tagName) ? parseFloat(getComputedStyle(el).paddingLeft) : 0); // a field's text starts after its padding
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { // the nearest fill/border around the text
      const cs = getComputedStyle(p); const box = p.getBoundingClientRect();
      if (cs.borderLeftWidth !== '0px' || cs.backgroundColor !== 'rgba(0, 0, 0, 0)') {
        if (box.width < root.width - 2 && left - box.left < 8) out.push(`${Math.round(left - box.left)}px  ${el.textContent.trim().slice(0, 40)}`);
        break;
      }
    }
  }
  return out;
}, '[role="dialog"]');
```

## Done = screenshot review
Render it (in the real app, or a throwaway harness page that is never committed) and screenshot it. Put the screenshot
next to its Figma frame, or next to the Assets panel or the DesignBar for a panel, and tick every box:
- [ ] Same structure as the Figma: for a window, header · option rows · the picked option's items · footer.
- [ ] Nothing is larger or bolder than the recipe's type (a window title, a section-header Row title).
- [ ] Rows are one line, with at most one caption pattern per list; window settings have their label on top.
- [ ] 0 boxes around rows · 0 paragraphs · 0 headings.
- [ ] At most one live primary: bottom-right in a window footer (or the gating step, e.g. GitHub Log in, while the footer's
  decision waits disabled); panels have none.
- [ ] The left edges from the spacing spec (12px panel; 16px + 48px window); nothing centered except EmptyState.
- [ ] The spacing probe (Spacing spec above) prints nothing; the numbers in the spacing spec hold.
- [ ] Row actions stay hidden until hover, or live in a menu; a value's actions sit in its field.
- [ ] Squint test: would it pass as a screen from the same Figma file?

If any box is unticked, fix it before you report done. "It renders" is not "it fits".

## Red flags: stop and re-read the recipe
- You typed `text-sm`/`text-base`/`text-lg` or `font-medium` outside the kit and `publishParts`.
- `<h2>`/`<h3>`/`<p>` in chrome.
- `border … rounded` or `<Card>` around Rows.
- `caption=` on most rows.
- `p-5`/`p-6`/`space-y-5`/`mb-5`/`mt-6`; in a panel, any `p-4`/`gap-4`.
- A second live `variant="primary"` (a disabled footer decision next to the gating step's primary is fine).
- A column of identical buttons.
- `text-center` outside EmptyState.
- A Modal opened from a Modal.
- In a window: a label left of its value, a settings block below a list of choices, or a ⋯ account menu.
- A state the Figma doesn't show, designed from scratch: derive it from the same organization (the same items, label on top, 16px apart).
- "Premium" read as decoration: here it means precision (aligned columns, exact words, live states).
