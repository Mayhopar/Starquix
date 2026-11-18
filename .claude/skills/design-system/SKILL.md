---
name: design-system
description: MANDATORY before building, modifying or reviewing ANY app/editor UI (components/, pages/) — panels, lists, forms, windows/modals, menus, badges, notices, overlays, chrome — and whenever a screen looks off, heavy, wordy, or unlike the rest of the editor. Never write app UI without invoking this skill.
---

# Starquix Design System

All app chrome is composed from the closed primitive kit at
`app/src/components/ui/` plus the token layer in `app/src/styles/theme.css`.
Ad-hoc UI is a lint error (`app/scripts/lint-ui-consistency.mjs`, ratchet
baseline — violations may only shrink).

## Figma is the spec

The kit follows the Starquix UI design file (Figma): tokens are named after its variables, atoms equal its variant
matrices. Never invent a dark value: dark values come only from the design file's dark frames or its variable export.

**Precision rules.**
1. The Figma wins on every value it defines. "Close enough" is a bug (6px vs 4px, stone-900 vs #292524, opacity-50
   vs a 10%/40% disabled recipe).
2. Read every variant and state of an atom, not one per family. Layer opacity, visibility, strokes, effects, padding
   and gaps are part of the spec.
3. A value bound to a Figma variable becomes a token named after the variable path (Buttons/Primary/Fill/Disabled →
   `--color-btn-primary-fill-disabled` → `bg-btn-primary-fill-disabled`), valued with the Tailwind palette step the
   Figma variable names (stone/750 → `--color-stone-750`) — NEVER hex. Tailwind
   v4's oklch palette renders a few units off the Figma's v3 hex (yellow-500 #f0b100 vs #eab308, red-500 #fb2c36 vs #ef4444);
   that is accepted.
4. Read both modes; a raw value that isn't bound to a variable is listed and asked about.
5. Prove it with numbers: render the atom's whole variant matrix in a throwaway harness page (never committed), read
   `getComputedStyle` per cell (background, color, stroke, radius, height, padding, gap, font, opacity — composite
   layer opacities into the colors) and diff it against the Figma's values to zero; then compare screenshots against
   the design file, light and dark.
6. A Figma value that looks accidental is asked about — not copied, not silently fixed.
7. Fix it in the system (theme.css tokens, `components/ui/*`), never on one screen.

## Culture first — REQUIRED: read `components/culture.md`

**The Figma is the spec.** culture.md says how the design file is organized and how each Figma atom maps to the kit.

**Kit-correct is not the same as right.** A screen can pass lint and be built
only from `Row`s and still look wrong when you add size, boxes or words
between the pieces. This is the #1 failure, and it has happened with this skill
loaded. Before you compose any surface, read `components/culture.md` and copy its
recipe. The short version:
- panels: one-line rows; windows: the Figma window (option rows, the picked option's items unfold under it with the
  label on top of a 32px field)
- the kit owns the type (you never write `text-sm`/`base`/`lg` or `font-medium`)
- no boxes around rows
- no paragraphs or headings
- ghost buttons, at most one primary
- one left edge (panels 12px; windows 16px + the 48px label column)
- never ask: a delete acts at once and ⌘Z brings it back

Done = the screenshot checklist in culture.md, not "it renders".

## Hard rules

1. **Never write UI without this skill loaded.** culture.md is part of the
   contract. Breaking it breaks this skill, even when lint passes.
2. **Read the sub-doc of every component you are about to use** (below,
   `components/*.md`) — APIs and do/don'ts live there, not in your memory.
3. **Tokens only.** No raw palette classes (`bg-blue-500`), no `text-[Npx]`,
   no `z-[N]`, no `shadow-md/lg/xl/2xl`, no hex colors in chrome. Everything
   styles through theme.css tokens: `bg-bg`, `bg-bg-contrast`, `border-stroke`,
   `text-text-*`, `btn-*`, semantic `success/warning/error/info` (+`-subtle`),
   `accent`, `accent-strong`, overlay tokens (`overlay-selection`,
   `overlay-component`, `overlay-ai`, `overlay-grid`), `text-2xs`/`text-3xs`, `rounded-outer`
   (6px) / `rounded-inner` (4px) / `rounded-full`, `shadow-flyout`/`shadow-modal`,
   `z-overlay`/`z-flyout`/`z-modal`/`z-debug`.
4. **No raw `<button>`** outside `ui/` — use `Button`, `IconButton`, or `MenuItem`.
5. **Editing the look of the system = editing theme.css**, never per-call-site classes.
6. **Class-GENERATION code is exempt** (DesignBar emitting user-document
   classes like `bg-[#ff0000]`): mark the file `// ui-lint-exempt: <reason>`
   or a single line `// ui-lint-line: <reason>`.

## Decision tree

| You are building… | Use |
|---|---|
| Any list row, tree item, section header, panel entry | `Row` (typed `left`/`right` slots; `depth`+`dnd` for trees) |
| A clickable action | `Button` (variant `primary/secondary/outline/ghost/link/danger`) |
| A compact 20–24px icon action inside inputs/toolbars | `IconButton` |
| Text/number/select input | `Field` (presets: `SearchField`, `UnitField`, `InlineEdit`; group with `InputGroup`) |
| A setting in a window (the Figma Input: label on top, 32px field, helper below) | `Labeled` + `Field size="lg"` (a read-only value: `readOnly`) — or `Prop` from `DeployModal/publishParts.tsx` |
| A dropdown menu | `Menu` + `MenuItem` (never hand-roll an absolute-positioned list) |
| Any positioned flyout | `Popover` (controlled `isOpen/triggerRef` or uncontrolled `trigger`) |
| A dialog | `Modal` (sizes `sm/md/lg/auto`) |
| Tab strip | `Tabs`; mutually-exclusive option group → `SegmentedControl` |
| Status pill / count chip | `Badge`; color preview → `Swatch` |
| "No X yet" block | `EmptyState` |
| Content still loading (a window's first read, a list fetching, a form reading values) | the same atoms with `skeleton` — `Row`, `Labeled` + `Field` (window forms: `Prop skeleton`); a `custom` slot declares its `skeleton` shape — `Skeleton`/`SkeletonText` only for shapes that aren't rows or fields; never a lone "Loading…" row |
| Free-floating panel (footer flyouts, debug panels) | `FloatingPanel` |
| File drop target | `Dropzone` |
| Dashboard card | `Card` |
| Hover hint | `Tooltip` |
| A window/dialog (header · body · footer) | `Window` + `Pane` (+ `Status`, `Prop`, `Form`, `DestinationList`) from `components/DeployModal/publishParts.tsx` — the Figma Window recipe in culture.md; the kit `Modal` is only the shell |
| A pick-one choice whose options have settings | option rows; the picked option's items right under its row (culture.md Law 9, `DestinationList`) |
| A panel section with actions | Header `Row` + ghost `iconOnly` Buttons in `right` (culture.md) |
| A delete or other destructive action | Act at once; ⌘Z brings it back (culture.md Law 6) — never a question, never a native `confirm` |
| Drag-and-drop tree wiring | `SortableTreeProvider` + `Row dnd` (see sortable-tree.md) |

Escape hatch: `{ type: 'custom', node }` slot in Row — still gets the enforced
bounding box; grep-able. `className` pass-through uses twMerge, so your
Tailwind overrides win — but they must still be token classes.

## Sub-docs (read before use)

- components/culture.md — **how chrome looks**: scale, laws, recipes, screenshot checklist (read FIRST)
- components/tokens.md — the full token contract
- components/row.md, components/slot.md, components/sortable-tree.md
- components/button.md (Button + IconButton)
- components/field.md (Field + `size="lg"` + SearchField/UnitField/InlineEdit + InputGroup + Labeled)
- components/popover.md (Popover + Menu/MenuItem)
- components/modal.md, components/tabs.md (Tabs + SegmentedControl)
- components/badge.md (Badge + Swatch)
- components/misc.md (EmptyState, FloatingPanel, Dropzone, Card, Tooltip)
- components/operation-notice.md — OperationNotice for scoped operation feedback

## Contribution rules

Adding/changing a kit component requires, in the SAME commit:
1. the component under `components/ui/` with unit tests in `ui/__tests__/`,
2. its sub-doc here created/updated,
3. `ui/index.ts` export,
4. lint still green (`npm run lint:ui-consistency` — the script also fails if
   a ui/ component has no sub-doc).

The old primitive libraries (`components/common/`, `DesignBar/inputs/`,
`DesignBar/shared/`) are deleted — import from `@/components/ui`.
