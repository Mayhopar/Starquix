# Tabs + SegmentedControl

`import { Tabs, TabPanel, SegmentedControl } from '@/components/ui'`

## Tabs — underline style (page/panel level)
```tsx
<Tabs options={[{value,label,title?}]} value onChange size="md|sm" />
```

## SegmentedControl — boxed group (property values)
```tsx
<SegmentedControl options={[{value,label?,icon?,title?,dropdown?:[{value,label}]}]}
                  value onChange showChevron size="md|lg" />
```
- `size="md"` 28px (panels); `size="lg"` 32px — the height of a window's `Field size="lg"` (e.g. Visibility in Publish).
- A segment with `dropdown` becomes a menu trigger (uses Popover+MenuItem).
- It is an input: the track paints `bg-input-fill` (white; Dark #363230, half a step above the surface)
  `rounded-inner`; the picked segment wears the Figma Segmented page's Buttons/Secondary fill
  (`bg-btn-secondary-fill-default` + `text-btn-secondary-text-default`: #e7e5e4 / Dark #44403c). The Segmented page's
  full read (outlined track?) is pending.

## When which
- Navigation between views → Tabs.
- Choosing a property value (display mode, fit, alignment) → SegmentedControl.
