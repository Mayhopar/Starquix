// ui-lint-exempt: Fill values generate user-document Tailwind color and gradient classes.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Field, OperationNotice, Row, Tabs, SegmentedControl } from '@/components/ui';
import { ColorPicker } from '../ColorPicker';
import { useImageFill, type ImageFillInput } from './useImageFill';
import type { MediaAssetSource } from '@/components/AssetsPanel/assetSources';
import type { ImageFillChange } from '@/services/ViteMediaWriter';
import { ImageFillShell } from './ImageFillShell';

/** Draft fields commit once per edit, including Enter followed by browser blur. */
function CommitField({ value, onCommit, label, disabled, placeholder }: { value: string; onCommit: (value: string) => void; label: string; disabled?: boolean; placeholder?: string }) {
  const [draft, setDraft] = useState(value);
  const baseline = useRef(value);
  useEffect(() => { baseline.current = value; setDraft(value); }, [value]);
  const commit = () => { if (draft !== baseline.current) { baseline.current = draft; onCommit(draft); } };
  return <Field value={draft} onChange={setDraft} aria-label={label} placeholder={placeholder} disabled={disabled} onBlur={commit} onKeyDown={event => {
    if (event.key === 'Enter') { event.preventDefault(); commit(); }
    if (event.key === 'Escape') { event.preventDefault(); baseline.current = value; setDraft(value); }
  }} />;
}
const fitOptions = [{ value: 'cover', label: 'Fill' }, { value: 'contain', label: 'Fit' }, { value: 'fill', label: 'Stretch' }, { value: 'none', label: 'Original' }, { value: 'auto', label: 'Auto' }, { value: 'custom', label: 'Custom' }];
const positionOptions = ['center', 'top', 'bottom', 'left', 'right', 'left-top', 'right-top', 'left-bottom', 'right-bottom'].map(value => ({ value, label: value.split('-').join(' ').replace(/^./, c => c.toUpperCase()) }));
export function ImageFillControls({ input, assetSource }: { input: ImageFillInput; assetSource?: MediaAssetSource }) {
  const fill = useImageFill(input);
  const { state, busy } = fill;
  const [tab, setTab] = useState('image');
  useEffect(() => { setTab(input.tagName === 'img' || /bg-\[url\(/.test(input.classes) ? 'image' : /bg-gradient-/.test(input.classes) ? 'gradient' : 'color'); }, [input.ownerId]);
  const disabled = busy || state.target === 'unsupported';
  const baseOnly = !!input.variant;
  const native = state.target === 'native';
  const color = useMemo(() => input.classes.split(/\s+/).find(t => /^bg-(?:white|black|transparent|[a-z]+-\d{2,3}|\[#[\da-f]+\])(?:\/\d+)?$/i.test(t)) ?? '', [input.classes]);
  const gradient = useMemo(() => ({ direction: input.classes.match(/(?:^|\s)bg-gradient-(to-[a-z]+)(?:\s|$)/)?.[1] ?? 'to-r', from: input.classes.match(/(?:^|\s)(from-[^ ]+)/)?.[1] ?? 'from-white', to: input.classes.match(/(?:^|\s)(to-(?:white|black|transparent|[a-z]+-\d+|\[#[\da-f]+\]))(?:\s|$)/i)?.[1] ?? 'to-black' }), [input.classes]);
  // A gradient is never breakpoint-scoped: the kind switch and the stop
  // pickers (disabled off the base style) both write the base.
  const applyGradient = (values: Partial<typeof gradient>) => {
    const next = { ...gradient, ...values };
    void fill.apply({ type: 'gradient', value: `bg-gradient-${next.direction} ${next.from} ${next.to}`, variant: '' });
  };
  // The tab IS the fill kind (Figma): choosing one applies it at once —
  // Color = a solid (white until picked), Gradient = the current stops,
  // Image = the chooser (nothing changes until an image is chosen).
  // The kind is not responsive: switching it always acts on the base style,
  // whatever breakpoint/theme/state the bar is on (owner 2026-09-20: on
  // `sm` the tab click silently did nothing).
  const chooseKind = (kind: string) => {
    if (kind === tab) return; // Tabs fires onChange for the active tab too
    setTab(kind);
    if (disabled) return;
    if (kind === 'color') void fill.apply({ type: 'color', value: color || 'bg-white', variant: '' });
    if (kind === 'gradient') applyGradient({});
  };
  return <div className="px-1 pb-4 space-y-2">
    <Tabs size="sm" value={tab} onChange={chooseKind} options={[{ value: 'color', label: 'Color' }, { value: 'gradient', label: 'Gradient' }, { value: 'image', label: 'Image' }]} />
    {state.target === 'unsupported' && <OperationNotice title="This image needs its source or binding." detail="Its layout or image properties cannot be preserved by Fill yet." />}
    {tab === 'color' && <fieldset disabled={disabled} className="min-w-0"><ColorPicker prefix="bg" value={color} onChange={value => { void fill.apply({ type: 'color', value }); }} /></fieldset>}
    {tab === 'gradient' && <fieldset disabled={disabled || baseOnly} className="min-w-0 space-y-2">
      <Field as="select" aria-label="Gradient direction" value={gradient.direction} onChange={direction => applyGradient({ direction })} options={['to-t', 'to-tr', 'to-r', 'to-br', 'to-b', 'to-bl', 'to-l', 'to-tl'].map(value => ({ value, label: value.slice(3).toUpperCase() }))} />
      <Row title="From" hover={false} right={[{ type: 'custom', unboxed: true, node: <ColorPicker value={gradient.from.replace(/^from-/, 'bg-')} onChange={value => applyGradient({ from: value.replace(/^bg-/, 'from-') })} /> }]} />
      <Row title="To" hover={false} right={[{ type: 'custom', unboxed: true, node: <ColorPicker value={gradient.to.replace(/^to-/, 'bg-')} onChange={value => applyGradient({ to: value.replace(/^bg-/, 'to-') })} /> }]} />
    </fieldset>}
    {fill.issue && <OperationNotice {...fill.issue} action={fill.canRetry ? { label: 'Retry apply', onClick: () => { void fill.retry(); }, busy } : undefined} />}
    {tab === 'image' && state.target !== 'unsupported' && <ImageFillShell ownerId={input.ownerId} src={state.src} preview={state.preview} caption={state.src ? fitOptions.find(option => option.value === state.fit)?.label ?? 'Custom' : 'Choose an image'} busy={busy} phase={fill.phase} disabled={disabled} uploadDisabled={baseOnly} onChooseFile={file => { void fill.chooseFile(file); }} assetSource={assetSource} onPick={asset => { if (asset.applySrc) void fill.apply({ type: 'replace', src: asset.applySrc }); }}>
        <Row size="sm" title="Fit" hover={false} right={[{ type: 'custom', unboxed: true, node: <fieldset aria-label="Image fit" disabled={disabled || !state.src || state.fit === 'custom'}><SegmentedControl value={state.fit} options={[{ value: 'cover', label: 'Fill' }, { value: 'contain', label: 'Fit' }, { value: 'more', label: state.fit === 'custom' ? 'Custom' : 'More', dropdown: fitOptions.filter(option => native ? ['fill', 'none'].includes(option.value) : ['fill', 'auto'].includes(option.value)) }]} onChange={value => { void fill.apply({ type: 'fit', value: value === 'auto' ? 'none' : value as Extract<ImageFillChange, { type: 'fit' }>['value'] }); }} /></fieldset> }]} />
        <Row size="sm" title="Position" hover={false} right={[{ type: 'custom', unboxed: true, node: <Field as="select" aria-label="Image position" value={state.position} disabled={disabled || !state.src || state.position === 'custom'} options={state.position === 'custom' ? [...positionOptions, { value: 'custom', label: 'Custom' }] : positionOptions} onChange={value => { void fill.apply({ type: 'position', value: value as Extract<ImageFillChange, { type: 'position' }>['value'] }); }} /> }]} />
        <Row size="sm" title="Repeat" hover={false} right={[{ type: 'custom', unboxed: true, node: <Field as="select" aria-label="Image repeat" value={state.repeat} disabled={disabled || native || !state.src} options={['no-repeat', 'repeat', 'repeat-x', 'repeat-y'].map(value => ({ value, label: value.replace(/-/g, ' ') }))} onChange={value => { void fill.apply({ type: 'repeat', value }); }} /> }]} />
        <CommitField key={`${input.ownerId}:url`} label="Image URL" value={state.src} disabled={disabled || baseOnly} placeholder="Image URL" onCommit={src => { void fill.apply({ type: 'replace', src }); }} />
        {(native || state.target === 'owned') && <CommitField key={`${input.ownerId}:description`} label="Image description" value={state.description} disabled={disabled || baseOnly || !state.src} placeholder="Description · empty for decorative" onCommit={value => { void fill.apply({ type: 'description', value }); }} />}
        {baseOnly && <Row size="sm" title="Use the base style to replace or remove this image." hover={false} />}
        {state.src && <Button label="Remove image" variant="ghost" size="sm" disabled={disabled || baseOnly} onClick={() => { void fill.apply({ type: 'remove' }); }} />}
    </ImageFillShell>}
  </div>;
}
