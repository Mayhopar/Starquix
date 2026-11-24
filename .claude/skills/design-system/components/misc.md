# EmptyState · FloatingPanel · Dropzone · Card · Tooltip · Skeleton

`import { EmptyState, FloatingPanel, Dropzone, Card, Tooltip, Skeleton } from '@/components/ui'`

## EmptyState
```tsx
<EmptyState icon={<DbIcon/>} title="No tables yet" caption="…"
            action={{label:'New table', onClick}} />
```

## FloatingPanel
Free-floating chrome surface (footer flyouts, telemetry, zoom menu):
`bg-bg border-stroke rounded-outer shadow-flyout z-flyout`. Position it
yourself via `className`/`style` (geometry inline styles are fine).

## Dropzone
```tsx
<Dropzone onFiles={files=>…} accept="image/*" multiple disabled>
  <UploadIcon/> Drop image or click to browse
</Dropzone>
```
Click, keyboard (Enter/Space) and drag-drop all work; drag-over highlights.

## Card
`<Card interactive selected onClick>` — dashboard card shell
(`bg-bg-contrast border-stroke rounded-outer`).

## Skeleton · SkeletonText
**A loading list is its own rows with `<Row skeleton>`** (row.md) — the kit draws the shapes in the real geometry. Use
these two directly only for shapes that aren't rows:
- `<Skeleton className="w-4 h-4 rounded-full" />` — a pulsing `bg-stroke` placeholder, `aria-hidden`. Size AND radius
  come from `className` (no default radius: cx's twMerge doesn't know `rounded-inner`/`rounded-outer`, two would race).
- `<SkeletonText line="h-5">GitHub Pages</SkeletonText>` — the words, transparent, on a pulsing bar: exactly as wide as
  they will be. Never guess a width.

## Tooltip
`<Tooltip content="…">{trigger}</Tooltip>` — portal to body, 400ms delay,
never clipped by overflow ancestors. String content only. Keyboard focus (`:focus-visible`) on a focusable trigger
shows it at once, and while it shows the trigger is `aria-describedby` the tip (`role="tooltip"`).
