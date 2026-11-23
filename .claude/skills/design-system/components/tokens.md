# Token contract (theme.css)

Kit + all chrome consume ONLY these. **Values are Tailwind palette steps — never hex.** They follow the
Figma's variables (the Starquix UI design file), whose hex ARE the v3 stone/yellow/red steps; Tailwind v4's oklch palette renders a few
units off them (yellow-500 #f0b100 vs #eab308; red-500 #fb2c36 vs #ef4444) — accepted. The hex in the tables below are the
Figma's reference values, not what the CSS holds. Tokens the Figma has no variable for stay ours. Editing the system =
editing `app/src/styles/theme.css`.

**Structure (theme.css):** one `@theme static` block, **one line per token**: `--color-NAME: light-dark(LIGHT, DARK);`
(a plain value = the same in both modes). `NAME` is the utility (`--color-bg-hover` → `bg-bg-hover`); raw CSS and inline
styles read `var(--color-NAME)` — never a bare `var(--bg)`. Add or change a token = edit its one line. `.dark` on `<html>`
flips `color-scheme`, which is what `light-dark()` reads (Chromium 123+; Electron 38 is 140). The tables below show the same
values the lines hold.

## Surfaces & text (Figma variable → token)

| Figma variable | Token (utility) | Light | Dark |
|---|---|---|---|
| Background/Bg | `bg-bg` | #fafaf9 | #292524 |
| Background/Bg Contrast | `bg-bg-contrast` | #ffffff | #1c1917 |
| Background/Hover | `bg-bg-hover` | #f5f5f4 | stone-700 @ 20% |
| Background/Selected | `bg-bg-selected` | #e7e5e4 | stone-700 @ 50% |
| Text/Default | `text-text` | #292524 | #e7e5e4 |
| Text/Secondary | `text-text-secondary` | #78716c | #78716c |
| Active/Secondary | `text-text-muted` | #57534e | #a8a29e |
| Active/Secondary Hover | `text-text-muted-hover` | #44403c | #d6d3d1 |
| Text/Disabled | `text-text-disabled` | #d6d3d1 | #44403c |
| Text/Error · Stroke/Error | `text-error` · `border-error` | #ef4444 | #ef4444 |
| Stroke/Default | `border-stroke` | #e7e5e4 | #363230 |
| Stroke/Darker | `border-stroke-darker` | #d6d3d1 | #44403c |
| Stroke/Active | `border-stroke-active` | #eab308 | #eab308 |

Source: the design file's variable export (Light/Dark W3C token files); the Toggle/*
variables join with the Toggle atom.

Inputs (ours; override: in dark mode an input's fill is half a step lighter than the surface, never darker):
`bg-input-fill` (panel fields, radios, inline edits, icon buttons in fields: #ffffff / Dark #363230) ·
`bg-input-fill-window` (Field lg: transparent / Dark #363230) · `border-input-stroke` (Stroke/Default / Dark #44403c).

Ours (no Figma variable): `bg-input-editing` `border-stroke-component` (purple) · `dynamic` (yellow) ·
`slot` (cyan) identities.

Text selection (ours): `bg-text-selection` = `accent` @ 45% — the platform's accent tint, one recipe for both modes.
`::selection` (globals.css) paints it and draws the selected text in `text`; the terminal's selection reads the same pair
(`TerminalView.themeOf`). A block with its own fill + ink (the post editor's code block, a colored band) keeps that ink:
`::selection { color: currentColor }`. Guard: `styles/__tests__/themeSelection.test.ts` — on every surface the tint is
≥ 20 ΔE from the surface and the text ≥ 4.5:1 on the tint; a new surface that holds selectable text joins its list.

## Buttons
Named after the Figma variables `Buttons/{Style}/{Fill|Text|Stroke}/{State}`:
`btn-primary-fill-{default|hover|disabled}` `btn-primary-text-{default|disabled}` ·
`btn-plain-fill-{default|hover}` `btn-plain-text-default` ·
`btn-secondary-fill-{default|hover}` `btn-secondary-text-default` · `btn-outline-text-{default|disabled}` ·
`btn-ghost-fill-hover` `btn-ghost-text-{default|disabled}` (Figma style "Transparent") ·
ours, no Figma twin: `btn-ghost-active` (a pressed ghost toggle), `btn-danger(-hover|-text)`.
Values are the Figma's Tailwind steps in both modes (Primary's fill + hover stay the app's yellow).

## Semantic (green/amber/red/blue-500 aliases)
`success` `warning` `error` `info` + `-subtle` bg variants (15% color-mix) ·
`accent` (blue-400, toggles/expanded) · `accent-strong` (blue-500, focus rings & drop indicators) ·
`dynamic` (amber-500 light / amber-400 dark — dynamic-content identity: blog/database/
layout/page-template/content-bound. NOT for warnings — that's `warning`. Predicate:
`isDynamicComponent`/`buildDynamicComponentIndex` in `store/folderManifest.ts`.) ·
`slot` (cyan-500 light / cyan-400 dark — slot identity).
**Identity rule:** an identity color (`stroke-component` purple, `dynamic` yellow, `slot` cyan)
applies to icon AND label together on Assets/Layers rows — never icon-only. The DesignBar
heading is deliberately NEUTRAL (`text-text`) for every selection kind.

## Canvas overlays
`overlay-selection` (yellow-500) · `overlay-component` (cyan-500) · `overlay-ai` (purple-500) · `overlay-grid` (red-500 — the alignment grid, `LayoutGridOverlay`; always translucent: `bg-overlay-grid/15`) · `overlay-measure` (red-500) + `overlay-measure-text` (white) — Option-hover distance lines and their labels, `MeasureOverlay`

## Terminal (the MCP-mode xterm — read by `TerminalView.themeOf`)
`term-black … term-white` + `term-bright-black … term-bright-white` — the 16 ANSI colors, one `light-dark()` of palette steps each. xterm's own palette is made for a dark screen (white 1.4:1, bright-white 1.1:1 on the light Bg). Light = the 600/700 steps (≥3:1 on Bg); dark = the 300/400 steps; `white` = muted text, `bright-white` = the strongest. Guard: `styles/__tests__/themeTerminal.test.ts`.

## Font
The chrome font is **Inter** (the Figma's font), bundled as variable woff2 files in
`app/src/assets/fonts/inter/` (`@fontsource-variable/inter` 5.3.0, OFL) and set as Tailwind's `--font-sans`
(family `'Inter Variable'`) in theme.css — the desktop app needs no network. Weights: Regular 400 for buttons
(`font-normal`, owned by the Button) and layer/row titles (a medium label's stem — 1.37px at 12px, 1.60px
at 14px — outweighed the 1px icon strokes beside it; regular is 1.15px / 1.33px), Medium 500 for emphasized text (window
titles, tabs, badges; medium replaces the Figma's Semi Bold 600).

## Type (theme.css TYPE section — every value is a variable there, components only name a style)
| Class | Size / line-height | Weight | Source |
|---|---|---|---|
| `text-3xs` · `text-2xs` | 10/12 · 11/14 | inherits | ours, no Figma twin |
| `text-xs` · `text-sm` | 12/16 · 14/20 | inherits (400 from the page) | Figma text-xs / text-sm |
| `text-lg` | 18/28 | 500 | a window's title (the Figma's text-lg is 600 — we use medium) |
| `text-3xs-medium` · `text-2xs-medium` · `text-xs-medium` · `text-sm-medium` | as plain | 500 | ours (the Figma's text-sm-semibold, at 500) |

Weights are `--font-weight-normal` 400 and `--font-weight-medium` 500 (utilities `font-normal`, `font-medium`; the medium
styles read the same variable). `semibold` (600) is not a chrome weight — Tailwind still defines it by default, only for the
DesignBar weight picker that writes it into the user's site; the UI lint rejects `font-semibold` in components. `text-xs`/`text-sm`
stay size-only on purpose: setting a weight would reset a medium parent's weight on every child. Modifiers (`uppercase`, `capitalize`, `italic`, `tabular-nums`, `font-mono`, `leading-*`,
`tracking-*`) are plain classes. Off-scale one-offs (`text-base`, `text-3xl`) are baselined in the UI lint, not endorsed.
`text-[12px]`→`text-xs`, `text-[13px]`→`text-sm`, `text-[10px]`→`text-3xs`, `text-[11px]`→`text-2xs`.
Lint: `raw-weight` (font-light/semibold/bold…) and `raw-text-size` (text-base+) join `raw-text-px`; `styles/__tests__/themeType.test.ts`
fails if a `text-<size>-<suffix>` class has no variable (a typo would silently inherit).

## Radius / shadow / z
`rounded-outer` 6px (modals, cards, floating panels — no Figma variable read yet) · buttons use `rounded-inner` (the Figma's `4px`) ·
`rounded-inner` 4px (fields, popovers, segments) · `rounded-full` pills/knobs only.
`shadow-flyout` (popovers, tooltips, floating panels) = the Figma's shadow/lg `0 4px 6px -2px #0000000d, 0 10px 15px -3px #0000001a` · `shadow-modal` (ours; the Figma window's effect is unread). The Figma's Card/Elevation (`0 16px 28px #00000012, 0 6px 12px #0000000f`) belongs to the Toggle knob.
`z-overlay` 40 (canvas overlays) · `z-flyout` 1000 · `z-modal` 9999 · `z-debug` 99999.

## Don't
- `bg-blue-500`, `text-white`, `bg-neutral-900`, hex, `text-[13px]`, `z-[9999]`, `shadow-lg` — all lint errors.
- Inline `style={{}}` for anything except geometry/positioning or user-document data (colors from the doc are fine).
