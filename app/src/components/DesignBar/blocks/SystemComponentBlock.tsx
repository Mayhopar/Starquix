import { useCallback, useMemo, type FC } from 'react';
import { getProp, setProp } from '@/core/postmedia/invocation';
import type { Manifest } from '@/core/manifest/types';
import { ComponentSettingsBlock, type PropValue } from './ComponentSettingsBlock';
import { useInvocation } from './useInvocation';
import type { ComponentUnit } from '../componentUnit';

/**
 * task-207 Task 9: the panel ANY sq/ system component shows — the generic
 * sibling of MediaBlock, which keeps its own because count (`items` array) and
 * width (a class token) are not plain attributes.
 *
 * Everything here is manifest-driven: the component's own Props declaration
 * decides which knobs exist (D2), so promoting a component is enough to make
 * it editable — no registry entry, no sidecar, no code change.
 *
 * Read-only when there is no write target (B9): no runtime branch anywhere —
 * the same code renders with `write === null` whenever the rendered body
 * carries no rehype stamps. (D9's original "WC has no post route" premise is
 * stale: `__sq_post_view` exists now; with stamps and a resolved postTarget
 * the write goes through contentOps.updatePost's WC branch → container FS.)
 */
interface Props {
  unit: ComponentUnit;
  postTarget: { collection: string; slug: string } | null;
  manifest: Manifest;
}

export const SystemComponentBlock: FC<Props> = ({ unit, postTarget, manifest }) => {
  const readOnly = unit.write === null || postTarget === null;
  const { src, save } = useInvocation({ postTarget, bodyLine: unit.write?.bodyLine });

  const values = useMemo(() => Object.fromEntries(
    manifest.props.map((p) => [p.name, getProp(src, p.name)]),
  ), [src, manifest]);

  const onChange = useCallback(
    (prop: string, value: PropValue) => save((s) => setProp(s, prop, value)),
    [save],
  );

  // A15: a component whose manifest yields no editable prop shows no block at
  // all — living in sq/ does not by itself make something configurable.
  return (
    <ComponentSettingsBlock
      key={String(unit.write?.bodyLine ?? 'none')}
      name={unit.name ?? 'Component'}
      manifest={manifest}
      values={values}
      readOnly={readOnly}
      onChange={onChange}
    >
      {readOnly && (
        <div className="px-2 py-1 text-2xs text-text-secondary">
          Open the post to edit this component
        </div>
      )}
    </ComponentSettingsBlock>
  );
};

export default SystemComponentBlock;
