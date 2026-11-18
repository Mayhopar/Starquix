# Slot — typed slot controls

`import { renderSlot, SlotBox, Spinner } from '@/components/ui'` (`ui/Slot.tsx`)

Fixed bounding box: 16×16 (`w-4 h-4`) for both row sizes.

## Typed set (closed)
| type | props |
|---|---|
| `icon` | `icon`, `iconSize?` (16 or 24), `className` |
| `chevron` | `expanded`, `visible?`, `onToggle` — rotates −90° when collapsed |
| `checkbox` / `radio` | `checked`, `onChange`, `disabled`, `aria-label` — the radio is the Figma Radiobutton: a 16px `bg-bg-contrast` circle with a `stroke-darker` ring, checked = an 8px `text-muted` dot; never the platform's tinted radio. sm rows: radio/checkbox 8px from the label; md rows (window option rows): the radio 16px from the label |
| `toggle` | `value`, `onChange`, `disabled`, `aria-label` — 28×16 switch |
| `swatch` | `color` (any CSS color; alpha checkerboard) |
| `badge` | `label`, `variant` |
| `spinner` | — |
| `custom` | `node`, `unboxed?` — escape hatch, still boxed unless `unboxed` |

All specs accept `showOnHover` when used in Row `right`.

`renderSlotSkeleton(spec, size)` — the slot's loading shape for Row `skeleton`: the same outer box (size + margins) as
the real control, as a `Skeleton`. A `custom` slot has no known size: give its spec `skeleton: '<w-* h-* rounded-*>'`
(e.g. a 176px select: `'w-44 h-6 rounded-inner'`) or it draws nothing.

## Rules
- `custom` is the ONLY escape hatch and is grep-able — prefer a typed control.
- `unboxed: true` only for content that is intentionally wider (e.g. a Button).
- Controls stop propagation themselves; don't wrap them in extra click guards.

Icon slots carry `sq-icon-slot` and `sq-icon-size-*` so theme.css sets both size
and which drawing (.sq-g16 / .sq-g24) is shown. `iconSize` accepts only 16 or 24 and defaults to 16
for all row sizes, including layers. A 24px icon box contains 20px artwork
with 2px padding per side. Carrier/hit areas are separate.
