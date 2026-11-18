import {
  ContainerIcon,
  ContainerFlexRowIcon,
  ContainerFlexColumnIcon,
  ContainerFlexRowReverseIcon,
  ContainerFlexColumnReverseIcon,
  ContainerGridRowIcon,
  ContainerGridColumnIcon,
} from '@/assets/icons';
import type { ContainerLayout } from '@/bridge/types';

/** Used only after component, slot, text, media and link identities resolve. */
export function ContainerLayoutIcon({ layout, className }: { layout?: ContainerLayout; className?: string }) {
  const Icon = layout === 'flex-row' ? ContainerFlexRowIcon
    : layout === 'flex-column' ? ContainerFlexColumnIcon
    : layout === 'flex-row-reverse' ? ContainerFlexRowReverseIcon
    : layout === 'flex-column-reverse' ? ContainerFlexColumnReverseIcon
    : layout === 'grid-row' ? ContainerGridRowIcon
    : layout === 'grid-column' ? ContainerGridColumnIcon
    : ContainerIcon;
  return <Icon className={className} />;
}
