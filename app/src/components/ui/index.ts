/**
 * components/ui — THE primitive kit. All app chrome is composed from these.
 *
 * Rules (enforced by app/scripts/lint-ui-consistency.mjs):
 * - no raw <button>, raw palette classes, text-[Npx], z-[N], shadow-md/lg/xl/2xl
 *   in components/** outside ui/
 * - styling is tokens-only (theme.css); editing the system = editing theme.css
 *
 * Before using a component, read its sub-doc under
 * .claude/skills/design-system/components/.
 */

export { cx } from './cx';

// Slots + Row (THE list atom)
export { SlotBox, Spinner, renderSlot, renderSlotSkeleton, type SlotSpec, type RowSlotSpec, type SlotSize } from './Slot';
export { Row, type RowProps, type RowSize, type RowDnd } from './Row';
export {
  SortableTreeProvider,
  useTreeNodeDnd,
  useTreePointerY,
  getDropZone,
  TreeDropIndicator,
  ROW_HEIGHT,
  type DropZone,
  type TreeItemBase,
  type ForeignDragHandlers,
} from './SortableTree';

// Actions
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './Button';
export { IconButton, type IconButtonProps, type IconButtonSize } from './IconButton';

// Inputs
export { Field, type FieldProps, type InputSize, type SelectOption } from './Field';
export { fieldBox } from './InputContainer';
export { SearchField, UnitField, InlineEdit, type SearchFieldProps, type UnitFieldProps, type InlineEditProps } from './FieldPresets';
export { InputGroup, type InputGroupProps, type InputGroupLayout, type InputGroupGap } from './InputGroup';
export { Labeled, type LabeledProps } from './Labeled';
// InputContainer is internal — exported only for the migration shims.
export { InputContainer, type InputContainerProps } from './InputContainer';

// Overlays
export { Popover, type PopoverProps, type PopoverPlacement } from './Popover';
export { Menu, MenuItem, type MenuProps, type MenuItemProps } from './Menu';
export { Modal, type ModalProps, type ModalSize } from './Modal';
export { Tooltip, type TooltipProps } from './Tooltip';
export { FloatingPanel, type FloatingPanelProps } from './FloatingPanel';

// Selection
export { Tabs, TabPanel, type TabsProps, type TabOption } from './Tabs';
export { SegmentedControl, type SegmentedControlProps, type SegmentOption, type SegmentDropdownOption } from './SegmentedControl';

// Display
export { Badge, type BadgeProps, type BadgeVariant } from './Badge';
export { Swatch, type SwatchProps } from './Swatch';
export { EmptyState, type EmptyStateProps } from './EmptyState';
export { Card, type CardProps } from './Card';
export { Dropzone, type DropzoneProps } from './Dropzone';
export { OperationNotice, type OperationNoticeProps } from './OperationNotice';
export { Skeleton, SkeletonText, type SkeletonProps } from './Skeleton';
