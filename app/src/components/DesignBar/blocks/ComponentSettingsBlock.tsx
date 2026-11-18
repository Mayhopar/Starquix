import { useState, type FC, type ReactNode } from 'react';
import { Field, Row, SegmentedControl } from '@/components/ui';
import type { Control, Manifest, PropSpec } from '@/core/manifest/types';

/**
 * task-207: the generic face of a system component's manifest. Presentation
 * only — the owner supplies current values and receives (name, value) edits.
 * `null` means REMOVE the attribute (ledger B5).
 *
 * Slots are NOT rendered here: they need the upload path and a write target,
 * so MediaBlock keeps owning them (Task 5).
 *
 * The draft map is what the user has typed but not yet committed; it wins over
 * `values` for display until blur. Remount (a `key` on the selection) is the
 * owner's way to drop drafts when the selection changes.
 */
export type PropValue = string | number | boolean | null;

interface Props {
  name: string;
  manifest: Manifest;
  values: Record<string, string | number | boolean | undefined>;
  readOnly: boolean;
  onChange: (prop: string, value: PropValue) => void;
  /** Controls the manifest cannot express, rendered under the title and above
   *  the generic knobs. Media's count/width/slots ride here (Task 5) — they
   *  are an array contract and a class token, not plain attributes. */
  children?: ReactNode;
}

const CONTROLLED = new Set(['enum', 'number', 'text', 'boolean']);

/** A8: past this many options a segmented control stops fitting the bar. */
const SELECT_THRESHOLD = 6;

type EnumControl = Extract<Control, { kind: 'enum' }>;
type NumberControl = Extract<Control, { kind: 'number' }>;

export const ComponentSettingsBlock: FC<Props> = ({ name, manifest, values, readOnly, onChange, children }) => {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const specs = manifest.props.filter(p => CONTROLLED.has(p.control.kind));
  if (specs.length === 0 && !children) return null; // A15

  const numerics = specs.filter(p => p.control.kind === 'number');
  const others = specs.filter(p => p.control.kind !== 'number');

  /** Segments carry stringified values; give the caller back the typed one (A9). */
  const emitEnum = (p: PropSpec, spec: EnumControl) => (v: string) => {
    if (readOnly) return;
    onChange(p.name, spec.values.find(x => String(x) === v) ?? v);
  };

  const commitNumber = (p: PropSpec) => {
    const raw = draft[p.name];
    if (raw === undefined) return;
    const trimmed = raw.trim();
    if (trimmed === '') return onChange(p.name, null);       // B5
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return;                          // reject, no write
    onChange(p.name, n);
  };

  return (
    <div className="pb-2">
      <Row title={name} hover={false} size="sm" />
      {children}
      {others.map(p => (
        <div key={p.name} className="px-2 py-1">
          {p.control.kind === 'enum' && (
            p.control.values.length > SELECT_THRESHOLD ? (
              <Field
                as="select" size="sm" aria-label={p.label} disabled={readOnly}
                options={p.control.values.map(v => ({ value: String(v), label: String(v) }))}
                value={String(values[p.name] ?? '')}
                onChange={emitEnum(p, p.control)}
              />
            ) : (
              <SegmentedControl
                options={p.control.values.map(v => ({ value: String(v), label: String(v) }))}
                value={String(values[p.name] ?? '')}
                onChange={emitEnum(p, p.control)}
              />
            )
          )}
          {p.control.kind === 'text' && (
            <Field
              size="sm" label={p.label[0]} aria-label={p.label} disabled={readOnly}
              value={draft[p.name] ?? String(values[p.name] ?? '')}
              onChange={(v: string) => setDraft(d => ({ ...d, [p.name]: v }))}
              onBlur={() => {
                const raw = draft[p.name];
                if (readOnly || raw === undefined) return;
                onChange(p.name, raw === '' ? null : raw);
              }}
            />
          )}
          {p.control.kind === 'boolean' && (
            <SegmentedControl
              options={[{ value: 'false', label: 'Off' }, { value: 'true', label: 'On' }]}
              value={String(values[p.name] ?? false)}
              onChange={(v: string) => { if (!readOnly) onChange(p.name, v === 'true'); }}
            />
          )}
        </div>
      ))}
      {numerics.length > 0 && (
        <div className="px-2 py-1 grid grid-cols-2 gap-1">
          {numerics.map(p => {
            const c = p.control as NumberControl;
            return (
              <Field
                key={p.name} type="number" size="sm" unit={c.unit}
                label={p.label[0]} aria-label={p.label} disabled={readOnly}
                min={c.min} max={c.max} step={c.step}
                value={draft[p.name] ?? String(values[p.name] ?? '')}
                onChange={(v: string) => setDraft(d => ({ ...d, [p.name]: v }))}
                onBlur={() => { if (!readOnly) commitNumber(p); }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ComponentSettingsBlock;
