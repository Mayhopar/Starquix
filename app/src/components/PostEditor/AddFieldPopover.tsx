import { memo, useEffect, useRef, useState } from 'react';
import { Button, Field, OperationNotice, Row } from '@/components/ui';
import { useDispatch, useEditorDoc } from '@/store/hooks';
import { useUndoContext } from '@/context/UndoContext';
import { selectContentCollections } from '@/store/collectionSelectors';
import { contentOps } from '@/core/collections/content-ops';
import type { FieldType } from '@/core/collections/types';
const FIELD_TYPES: FieldType[] = ['text', 'date', 'image', 'url', 'boolean', 'list'];
interface Props {
  collectionId: string | null;
  onLocalAdd?: ((name: string, type: FieldType) => Promise<void>) | null;
  existingNames?: string[];
  onDone: () => void;
  onCancel: () => void;
  onBusyChange?: (busy: boolean) => void;
  onBeforeAdd?: () => Promise<boolean | void>;
  blocked?: boolean;
  onUnconfirmed?: () => void;
  durableLocal?: boolean;
}
export const AddFieldPopover = memo(function AddFieldPopover({ collectionId, onLocalAdd = null, existingNames = [], onDone, onCancel, onBusyChange, onBeforeAdd, blocked = false, onUnconfirmed, durableLocal = false }: Props) {
  const dispatch = useDispatch(); const doc = useEditorDoc(); const { takeSnapshot } = useUndoContext();
  const [name, setName] = useState(''); const [type, setType] = useState<FieldType>('text'); const [required, setRequired] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<'draft' | 'write' | null>(null);
  const input = useRef<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { input.current?.focus(); }, []);
  const valid = /^[a-zA-Z_][\w-]*$/.test(name.trim()) && !existingNames.includes(name.trim());
  const submit = async () => {
    if (!valid || busy || blocked) return;
    setBusy(true); onBusyChange?.(true); setError(null);
    try {
      if (await onBeforeAdd?.() === false) { setError('draft'); return; }
      if (!mounted.current) return;
      if (onLocalAdd) await onLocalAdd(name.trim(), type);
      else if (collectionId) {
        takeSnapshot(); dispatch({ type: 'ADD_COLLECTION_FIELD', collectionId, field: { id: crypto.randomUUID(), name: name.trim(), type, required } });
        await contentOps.writeContentConfig(selectContentCollections(doc));
      } else return;
      if (mounted.current) onDone();
    } catch { if (mounted.current) { setError('write'); onUnconfirmed?.(); } }
    finally { if (mounted.current) { setBusy(false); onBusyChange?.(false); } }
  };
  return <div className="space-y-2" onKeyDownCapture={event => {
    if (event.key === 'Escape' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.stopPropagation();
  }}>
    <Field ref={input} aria-label="Field name" value={name} onChange={setName} placeholder={type === 'image' ? 'coverImage' : 'field name'} disabled={busy}
      error={name && !valid ? 'Use a unique field name with letters, numbers, underscores or hyphens.' : undefined}
      onKeyDown={event => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === 'Enter') { event.preventDefault(); void submit(); } if (event.key === 'Escape' && !busy) { event.stopPropagation(); onCancel(); } }} />
    <Field as="select" aria-label="Field type" value={type} onChange={value => setType(value as FieldType)} options={FIELD_TYPES.map(value => ({ value, label: value }))} disabled={busy || blocked} />
    {!onLocalAdd && <Row title="Required" size="sm" hover={false} className="px-0" right={[{ type: 'checkbox', checked: required, onChange: setRequired, disabled: busy, 'aria-label': 'Required' }]} />}
    {error === 'draft' && <OperationNotice title="The current post needs attention." detail="Resolve its notice before adding a collection field." />}
    {error === 'write' && !blocked && <OperationNotice title={durableLocal ? 'The collection field was not added.' : 'The collection field was not confirmed.'}
      detail={durableLocal ? 'The change could not be stored. Your files are unchanged. Try again.' : 'Some files may have changed. Keep this form open and review the collection files.'} />}
    <Button variant="primary" size="sm" label="Add" disabled={!valid || blocked} loading={busy} onClick={() => { void submit(); }} />
  </div>;
});
