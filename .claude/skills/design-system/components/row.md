# Row — THE list atom

`import { Row } from '@/components/ui'` (`ui/Row.tsx`)

Every list-like piece of chrome: layers tree rows, panel lists (Pages/Assets/
Collections/Database), DesignBar section headers, SEO rows, menu-ish rows.

## API
```tsx
<Row
  title caption rightText                 // title: ReactNode
  left={[{type:'chevron', expanded, onToggle}, {type:'icon', icon:<X/>}]}
  right={[{type:'toggle', value, onChange}, {type:'custom', node, unboxed:true, showOnHover:true}]}
  size="md|sm"                            // md h-10/h-14, sm h-8/h-12; tree rows: className="h-7"
  selected disabled
  skeleton                                // the loading state (below)
  hover={false}                           // suppress bg hover (section headers)
  expandable expanded onExpandChange      // controlled; uncontrolled starts expanded (defaultExpanded)
  depth={n}                               // tree indent: 8 + n*20 px
  dnd={{id, dragType}}                    // requires <SortableTreeProvider>; renders drop indicators
  onClick onDoubleClick onContextMenu
  className                               // twMerge — your overrides win
>{expandedContent}</Row>
```

## Loading state: `skeleton`
A list that is still loading renders ITS OWN rows — same props, plus `skeleton` — never a hand-built placeholder:
- every typed slot becomes a pulsing shape in the control's own box (radio, checkbox, toggle, icon, badge…); a
  `custom` slot draws the shape its spec declares (`skeleton: 'w-44 h-6 rounded-inner'`), else nothing; `showOnHover`
  slots render nothing — so loaded rows land exactly on their placeholders;
- `title`, `caption` and `rightText` become bars exactly as wide as their words (`SkeletonText`: the real text,
  transparent) — pass the real or a typical title, never a width;
- the row is not interactive and is `aria-hidden`: wrap the list in `role="status"` + an `aria-label`.
When the rows depend on data that isn't there yet, declare the loading rows next to the real ones with typical
content (their words are invisible; only the bar widths show). Examples: `DestinationList skeleton`
(`DeployModal/publishParts.tsx`), the repository list (`RepoChooser.tsx`), `VersionsSkeleton` (`VersionPanel.tsx`);
fields: `Prop skeleton` (field.md).

## Slot rules
- `left`/`right` take `RowSlotSpec[]` (see slot.md) or a raw ReactNode (legacy).
- Hidden slot = omit the spec; slots never reserve space when absent.
- Every typed control stops propagation — never fires the row `onClick`.
- `showOnHover` on right slots reveals actions on row hover.

## Do / don't
- DO use `dnd` + `depth` for trees; drop-indicator/drag states are built in.
- DO `hover={false}` for static section headers.
- DON'T build a row from divs; DON'T nest interactive rows.
- DON'T use `leftIcons`/`rightIcons`/`draggable` in new code (deprecated aliases).

## Migration recipe
- `TreeRow` → `Row` with `depth`, `left=[{type:'chevron',…},{type:'icon',…}]`, `className="h-7 …"`.
- Old `DesignBar/inputs/Row` semantics = ui/Row with `hover={false}`.

## rowProps escape hatch
`rowProps` spreads extra attributes onto the inner row div — for `data-*`
attrs (test ids, element ids) and external dnd `setNodeRef`-style listeners in
trees that keep their own drag wiring instead of `dnd`. Never put styling there.

Drag grips use the shared `GripIcon` artwork from `@/assets/icons`.
