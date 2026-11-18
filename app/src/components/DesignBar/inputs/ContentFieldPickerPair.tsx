import { type FC } from 'react';
import { ContentFieldPicker } from './ContentFieldPicker';
import type { FieldType } from '@/core/collections/types';

/**
 * The blog-slot + post-page ContentFieldPicker pair, rendered identically inside
 * the Appearance (image), Link (url), and Typography (text) blocks. Only the
 * field types and an optional `enabled` gate differ — so the two-branch logic
 * lives here once instead of being copy-pasted per block.
 */
interface ContentFieldPickerPairProps {
  elementKey: string | null;
  filterTypes: FieldType[];
  autoFieldType: FieldType;
  isInsideBlogSlot: boolean;
  blogSlotKey: string | null;
  showPostPicker: boolean;
  postPageSlotKey: string | null;
  /** Extra gate (e.g. only for image elements). Defaults to true. */
  enabled?: boolean;
}

export const ContentFieldPickerPair: FC<ContentFieldPickerPairProps> = ({
  elementKey, filterTypes, autoFieldType,
  isInsideBlogSlot, blogSlotKey, showPostPicker, postPageSlotKey,
  enabled = true,
}) => {
  if (!enabled) return null;
  return (
    <>
      {isInsideBlogSlot && blogSlotKey && elementKey && (
        <ContentFieldPicker elementKey={elementKey} slotKey={blogSlotKey} filterTypes={filterTypes} autoFieldType={autoFieldType} />
      )}
      {showPostPicker && (
        <ContentFieldPicker elementKey={elementKey!} slotKey={postPageSlotKey!} filterTypes={filterTypes} autoFieldType={autoFieldType} pageId={postPageSlotKey!} />
      )}
    </>
  );
};

export default ContentFieldPickerPair;
