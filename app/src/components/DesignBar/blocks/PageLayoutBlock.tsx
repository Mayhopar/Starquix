/**
 * Page Layout Block
 *
 * Thin page-context wrapper around the shared LayoutPropsEditor. Resolves the
 * selected page's layout name + non-reserved declared props + current values from
 * Yjs, then renders LayoutPropsEditor in "page" mode (value Field per prop + 🗑
 * delete + "+ Add property"). Reserved props (title/description) are owned by
 * page.seo and edited in the SEO tab — filtered out here. Prop VALUE commits flow
 * through SET_PAGE_LAYOUT with takeSnapshot() first (one undo step); schema
 * add/delete is owned by LayoutPropsEditor (mutateLayoutProp → /__sq/layout-prop).
 */

import { useCallback, type FC } from 'react';
import { useDispatch, useYjsValue } from '@/store/hooks';
import { useUndoContext } from '@/context/UndoContext';
import { useLayoutLibrary } from '@/hooks/useLayoutLibrary';
import { selectPageLayout } from '@/store/selectors';
import { LAYOUT_SEO_RESERVED_PROPS } from '@/store/layoutReservedProps';
import { LayoutPropsEditor } from './LayoutPropsEditor';

interface PageLayoutBlockProps {
  /** Yjs id of the current page */
  pageId: string;
}

export const PageLayoutBlock: FC<PageLayoutBlockProps> = ({ pageId }) => {
  const dispatch = useDispatch();
  const { takeSnapshot } = useUndoContext();
  const { layouts } = useLayoutLibrary();

  const { layoutName, layoutProps } = useYjsValue((doc) => selectPageLayout(doc, pageId));

  // Reserved props (title/description) are owned by page.seo and edited in the
  // SEO panel — never as hand-typed layout props here.
  const propDefs = (layouts.find((l) => l.name === layoutName)?.props ?? [])
    .filter((p) => !LAYOUT_SEO_RESERVED_PROPS.has(p.name));

  const commitValue = useCallback(
    (name: string, value: string) => {
      takeSnapshot();
      dispatch({
        type: 'SET_PAGE_LAYOUT',
        pageId,
        layoutName,
        layoutProps: { ...layoutProps, [name]: value },
      });
    },
    [layoutProps, layoutName, pageId, takeSnapshot, dispatch],
  );

  // The Add row always shows when a layout is selected, so the block renders even
  // with zero non-reserved props. Only a page with no layout renders nothing.
  if (!layoutName) return null;

  return (
    <div data-testid="page-layout-block" className="px-2 pt-2 pb-3 border-b border-stroke">
      <LayoutPropsEditor
        layoutName={layoutName}
        propDefs={propDefs}
        mode="page"
        values={layoutProps}
        onCommitValue={commitValue}
      />
    </div>
  );
};

export default PageLayoutBlock;
