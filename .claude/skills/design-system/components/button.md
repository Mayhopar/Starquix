# Button + IconButton

`import { Button, IconButton } from '@/components/ui'`

**Spec: the Figma Buttons page** — 204 variants: Style × Size × Type × State.

## Button
```tsx
<Button variant="primary|plain|secondary|outline|ghost|link|danger"
        size="lg|md|sm"            // Large 40 / Medium 32 / Small 24
        label="Save" icon={<X/>} iconRight={<Y/>}
        iconOnly                    // square; REQUIRES aria-label
        active loading disabled className />
```

| Figma axis | Kit |
|---|---|
| Style Primary · Plain · Secondary · Outline · Transparent · Link | `primary` · `plain` · `secondary` · `outline` · `ghost` · `link` (`danger` has no Figma twin) |
| Size Large · Medium · Small | `lg` · `md` · `sm` |
| Type Text · Icon Text · Text Icon · Icon | `label` · `icon` + `label` · `label` + `iconRight` · `iconOnly` (only `iconOnly` is square) |
| State Default · Hover · Disabled | rest · `:hover` · `disabled` |

### Geometry (the Button owns it — never pass size, padding or radius classes)
Radius `4px` (`rounded-inner`) on every button, icon-only included. Font regular 400 (`font-normal` — it sits next to 1px icon strokes).

| Size | Text | Icon Text (icon, label) | Text Icon (label, icon) | Icon |
|---|---|---|---|---|
| `lg` 40 | px 20 · py 10 · 14/20 | pl 10 · pr 16 · gap 8 · icon 20 | pl 16 · pr 10 · gap 8 · icon 20 | 40×40, p 10, icon 20 |
| `md` 32 | px 20 · py 8 · 12/16 | pl 10 · pr 16 · gap 4 · icon 16 | pl 16 · pr 10 · gap 4 · icon 16 | 32×32, p 8, icon 16 |
| `sm` 24 | px 16 · py 4 · 12/16 | pl 8 · pr 12 · gap 4 · icon 16 | pl 12 · pr 8 · gap 4 · icon 16 | 24×24, p 4, icon 16 |
| `link` | p 0 · height = the line (20 `lg`, 16 otherwise) · gap 2 | | | 20 / 16 square |

- Icons: pass them as usual (`<PlusIcon className="w-4 h-4" />`); the Button puts them in its slot size (20px in
  `lg` through `.sq-icon-slot.sq-icon-size-20`, 16px otherwise).
- Outline's stroke is an inset ring (`inset-ring`): the Figma draws the stroke inside the box, so it adds no width.
  Recolor it with `inset-ring-*` / `hover:inset-ring-*` — a `border-*` color override does nothing (no border width).
  A dashed edge needs a real border: `inset-ring-0 border border-dashed border-stroke`.
- `loading` swaps the leading icon for a spinner of the same slot size and disables.
- `children` is a legacy alias for `label` — don't use in new code.

### Paint (the Figma, both modes; tokens named after its variables)
Opacities are the atom's (raw per node in the Figma); colors are tokens `btn-{style}-{fill|text|stroke}-{state}`.

| Style | Rest | Hover | Disabled |
|---|---|---|---|
| `primary` | `bg-btn-primary-fill-default` · `text-btn-primary-text-default` | `bg-btn-primary-fill-hover` | `bg-btn-primary-fill-disabled/10` · `text-btn-primary-text-disabled/40` (#ca8a04, both modes) |
| `plain` | `bg-btn-plain-fill-default` #292524 / Dark #e7e5e4 · `text-btn-plain-text-default` #f5f5f4 / #292524 | `bg-btn-plain-fill-hover` #1c1917 / #d6d3d1 | pending (fade until the Figma defines it) |
| `secondary` | `bg-btn-secondary-fill-default` #e7e5e4 / Dark #44403c · `text-btn-secondary-text-default` #292524 / #f5f5f4 | `bg-btn-secondary-fill-hover` #d6d3d1 / Dark #57534e (override: the Figma's #292524 = the window) | pending (fade until the Figma defines it) |
| `outline` | no fill · inset ring `stroke` (pending) · `text-btn-outline-text-default` #292524 / Dark #f5f5f4 | `bg-bg-hover` (pending) | `text-btn-outline-text-disabled` #d6d3d1 / #57534e |
| `ghost` (Figma "Transparent") | no fill · `text-btn-ghost-text-default` #292524 / Dark #f5f5f4 — ink at rest, not muted | `bg-btn-ghost-fill-hover/50` (#e7e5e4 / Dark #78716c, at 50%) | `text-btn-ghost-text-disabled` #d6d3d1 / #57534e |
| `link` | pending | | |
| `danger` | ours (no Figma twin) | | fade |

- Primary keeps the app's yellow fill and hover; its label is the Figma's #422006 (both modes).
- A disabled button gets its style's own recipe, never `opacity-50` on top of it; only styles without a Figma recipe
  yet fade as a whole.
- Dark values come from the design file's variable export; the harness measures both modes to 0 diffs.

## IconButton
20px (`sm`) / 24px (`md`) square, `rounded-sm`, `bg-bg-contrast`; `active` uses
primary tokens. For icon actions INSIDE inputs/toolbars. For standalone icon
actions ≥24px use `<Button iconOnly>`. (No Figma counterpart yet.)

## Don't
- No raw `<button>` anywhere in components/pages (lint error).
- No per-call-site color, size, padding or radius classes — pick the variant and size that match intent.
