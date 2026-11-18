import { memo, useCallback, useState } from 'react';
import { useYjsValue, useDispatch, useEditorDoc } from '@/store/hooks';
import { selectContentCollection, selectContentCollections } from '@/store/collectionSelectors';
import { selectPostPageBinding } from '@/store/selectors';
import { readBlogSlotBinding } from '@/core/collections/yjsAccessors';
import { useUndoContext } from '@/context/UndoContext';
import { contentOps } from '@/core/collections/content-ops';
import type { FieldType } from '@/core/collections/types';

interface ContentFieldPickerProps {
  elementKey: string;
  slotKey: string;
  filterTypes: FieldType[];
  autoFieldType: FieldType;
  /** When set, uses post page bindings instead of blog slot bindings */
  pageId?: string;
}

export const ContentFieldPicker = memo(function ContentFieldPicker({
  elementKey, slotKey, filterTypes, autoFieldType, pageId,
}: ContentFieldPickerProps) {
  const dispatch = useDispatch();
  const doc = useEditorDoc();
  const { takeSnapshot } = useUndoContext();

  // Use post page binding when pageId is provided, otherwise blog slot binding
  const blogBinding = useYjsValue((doc) => !pageId ? readBlogSlotBinding(doc, slotKey) : null);
  const postBinding = useYjsValue((doc) => pageId ? selectPostPageBinding(doc, pageId) : null);
  const binding = pageId ? postBinding : blogBinding;

  const collection = useYjsValue((doc) =>
    binding ? selectContentCollection(doc, binding.collectionId) : undefined
  );
  const [addingNew, setAddingNew] = useState(false);
  const [newFieldName, setNewFieldName] = useState('');

  const currentField = binding?.bindings[elementKey] || '';

  const fields = collection?.fields.filter(f => filterTypes.includes(f.type)) || [];

  const handleChange = useCallback((fieldName: string) => {
    takeSnapshot();
    if (pageId) {
      if (fieldName === '') {
        dispatch({ type: 'REMOVE_POST_PAGE_BINDING', pageId, elementKey });
      } else {
        dispatch({ type: 'SET_POST_PAGE_BINDING', pageId, elementKey, fieldName });
      }
    } else {
      if (fieldName === '') {
        dispatch({ type: 'REMOVE_CONTENT_BINDING', elementKey, slotKey });
      } else {
        dispatch({ type: 'SET_CONTENT_BINDING', elementKey, slotKey, fieldName });
      }
    }
  }, [dispatch, elementKey, slotKey, pageId, takeSnapshot]);

  const handleAddField = useCallback(() => {
    if (!newFieldName.trim() || !collection) return;
    takeSnapshot();
    dispatch({
      type: 'ADD_COLLECTION_FIELD',
      collectionId: collection.id,
      field: {
        id: crypto.randomUUID(),
        name: newFieldName.trim(),
        type: autoFieldType,
        required: false,
      },
    });
    if (pageId) {
      dispatch({ type: 'SET_POST_PAGE_BINDING', pageId, elementKey, fieldName: newFieldName.trim() });
    } else {
      dispatch({ type: 'SET_CONTENT_BINDING', elementKey, slotKey, fieldName: newFieldName.trim() });
    }

    // Regenerate content.config.ts with updated schema
    const allCollections = selectContentCollections(doc);
    contentOps.writeContentConfig(allCollections).catch(() => { /* non-critical */ });

    setAddingNew(false);
    setNewFieldName('');
  }, [dispatch, doc, collection, elementKey, slotKey, pageId, newFieldName, autoFieldType, takeSnapshot]);

  if (!binding || !collection) return null;

  if (addingNew) {
    return (
      <div className="flex gap-1 mb-1">
        <input
          autoFocus
          value={newFieldName}
          onChange={e => setNewFieldName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAddField(); if (e.key === 'Escape') setAddingNew(false); }}
          placeholder="Field name"
          className="flex-1 h-6 px-1 text-xs bg-bg-secondary rounded text-text"
        />
      </div>
    );
  }

  return (
    <div className="mb-1">
      <select
        value={currentField}
        onChange={e => {
          if (e.target.value === '__new__') { setAddingNew(true); return; }
          handleChange(e.target.value);
        }}
        className="w-full h-6 px-1 text-xs bg-bg-secondary rounded text-text-muted"
      >
        <option value="">Content field: none</option>
        {fields.map(f => (
          <option key={f.id} value={f.name}>{f.name}</option>
        ))}
        <option value="__new__">+ new field</option>
      </select>
    </div>
  );
});
