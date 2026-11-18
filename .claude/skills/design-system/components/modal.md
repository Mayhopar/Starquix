# Modal

`import { Modal } from '@/components/ui'`

```tsx
<Modal isOpen onClose size="sm|md|lg|picker|auto" className>
  {content}
</Modal>
```
- One overlay: `bg-black/50`, `z-modal`; panel `rounded-outer shadow-modal`,
  max-h 90vh scroll.
- Sizes: sm 400px · md 560px · lg 800px · picker (602×500 flex-col — the
  ⌘K-family shell shared by ComponentPickerModal/StylePickerModal) · auto
  (content-sized, legacy).
- Click-outside and Escape both close.
- Popovers/Menus inside it just work: they register with the Modal (like nested
  popovers), so a click inside one never closes the Modal, Escape closes the
  open popover first, and they stack above it (`calc(var(--z-modal) + 1)`).
  No `zIndex` prop needed.

## Don't
- Never hand-roll a `fixed inset-0` overlay — always Modal.
- No per-modal z-index / radius / overlay-opacity choices.
- No bespoke ESC/outside-click effects alongside Modal (double-dismiss).

The panel is `role="dialog"` + `aria-modal="true"`. Don't fill it by hand: use `Window` + `Pane` from
`components/DeployModal/publishParts.tsx` (culture.md Window recipe — the Figma: 56px header with the name only,
items with the label on top, 56px footer with Cancel + the primary; `border-stroke` rules).
