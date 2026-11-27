import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { postHeaderView, pickSubtitleKey, countWords, DEFAULT_POST_HEADER } from '@/core/post/postHeaderView';
import type { PostLayoutSettings } from '@/core/post/postLayoutProps';
import { POST_COLUMN_CLS } from './postEditorLayout';
import { PostTitleFields, PostBylineDate } from './PostTitleFields';
import type { CollectionField, FieldType } from '@/core/collections/types';
import { defaultLocalFieldValue } from '@/core/collections/localFields';
import { isEmpty } from '@/core/collections/validateFrontmatter';
import { AddFieldPopover } from './AddFieldPopover';
import { Button, Row, Popover, OperationNotice } from '@/components/ui';
import { PlusIcon } from '@/assets/icons';
import { useDispatch, useEditorDoc } from '@/store/hooks';
import { useUndoContext } from '@/context/UndoContext';
import { selectContentCollections } from '@/store/collectionSelectors';
import { contentOps, readRequiredLocalFields } from '@/core/collections/content-ops';
import { describeProperties, propertyLabel, propertyValueSummary } from './propertyDescriptors';
import { bindLocalCardImageField, readLocalCardImageField } from '@/components/Editor/localFieldBind';
import { usePostPropertyImage } from './usePostPropertyImage';
import { PostPropertyRow } from './PostPropertyRow';
import { getActiveSaveProjectId } from '@/services/pendingProjectMutations';
const LOCKED_FIELDS = new Set(['title', 'date']);
// Pending acceptance survives a post remount. Legacy multi-file writes also
// retain quarantine when their source outcome cannot be confirmed.
type CollectionFieldState = 'idle' | 'pending' | 'unconfirmed';
const collectionFieldStates = new Map<string, CollectionFieldState>();
const collectionFieldListeners = new Set<() => void>();
const collectionFieldState = (owner: string) => collectionFieldStates.get(owner) ?? 'idle';
function publishCollectionFieldState(owner: string, state: CollectionFieldState) {
  if (state === 'idle') collectionFieldStates.delete(owner); else collectionFieldStates.set(owner, state);
  collectionFieldListeners.forEach(listener => listener());
}
function subscribeCollectionFields(listener: () => void) {
  collectionFieldListeners.add(listener);
  return () => { collectionFieldListeners.delete(listener); };
}
async function runCollectionFieldChange(owner: string, change: () => Promise<void>, durableLocal = false) {
  // Gate the operation before constructing a new tracked mutation: a replay's
  // success must never acknowledge the original unconfirmed multi-file write.
  if (collectionFieldState(owner) !== 'idle') throw new Error('Collection change is already owned');
  publishCollectionFieldState(owner, 'pending');
  try { await change(); publishCollectionFieldState(owner, 'idle'); }
  catch (error) { publishCollectionFieldState(owner, durableLocal ? 'idle' : 'unconfirmed'); throw error; }
}
interface FrontmatterFormProps {
  frontmatter: Record<string, unknown>;
  readOnlyPropertyKeys?: readonly string[];
  fields: CollectionField[];
  collectionId: string | null;
  localCollection?: string | null;
  fieldSource?: 'schema' | 'inferred';
  onChange: (fm: Record<string, unknown>, options?: { collectionAccepted: true; field: string }) => void;
  onBlur: () => void | Promise<void | boolean>;
  fileName?: string;
  postFile?: string | null;
  projectPath?: string | null;
  onFocusBody?: () => void;
  /** Upload a property image; `field` is the frontmatter key it lands in (the writer picks the target by it). */
  onUploadMedia?: (file: File, field: string) => Promise<string>;
  /** The route's PostLayout settings — the header is drawn the way the page draws it. */
  header?: PostLayoutSettings;
  /** Post body, for the byline's reading time. */
  body?: string;
}
export const FrontmatterForm = memo(function FrontmatterForm({ frontmatter, readOnlyPropertyKeys, fields, collectionId, localCollection = null, fieldSource = collectionId ? 'schema' : 'inferred', onChange, onBlur, onUploadMedia, fileName = 'Post', postFile = null, projectPath = null, onFocusBody = () => {}, header = DEFAULT_POST_HEADER, body = '' }: FrontmatterFormProps) {
  const values = useRef(frontmatter); values.current = frontmatter;
  const mounted = useRef(true);
  const projectOwner = useRef(getActiveSaveProjectId());
  const durableLocal = !!localCollection && !!projectPath;
  const managementOwner = JSON.stringify([projectOwner.current, localCollection ?? collectionId]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  /** the byline date being edited in place — it keeps its slot (and its row stays hidden) until editing ends */
  const [editingDateKey, setEditingDateKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [otherOpen, setOtherOpen] = useState(false);
  const [managing, setManaging] = useState(false);
  const [adding, setAdding] = useState(false);
  const [managingBusy, setManagingBusy] = useState(false);
  const managementState = useSyncExternalStore(subscribeCollectionFields, () => collectionFieldState(managementOwner));
  const managementBlocked = managementState === 'unconfirmed';
  const managementPending = managementState === 'pending';
  const [managementError, setManagementError] = useState<'draft' | 'write' | null>(null);
  const blockManagement = () => {
    if (!durableLocal && collectionFieldState(managementOwner) !== 'pending') publishCollectionFieldState(managementOwner, 'unconfirmed');
    setManagementError('write');
  };
  const manageRef = useRef<HTMLButtonElement>(null);
  const addFieldRef = useRef<HTMLButtonElement>(null);
  const managerPanelRef = useRef<HTMLDivElement>(null);
  const returnFocus = (target: () => HTMLElement | null, previous: Element | null) => {
    queueMicrotask(() => {
      const current = document.activeElement;
      if (current === document.body || current === previous) target()?.focus();
    });
  };
  const cancelAdd = () => {
    const previous = document.activeElement;
    const ownedFocus = !!previous && managerPanelRef.current?.contains(previous);
    setAdding(false);
    if (ownedFocus) returnFocus(() => addFieldRef.current, previous);
  };
  const closeManager = () => {
    if (managingBusy) return;
    const previous = document.activeElement;
    const ownedFocus = previous === manageRef.current || !!previous && managerPanelRef.current?.contains(previous);
    setManaging(false); setAdding(false);
    if (ownedFocus) returnFocus(() => manageRef.current, previous);
  };
  const dispatch = useDispatch(); const doc = useEditorDoc(); const { takeSnapshot, claimSnapshot } = useUndoContext();
  // A field added from this form keeps the type the user chose: its value is
  // '' in every post until the first upload, and an all-empty key can only be
  // inferred by name — the image editor (drop zone) must be there at once.
  const [addedTypes, setAddedTypes] = useState<Record<string, FieldType>>({});
  const knownFields = new Set(fields.map(f => f.name));
  const effectiveFields: CollectionField[] = [
    ...fields.map(f => addedTypes[f.name] && f.type !== addedTypes[f.name] ? { ...f, type: addedTypes[f.name] } : f),
    ...Object.entries(addedTypes).filter(([name]) => !knownFields.has(name)).map(([name, type]) => ({ id: name, name, type, required: false })),
  ];
  const descriptors = describeProperties(effectiveFields, frontmatter, fieldSource, readOnlyPropertyKeys);
  // The post's cover = the attribute the user uploads into (see
  // localFieldBind.bindLocalCardImageField — the card binds to it too); on open
  // the field the card is bound to; else the first image-typed property with a
  // value (the writing surface must not read as "no image", 2026-09-10).
  const [coverKey, setCoverKey] = useState<string | null>(null);
  useEffect(() => {
    if (localCollection) void readLocalCardImageField().then((field) => { if (field) setCoverKey((current) => current ?? field); });
  }, [localCollection]);
  const coverSrc = [coverKey, ...descriptors.filter(d => d.editor === 'image').map(d => d.key)]
    .map(key => (key ? frontmatter[key] : undefined))
    .find((v): v is string => typeof v === 'string' && v.trim() !== '') ?? '';
  const coverPreview = usePostPropertyImage(coverSrc, postFile ?? null, projectPath ?? null);
  const title = descriptors.find(d => d.key === 'title' && d.editor === 'text') ? (frontmatter.title as string | undefined) ?? '' : null;
  // The header as the page draws it (postHeaderView): the subtitle is the key the
  // page shows (subtitle, else description, else excerpt), edited in place when it is a
  // plain text value. A `subtitle` field lives only here; description/excerpt
  // keep their property row too (multiline and source-safe editing live there).
  const bodyWords = useMemo(() => countWords(body), [body]);
  const view = postHeaderView(frontmatter, header, bodyWords, !!coverPreview.url);
  const subtitleKey = view.showSubtitle ? pickSubtitleKey(frontmatter, new Set(descriptors.map(d => d.key))) : null;
  const subtitleEditable = descriptors.some(d => d.key === subtitleKey && d.editor === 'text');
  const subtitleText = subtitleKey ? String(frontmatter[subtitleKey] ?? '') : '';
  // The byline's date is edited where the page draws it, like the title: its row hides meanwhile.
  const bylineDateKey = editingDateKey ?? (descriptors.some(d => d.key === view.byline.dateKey && (d.editor === 'date' || d.editor === 'text')) ? view.byline.dateKey : null);
  const properties = descriptors.filter(d => !(d.key === 'title' && title !== null) && !(d.key === 'subtitle' && subtitleKey === 'subtitle' && subtitleEditable) && d.key !== bylineDateKey);
  const editable = properties.filter(d => d.editor !== 'readonly');
  const other = properties.filter(d => d.editor === 'readonly');
  const invalidCount = properties.filter(d => d.required && d.field && isEmpty(frontmatter[d.key], d.field.type)).length;
  const [open, setOpen] = useState(() => properties.length <= 4 || invalidCount > 0);
  const canManageFields = !!collectionId || !!localCollection;
  const publish = useCallback((key: string, value: unknown) => {
    const next = { ...values.current, [key]: value };
    if (value === undefined) delete next[key]; // a property's Delete: the key leaves the post
    values.current = next; onChange(next);
  }, [onChange]);
  const commit = async () => { try { return await onBlur(); } catch { return false; } };
  const beforeCollectionChange = async () => {
    if (collectionFieldState(managementOwner) !== 'idle') return false;
    setManagementError(null);
    return await commit() !== false && mounted.current && projectOwner.current === getActiveSaveProjectId()
      && collectionFieldState(managementOwner) === 'idle';
  };
  const publishCollectionChange = (next: Record<string, unknown>, field: string) => {
    values.current = next;
    onChange(next, durableLocal ? { collectionAccepted: true, field } : undefined);
  };
  const addLocal = async (name: string, type: FieldType) => {
    if (!localCollection || !mounted.current || projectOwner.current !== getActiveSaveProjectId()) throw new Error('Collection owner changed');
    const value = defaultLocalFieldValue(type);
    await runCollectionFieldChange(managementOwner, () => {
      return contentOps.addLocalCollectionField(localCollection, name, value, type);
    }, durableLocal);
    if (!mounted.current) return;
    setAddedTypes(prev => ({ ...prev, [name]: type }));
    if (!(name in values.current)) publishCollectionChange({ ...values.current, [name]: value }, name);
  };
  const remove = async (field: CollectionField) => {
    if (collectionFieldState(managementOwner) !== 'idle' || managingBusy) return;
    setManagingBusy(true); setManagementError(null);
    let collectionAccepted = false;
    try {
      if (!await beforeCollectionChange()) { if (mounted.current) setManagementError('draft'); return; }
      if (localCollection) {
        const removedValue = values.current[field.name];
        await runCollectionFieldChange(managementOwner, () => {
          // At once — ⌘Z puts the key back in every post (owner 2026-11-10: delete anything AND undo).
          takeSnapshot();
          return contentOps.removeLocalCollectionField(localCollection, field.name, claimSnapshot());
        }, durableLocal);
        collectionAccepted = true;
        if (!mounted.current) return;
        // A focused draft arriving during the collection write still belongs to the editor.
        if (values.current[field.name] === removedValue) {
          const next = { ...values.current }; delete next[field.name]; publishCollectionChange(next, field.name);
        } else { setManagementError('draft'); return; }
      } else if (collectionId) {
        takeSnapshot(); dispatch({ type: 'DELETE_COLLECTION_FIELD', collectionId, fieldId: field.id });
        await contentOps.writeContentConfig(selectContentCollections(doc));
      }
      if (!durableLocal && await commit() === false) setManagementError('draft');
    } catch {
      if (durableLocal && collectionAccepted) setManagementError('draft'); else blockManagement();
    }
    finally { setManagingBusy(false); }
  };
  // Fields the collection's schema requires (files-truth): no Delete for them, and the manager offers
  // "Make optional". Re-read whenever a popover opens (⌘Z may have put a declaration back); null = unknown → no Delete.
  const [requiredNames, setRequiredNames] = useState<string[] | null>(null);
  useEffect(() => {
    if (!localCollection) return;
    let live = true; setRequiredNames(null);
    void readRequiredLocalFields(localCollection).then(names => { if (live) setRequiredNames(names); }, () => {});
    return () => { live = false; };
  }, [localCollection, managing, activeKey]);
  const schemaRequired = (key: string) => localCollection ? requiredNames && requiredNames.includes(key) : false;
  const makeOptional = async (field: CollectionField) => {
    if (!localCollection || collectionFieldState(managementOwner) !== 'idle' || managingBusy) return;
    setManagingBusy(true); setManagementError(null);
    try {
      await runCollectionFieldChange(managementOwner, () => {
        takeSnapshot(); // one ⌘Z puts the declaration back
        return contentOps.makeLocalCollectionFieldOptional(localCollection, field.name, claimSnapshot());
      }, durableLocal);
      if (mounted.current) setRequiredNames(names => names && names.filter(name => name !== field.name));
    } catch { blockManagement(); }
    finally { setManagingBusy(false); }
  };
  const fieldActionsDisabled = managingBusy || adding || managementBlocked || managementPending;
  const fieldAction = (label: string, ariaLabel: string, run: () => Promise<void>) => ({ type: 'custom' as const, unboxed: true,
    node: <Button label={label} aria-label={ariaLabel} variant="ghost" size="sm" disabled={fieldActionsDisabled} onClick={() => { void run(); }} /> });
  const renderProperty = (descriptor: typeof properties[number]) => <PostPropertyRow key={descriptor.key} descriptor={descriptor} value={frontmatter[descriptor.key]}
    active={activeKey === descriptor.key} onEdit={next => {
      if (busyKey || managingBusy) return;
      setActiveKey(previous => next ? descriptor.key : previous === descriptor.key ? null : previous);
    }} onChange={(key, value) => {
      // A deleted key keeps its row while the post is open, even when no other post holds it.
      if (value === undefined && descriptor.field) setAddedTypes(prev => ({ ...prev, [key]: descriptor.field!.type }));
      publish(key, value);
    }} onCommit={commit}
    error={descriptor.required && descriptor.field && isEmpty(frontmatter[descriptor.key], descriptor.field.type) ? 'Required' : null}
    postFile={postFile} projectPath={projectPath} schemaRequired={schemaRequired(descriptor.key)} onUploadMedia={onUploadMedia && (file => onUploadMedia(file, descriptor.key).then((src) => {
      // The attribute just uploaded into is the cover — on the card too.
      if (localCollection) { setCoverKey(descriptor.key); void bindLocalCardImageField(descriptor.key); }
      return src;
    }))} busy={!!busyKey || managingBusy}
    onBusyChange={busy => setBusyKey(busy ? descriptor.key : null)} />;
  const byline = ([['author', view.byline.author], ['date', bylineDateKey ? <PostBylineDate fieldKey={bylineDateKey} value={String(frontmatter[bylineDateKey] ?? '')}
    text={view.byline.dateKey === bylineDateKey ? view.byline.date : null} editing={editingDateKey === bylineDateKey} disabled={!!busyKey || managingBusy}
    onEditingChange={editing => setEditingDateKey(editing ? bylineDateKey : null)} onChange={publish} onCommit={commit} /> : view.byline.date],
    ['reading', view.byline.reading]] as const).filter(([, part]) => part);
  return <div className={`${POST_COLUMN_CLS} sq-post-frontmatter flex flex-col`}>
    {view.showCover && view.variant === 'cover' && <img src={coverPreview.url!} alt="" data-sq-post-cover="cover" className="sq-post-cover" />}
    <PostTitleFields title={title} subtitle={subtitleEditable ? subtitleText : null} subtitleKey={subtitleKey ?? undefined} fileName={fileName} onChange={publish} onCommit={onBlur} onFocusBody={onFocusBody} />
    {subtitleKey && !subtitleEditable && subtitleText.trim() && <p className="sq-post-subtitle">{subtitleText}</p>}
    {byline.length > 0 && <p className="sq-post-meta">{byline.map(([role, part], i) => <Fragment key={role}>{i > 0 && ' · '}{part}</Fragment>)}</p>}
    {view.showCover && view.variant !== 'cover' && <img src={coverPreview.url!} alt="" data-sq-post-cover={view.variant} className="sq-post-cover" />}
    <div className="mt-2">
      {/* w-fit: the count and chevron sit next to the title, not stranded at the column's far edge. */}
      <Row title="Properties" rightText={`${properties.length}${invalidCount ? ` · ${invalidCount} required` : ''}`} hover={false} size="sm" className="px-0 w-fit gap-2 text-text-muted"
        rowProps={{ role: 'button', tabIndex: 0, 'aria-expanded': open, onMouseDown: event => event.preventDefault(), onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!busyKey) setOpen(value => !value); } } }}
        right={[{ type: 'chevron', expanded: open, onToggle: () => { if (!busyKey) setOpen(value => !value); } }]} onClick={() => { if (!busyKey) setOpen(value => !value); }} />
      {open && editable.map(renderProperty)}
      {other.length > 0 && <>
        <Row title="Other properties" rightText={String(other.length)} size="sm" hover={false} className="px-0 w-fit gap-2"
          rowProps={{ role: 'button', tabIndex: 0, 'aria-expanded': otherOpen, onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOtherOpen(value => !value); } } }}
          right={[{ type: 'chevron', expanded: otherOpen, onToggle: () => setOtherOpen(value => !value) }]} onClick={() => setOtherOpen(value => !value)} />
        {otherOpen && other.map(renderProperty)}
      </>}
      {/* a quiet section action on the labels' edge (-ml-2 = the Button's px-2), never a bold line in the value column */}
      {open && <div className="sq-post-property-action"><Button ref={manageRef} variant="ghost" size="sm" className="-ml-2 px-2 font-normal" disabled={!canManageFields || !!busyKey} label="Manage collection fields" onClick={() => {
        const previous = document.activeElement; setManaging(true); returnFocus(() => addFieldRef.current, previous);
      }} /></div>}
    </div>
    <Popover isOpen={managing} onClose={closeManager} triggerRef={manageRef} width={320} placement="bottom-start" className="max-w-[calc(100vw-16px)]">
      <div ref={managerPanelRef} className="p-3 space-y-2">
        <Row title="Manage collection fields" hover={false} size="sm" className="px-0"
          right={adding ? undefined : [{ type: 'custom', unboxed: true, node: <Button ref={addFieldRef} label="Add field" icon={<PlusIcon className="w-4 h-4" />} variant="ghost" size="sm" disabled={managingBusy} onClick={() => setAdding(true)} /> }]} />
        <div className="text-2xs text-text-secondary">{localCollection ? `Changes apply to every post in ${localCollection}.` : 'These controls change the collection fields. Existing post values remain when a field is removed.'}</div>
        {(managementError || managementBlocked) && <OperationNotice title={durableLocal
          ? managementError === 'draft' ? 'The current post needs attention.' : 'Collection fields were not updated.'
          : 'Collection fields were not fully updated.'} detail={managementBlocked
          ? 'Some files may have changed. Keep this editor open and review the collection files before making further field changes.'
          : durableLocal && managementError === 'write' ? 'The change could not be stored. Your files are unchanged. Try again.'
            : 'Resolve the current post notice before changing collection fields.'} />}
        {adding && <AddFieldPopover collectionId={collectionId} existingNames={descriptors.map(d => d.key)} onLocalAdd={localCollection ? addLocal : null} onBeforeAdd={beforeCollectionChange} onBusyChange={setManagingBusy}
          blocked={managementBlocked || managementPending} onUnconfirmed={durableLocal ? undefined : blockManagement} durableLocal={durableLocal}
          onDone={() => { cancelAdd(); if (!durableLocal) void commit(); }} onCancel={cancelAdd} />}
        {fields.filter(field => !LOCKED_FIELDS.has(field.name)).map(field =>
          <Row key={field.id} title={<span title={field.name}>{propertyLabel(field.name)}</span>} size="sm" hover={false} className="px-0"
          right={[...(schemaRequired(field.name) ? [fieldAction('Make optional', `Make collection field ${field.name} optional`, () => makeOptional(field))] : []),
            fieldAction('Remove', `Remove collection field ${field.name}`, () => remove(field))]} />)}
      </div>
    </Popover>
  </div>;
});
