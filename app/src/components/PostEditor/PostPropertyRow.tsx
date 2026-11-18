import { useEffect, useRef } from 'react';
import { Button, Field, Popover, Row, cx } from '@/components/ui';
import { isEmptyValue, propertyInspection, propertyLabel, propertyValueSummary, type PropertyDescriptor } from './propertyDescriptors';
import { StringListPropertyEditor } from './StringListPropertyEditor';
import { PostPropertyImageEditor } from './PostPropertyEditor';
import { usePostPropertyImage } from './usePostPropertyImage';

export function PostPropertyRow({ descriptor, value, active, onEdit, onChange, onCommit, error, postFile = null, projectPath = null, onUploadMedia, busy = false, onBusyChange = () => {} }: {
  descriptor: PropertyDescriptor; value: unknown; active: boolean; onEdit: (open: boolean) => void;
  onChange: (key: string, value: unknown) => void; onCommit: () => Promise<boolean | void>; error: string | null;
  postFile?: string | null; projectPath?: string | null; onUploadMedia?: (file: File) => Promise<string>;
  busy?: boolean; onBusyChange?: (busy: boolean) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(null);
  const revision = useRef(0);
  const savedRevision = useRef(0);
  const committing = useRef<Promise<boolean> | null>(null);
  const stillActive = useRef(active); stillActive.current = active;
  const imageDraftValid = useRef(true);
  const { key, editor } = descriptor;
  const text = typeof value === 'string' ? value : '';
  const popup = editor === 'readonly' || editor === 'list' || editor === 'image' || editor === 'text' && (key === 'description' || text.includes('\n'));
  const preview = usePostPropertyImage(editor === 'image' ? text : '', postFile, projectPath);
  useEffect(() => { if (active) { imageDraftValid.current = true; inputRef.current?.focus(); } }, [active]);
  const change = (next: unknown) => { revision.current++; onChange(key, next); };
  const commit = () => {
    if (committing.current) return committing.current;
    const attempted = revision.current;
    const operation = (async () => {
      if (error || busy || !imageDraftValid.current) return false;
      if (attempted !== savedRevision.current && await onCommit() === false) return false;
      savedRevision.current = attempted;
      return revision.current === attempted && imageDraftValid.current;
    })();
    committing.current = operation;
    void operation.finally(() => { committing.current = null; });
    return operation;
  };
  const done = async (restoreFocus = false) => {
    if (await commit() && stillActive.current) {
      onEdit(false);
      if (restoreFocus) queueMicrotask(() => triggerRef.current?.focus());
    }
  };
  const keyboard = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      // Native Popover also listens at document level. Let the IME handle
      // candidate cancellation without forwarding Escape into that close path.
      if (event.key === 'Escape') event.stopPropagation();
      return;
    }
    if (event.key === 'Escape') { event.stopPropagation(); void done(true); }
    if (event.key === 'Enter' && !popup) { event.preventDefault(); void done(true); }
  };
  const input = <Field ref={inputRef} value={text} aria-label={key} onChange={change} error={error ?? undefined} placeholder="Empty" disabled={busy}
    type={editor === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(text) ? 'date' : 'text'} onKeyDown={keyboard} onBlur={() => { void done(); }} />;
  const trigger = <Button ref={triggerRef} variant="ghost" size="sm" aria-label={`${editor === 'readonly' ? 'Inspect' : 'Edit'} ${key}`}
    icon={editor === 'image' && preview.url ? <img src={preview.url} alt="" className="w-5 h-5 object-cover rounded-inner shrink-0" /> : undefined}
    className={cx('w-full justify-start font-normal min-w-0 px-2', isEmptyValue(value) ? 'text-text-secondary' : 'text-text')} disabled={busy && !active} onClick={() => onEdit(true)}>
    <span className="truncate">{propertyValueSummary(value)}</span>
  </Button>;
  return <>
    {/* min-h-8 py-0: every property row is 32px, whatever the value cell holds (Button, toggle, Field). */}
    <Row size="sm" hover={false} className={cx('sq-post-property-row px-0 py-0 min-h-8', editor === 'boolean' && 'sq-post-property-toggle')} title={<span title={key}>{propertyLabel(key)}</span>}
      right={editor === 'boolean' ? [{ type: 'toggle', value: value === true, disabled: busy, 'aria-label': key, onChange: next => { change(next); void onCommit(); } }]
        : [{ type: 'custom', unboxed: true, node: <div className="w-full min-w-0">{active && !popup ? input : trigger}</div> }]} />
    {error && !(active && !popup) && <div className="text-xs text-error">{propertyLabel(key)}: {error}</div>}
    {active && popup && <Popover isOpen triggerRef={triggerRef} onClose={() => { void done(); }} width={320} placement="bottom-end" className="max-w-[calc(100vw-16px)]">
      <div className="p-3 space-y-2" onKeyDown={keyboard}>
        <Row size="sm" hover={false} title={propertyLabel(key)} className="px-0" />
        {editor === 'readonly' ? <><div className="text-xs text-text-muted">{descriptor.readOnlyReason}</div><div className="text-2xs text-text-muted">Display value</div><pre className="text-xs text-text whitespace-pre-wrap break-words">{propertyInspection(value)}</pre></>
          : editor === 'list' ? <StringListPropertyEditor value={Array.isArray(value) ? value as string[] : []} onChange={change} />
          : editor === 'image' ? <PostPropertyImageEditor value={text} preview={preview} onChange={change} onCommit={onCommit} onUploadMedia={onUploadMedia} onBusyChange={onBusyChange} onDraftValidityChange={valid => { imageDraftValid.current = valid; }} />
          : <Field as="textarea" ref={inputRef} aria-label={key} value={text} onChange={change} error={error ?? undefined} />}
        {editor !== 'readonly' && <Button variant="secondary" size="sm" label="Done" disabled={busy} onClick={() => { void done(true); }} />}
      </div>
    </Popover>}
  </>;
}
