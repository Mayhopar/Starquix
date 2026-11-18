/**
 * The DesignBar header's divergence indicator — owner acceptance criterion 2
 * (2026-08-03).
 *
 * `*` used to be lit from one instance-wide boolean, so every untouched sibling
 * inside an edited placement wore it: a user read `P*` as "I changed this
 * paragraph", went hunting, and found nothing — and in a dirty placement
 * nothing said which element had actually moved.
 *
 * Now the two states are different things:
 *
 *   `*`         THIS element diverged. Same glyph, same place, narrower meaning.
 *   `N edited`  this element merely CONTAINS diverged descendants. A count, so
 *               the user knows how much is unpushed, and visually distinct from
 *               `*` so it is never mistaken for "you changed this one".
 *
 * Shared by both runtimes on purpose — WC/server feed it
 * `collectInstanceDivergence`, local feeds it `localOverridesForPlacement`, and
 * the rendered contract is identical. No runtime branch lives here.
 */
import type { FC } from 'react';
import { plural, verb } from '@/utils/plural';

export interface DivergenceMarkerProps {
  /** The selected element itself carries an unpushed change. */
  self: boolean;
  /** How many diverged elements sit INSIDE it (0 = show nothing). */
  contained: number;
}

export const DivergenceMarker: FC<DivergenceMarkerProps> = ({ self, contained }) => {
  // Owner rule (2026-09-16, "since forever"): an overridden component carries
  // `*` in its name — whether the root itself or something inside it changed.
  // An untouched sibling still gets nothing (acceptance criterion 2).
  if (self) return <span title="Edited here — not yet pushed to the component">*</span>;
  if (contained > 0) {
    return (
      <span title={`${plural(contained, 'element')} inside this component ${verb(contained, 'have', 'has')} unpushed changes`}>*</span>
    );
  }
  return null;
};

export default DivergenceMarker;
