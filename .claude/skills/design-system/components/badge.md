# Badge + Swatch

`import { Badge, Swatch } from '@/components/ui'`

## Badge — status pill
```tsx
<Badge variant="default|success|warning|error|info|accent" size="md|sm">3 orphaned</Badge>
```
- md = text-2xs, sm = text-3xs; rounded-full; semantic `-subtle` backgrounds.
- Also available as a Row slot: `{type:'badge', label, variant}`.

## Swatch — color preview chip
```tsx
<Swatch color={anyCssColor} size="sm|md|lg" title onClick />
```
- Alpha checkerboard underlay; `border-stroke`; inline style carries the color
  (user-document data — exempt from the palette lint).
- Also a Row slot: `{type:'swatch', color}`.

## Don't
- No bespoke `rounded-full text-[10px]` pills; no `w-4 h-4 border` color chips.
