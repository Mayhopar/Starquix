# Popover + Menu/MenuItem

`import { Popover, Menu, MenuItem } from '@/components/ui'`

## Popover — THE positioning engine
Portal to body, viewport flip + clamp, click-outside + Escape close.
Tokens: `bg-bg border-stroke rounded-inner shadow-flyout z-flyout`.

```tsx
// Controlled (preferred for editor chrome):
<Popover isOpen={open} onClose={close} triggerRef={btnRef}
         placement="bottom-start|bottom|bottom-end|top…" offset={4}
         width={number|'trigger'|'auto'} maxHeight={400} zIndex={…} />
// Uncontrolled:
<Popover trigger={<Button …/>}>{content}</Popover>
```
`zIndex` prop is an escape hatch only; a Popover inside a `Modal` already
stacks above it (the Modal provides the layer).

**Nesting is supported:** a Popover (e.g. a `ColorPicker`) rendered inside
another Popover registers with its ancestors, so a click inside the child's
panel never closes the parent. A real outside click still closes all of them.
A `Modal` takes part the same way: a Popover/Menu inside it registers with it.

**A hidden trigger closes it:** on scroll / resize a Popover whose trigger left
the layout (`display: none` on it or an ancestor — the sidebars hidden with ⌘\)
calls `onClose` instead of jumping to the window corner. ⌘\ moves the chrome
without a window resize, so Editor dispatches `resize` for it.

## Menu = Popover + MenuItem rows
```tsx
<Menu isOpen onClose triggerRef>
  <MenuItem label="Rename" icon={<PencilIcon/>} shortcut="⌘R" onSelect={…} />
  <MenuItem label="Delete" danger onSelect={…} />
  <MenuItem label="Grid" selected onSelect={…} />   // checkmark
</Menu>
```
- MenuItem: h-7, text-xs, `danger` (error tokens), `selected`, `disabled`, `icon` (node or slot spec),
  `shortcut` (right-aligned hint, at least 16px from the label).

## Don't
- Never hand-roll `absolute` menus/dropdown lists — always Menu/Popover.
- Don't re-implement outside-click/Escape handling.

## Fixed bottom chrome
Any fixed bar at the bottom of the window (the editor Footer) publishes the
height it covers as `--sq-chrome-bottom` on `<html>`. Popover treats that band
as off-screen: it flips/clamps above it and caps its height at
`100vh − --sq-chrome-bottom − 16px` (inner list scrolls). A new bottom bar
must publish the same variable, or flyouts will run under it.
