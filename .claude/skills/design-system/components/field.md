# Field + presets + InputGroup

`import { Field, SearchField, UnitField, InlineEdit, InputGroup } from '@/components/ui'`

## Field
```tsx
<Field value onChange
       label="W"            // 16×16 leading slot; word labels: also pass aria-label
       icon={<OpacityIcon/>} // takes precedence over label
       unit="px"            // trailing text (alias: suffix); prefix="https://"
       trailing={<btn/>}    // trailing node (alias: rightSlot); leftSlot aliases icon
       error="Taken"        // boolean → border only; string → border + message line
       mono caption size="sm|md" disabled placeholder
       type="text|number|date|password" min max step onKeyDown onBlur onFocus />
<Field as="select" options={[{value,label}]} placeholder showChevron />
<Field as="textarea" value onChange rows={4} onKeyDown onBlur onFocus aria-label="Description" />
```
- Numeric fields get universal ↑/↓ (±1) and Shift+↑/↓ (±10) stepping unless you
  pass your own `onKeyDown`.
- `InputContainer` is internal — never import it in new code.

## Window fields (the Figma Input)
```tsx
<Labeled label="Address" caption="Going live… about a minute" error={err}>   // label text-xs text-secondary (dimmed by the token), 4px above; helper/error 4px below
  <InputGroup layout="row" gap={2}>
    <Field size="lg" readOnly value={url} onChange={() => {}} aria-label="Address" className="flex-1"
      trailing={<Button variant="ghost" size="sm" iconOnly aria-label="Open site" icon={<LinkIcon className="w-4 h-4" />} … />} />
    <Button variant="outline" size="md" label="Change" … />                  // a text action: outline md, after the field
  </InputGroup>
</Labeled>
```
- `size="lg"`: 32px, `text-sm` value, `bg-input-fill-window` (Light: transparent, outlined on the window surface; Dark: half a step lighter than the surface, #363230), value 8px inside the border,
  24px slots that hold icon buttons (link, chevron) and badges; helper/error lines `text-xs`.
- `readOnly`: a value the user reads or copies (address, repository, account) — selectable, not editable. `onClick` on a
  read-only field opens its menu (pointer cursor); keep the chevron button for the keyboard.
- `Labeled` frames ANY control (Field, Button, SegmentedControl, an InputGroup of them); it passes `title`/`data-testid`
  through. Never hand-write a label `<span>` above a control.
- `size="sm"`/`"md"` (24/28px, filled `bg-input-fill`: white in Light, #363230 in Dark) stay the panel fields.
- Every field's edge is `border-input-stroke` (Light = Stroke/Default; Dark = Stroke/Darker #44403c — Stroke/Default is
  #363230 in Dark, the fill's own color). Field-looking triggers (the font and color pickers, the text-align group,
  radios, icon buttons inside fields, the SegmentedControl track) use the same two tokens — never `bg-bg-contrast`. A
  hand-rolled field box outside the kit does too; `styles/__tests__/inputFill.test.ts` fails on one painting
  `bg-bg-contrast`.
- Loading state: `<Labeled label="Address" skeleton><Field size="lg" skeleton … /></Labeled>` — the label becomes a bar
  of its own width (no helper line), the field its own 24/28/32px box pulsing (no input). In a window form that is
  `<Prop label="Address" skeleton />`. Wrap the set in `role="status"` + an `aria-label`.

## Presets (FieldPresets.tsx)
- `SearchField` — search icon + clear button (`value`, `onChange`, `autoFocus`).
- `UnitField` — numeric + unit suffix (replaces SpacingBlock's clones).
- `InlineEdit` — click-to-rename text: `value onCommit editing onEditingChange`;
  Enter/blur commits (non-empty + changed), Escape cancels.

- `as="textarea"` preserves multiline strings, forwards a textarea ref/events, and uses the native Field shell with content height. `type="date"` is for date-only strings; full timestamps use text so timezone/seconds remain intact. Numeric stepping applies only to `type="number"`.

## InputGroup
`<InputGroup layout="dual|quad|row" gap={1|2|4}>` — X/Y pairs, T/R/B/L quads.

- `type="password"` uses native input masking for tokens and other secret values; change events still return the exact string. It defaults to `autoComplete="new-password"` so the browser never autofills a saved password into a token field (override with `autoComplete`).
