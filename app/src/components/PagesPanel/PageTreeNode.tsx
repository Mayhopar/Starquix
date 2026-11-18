import { HomeIcon as SharedHomeIcon, TrashIcon as SharedTrashIcon } from '@/assets/icons';
// src/components/PagesPanel/PageTreeNode.tsx
import { useState, useRef, useEffect, useCallback, useLayoutEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { usePages } from '@/context/PagesContext';
import { usePostEditor } from '@/context/PostEditorContext';
import { useContentCollections } from '@/hooks/useContentCollections';
import { useYjsValue, useEditorDoc } from '@/store/hooks';
import { selectIsPageRowVisible, selectPageBlogCollectionIds } from '@/store/selectors';
import { selectContentCollections } from '@/store/collectionSelectors';
import { useGoToPost } from '@/hooks/useGoToPost';
import { DRAG_TYPES } from '@/types/drag';
import type { PageData } from '@/store/types';
import { pageRoute } from '@/store/pageRoute';
import { useTreeNodeDnd, TreeDropIndicator, Row, MenuItem, Tooltip } from '@/components/ui';
import { useAI } from '@/ai/AIContext';
import { PageIcon, SparkleIcon } from '@/assets/icons';

interface PageTreeNodeProps {
  page: PageData;
  depth: number;
  index: number;
  siblingIds: string[];
  parentId: string | null;
}

export function PageTreeNode({
  page,
  depth,
  index,
  siblingIds,
  parentId,
}: PageTreeNodeProps) {
  const doc = useEditorDoc();
  const {
    activePageId,
    expandedIds,
    pages,
    setActivePage,
    toggleExpanded,
    expandPages,
    renamePage,
    deletePage,
    setHomePage,
  } = usePages();

  const { activeKeys, recentlyTouchedKeys } = useAI();
  const pageKey = `page:${page.id}`;
  const isAIActive = activeKeys.includes(pageKey);
  const isAITouched = !isAIActive && recentlyTouchedKeys.includes(pageKey);

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(page.name || '');
  const [showMenu, setShowMenu] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const skipRenameBlur = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (showMenu && rowRef.current) {
      const rect = rowRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom, left: rect.right - 120 });
    }
  }, [showMenu]);

  const { setNodeRef, attributes, listeners, isDragging, dropZone } = useTreeNodeDnd(
    page.id,
    DRAG_TYPES.PAGES_PANEL,
    isEditing,
  );

  const showIndicatorAbove = dropZone === 'above';
  const showIndicatorBelow = dropZone === 'below';
  const showNestHighlight = dropZone === 'inside';

  useEffect(() => {
    if (!isEditing) {
      setEditValue(page.name || '');
    }
  }, [page.name, isEditing]);

  // Blind review 2026-08-04 item 5: the row shows the page's ROUTE, in every
  // runtime — local listed `/`, `/about` while WC/server listed `index`,
  // `Page 2`. `pageRoute` is a pure derivation over the page DATA (see
  // store/pageRoute.ts for why routes won and why this is not a runtime
  // branch). Renaming is untouched and still edits the NAME the route derives
  // from: the input swaps to `editValue` only while editing, so a blur can
  // never write the displayed route back over the name.
  const route = pageRoute(page);

  const isActive = activePageId === page.id;
  const isExpanded = expandedIds.has(page.id);

  const blogCollectionIds = useYjsValue((doc) => selectPageBlogCollectionIds(doc, page.id));
  const hasBlogSlots = blogCollectionIds.length > 0;

  const childPages = useMemo(
    () => page.children
      .map(childId => pages.find(p => p.id === childId))
      .filter((p): p is NonNullable<typeof p> => p !== undefined && selectIsPageRowVisible(doc, p.id)),
    [page.children, pages, doc],
  );

  const hasChildren = childPages.length > 0 || hasBlogSlots;

  const canDelete = pages.length > 1;

  const style = {
    opacity: isDragging ? 0.5 : 1,
  };

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Auto-expand when hovering for nesting
  useEffect(() => {
    if (showNestHighlight && !isExpanded) {
      const timer = setTimeout(() => {
        expandPages([page.id]);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [showNestHighlight, isExpanded, expandPages, page.id]);

  useEffect(() => {
    if (!showMenu) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  const { clearPreviewPost } = usePostEditor();

  const handleClick = useCallback(() => {
    setActivePage(page.id);
    clearPreviewPost();
  }, [setActivePage, page.id, clearPreviewPost]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setShowMenu(true);
  }, []);

  // task-148: no confirm dialog — in local mode the delete removes a real
  // src/pages file, but ⌘Z puts the bytes back (structural undo entry), so the
  // gesture stays as immediate and undoable as every other runtime's.
  const handleDelete = useCallback(() => {
    if (canDelete) {
      deletePage(page.id);
    }
    setShowMenu(false);
  }, [canDelete, deletePage, page.id]);

  const handleDoubleClick = useCallback(() => {
    setIsEditing(true);
    setEditValue(page.name);
  }, [page.name]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isEditing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const trimmedValue = editValue.trim() || 'Untitled';
      if (trimmedValue !== page.name) renamePage(page.id, trimmedValue);
      setIsEditing(false);
      skipRenameBlur.current = true;
      (e.target as HTMLInputElement).blur();
      skipRenameBlur.current = false;
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setIsEditing(false);
      setEditValue(page.name);
      skipRenameBlur.current = true;
      (e.target as HTMLInputElement).blur();
      skipRenameBlur.current = false;
    }
  }, [isEditing, renamePage, page.id, editValue, page.name]);

  const handleBlur = useCallback(() => {
    if (!isEditing || skipRenameBlur.current) return;
    const trimmedValue = editValue.trim();
    if (trimmedValue && trimmedValue !== page.name) {
      renamePage(page.id, trimmedValue);
    }
    setIsEditing(false);
    setEditValue(trimmedValue || page.name || 'Untitled');
  }, [isEditing, editValue, page.name, renamePage, page.id]);

  const handleChevronClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    toggleExpanded(page.id);
  }, [toggleExpanded, page.id]);

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="relative space-y-px">
      {showIndicatorAbove && <TreeDropIndicator position="above" />}

      <Row
        ref={rowRef}
        rowProps={{ 'data-testid': 'page-item' }}
        depth={depth}
        selected={isActive}
        left={[
          {
            type: 'chevron',
            expanded: isExpanded,
            visible: hasChildren,
            onToggle: handleChevronClick,
          },
          {
            type: 'icon',
            icon: <PageIcon className={isActive ? 'w-4 h-4 text-text-muted' : 'w-4 h-4'} />,
          },
        ]}
        title={
          <span className="flex items-center gap-1 font-normal">
            <input
              ref={inputRef}
              type="text"
              value={isEditing ? editValue : route}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleBlur}
              readOnly={!isEditing}
              className={`flex-1 min-w-0 text-xs outline-none overflow-hidden text-ellipsis ${
                isEditing
                  ? 'text-text border border-stroke-active rounded px-1 cursor-text bg-bg-input-editing'
                  : 'text-inherit border-transparent cursor-grab bg-transparent'
              }`}
              onClick={(e) => {
                if (isEditing) e.stopPropagation();
              }}
              onPointerDown={(e) => {
                if (isEditing) e.stopPropagation();
              }}
            />
            {hasBlogSlots && (
              <span className="text-3xs leading-none text-text-secondary px-1 py-0.5 rounded bg-bg-hover shrink-0">
                Blog
              </span>
            )}
            {page.isHome && (
              <span className="text-3xs leading-none text-text-secondary px-1 py-0.5 rounded bg-bg-hover shrink-0">
                Home
              </span>
            )}
            {isAIActive && (
              <Tooltip content="AI is editing this page">
                <SparkleIcon className="w-4 h-4 text-text-secondary animate-pulse shrink-0" />
              </Tooltip>
            )}
            {isAITouched && (
              <Tooltip content="Edited by AI">
                <SparkleIcon className="w-4 h-4 text-text-secondary shrink-0" />
              </Tooltip>
            )}
          </span>
        }
        className={`h-7 px-2 rounded gap-1 cursor-grab active:cursor-grabbing ${showNestHighlight ? 'ring-2 ring-accent-strong ring-inset' : ''}`}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      />

      {showMenu && createPortal(
        <div
          ref={menuRef}
          className="fixed bg-bg border border-stroke rounded shadow-flyout py-1 z-flyout min-w-[120px]"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          <MenuItem
            label="Set as home"
            onSelect={() => { setHomePage(page.id); setShowMenu(false); }}
            disabled={page.isHome || page.pageType === 'post'}
            icon={
              <SharedHomeIcon className="w-4 h-4" />
            }
          />
          <MenuItem
            label="Delete"
            onSelect={handleDelete}
            disabled={!canDelete}
            icon={
              <SharedTrashIcon className="w-4 h-4" />
            }
          />
        </div>,
        document.body
      )}

      {showIndicatorBelow && <TreeDropIndicator position="below" />}

      {hasChildren && isExpanded && (
        <>
          <SortableContext items={childPages.map(c => c.id)} strategy={verticalListSortingStrategy}>
            {childPages.map((child, childIndex) => (
              <PageTreeNode
                key={child.id}
                page={child}
                depth={depth + 1}
                index={childIndex}
                siblingIds={childPages.map(c => c.id)}
                parentId={page.id}
              />
            ))}
          </SortableContext>

          {hasBlogSlots && (
            <BlogPostChildren
              pageId={page.id}
              blogCollectionIds={blogCollectionIds}
              depth={depth}
            />
          )}
        </>
      )}
    </div>
  );
}

/** Lazy sub-component: only mounts when page has blog slots AND is expanded.
 *  Isolates useContentCollections + usePostEditor hooks from every PageTreeNode. */
function BlogPostChildren({ pageId, blogCollectionIds, depth }: {
  pageId: string;
  blogCollectionIds: string[];
  depth: number;
}) {
  const yCollections = useYjsValue(selectContentCollections);
  const { collections: diskCollections } = useContentCollections();
  const { previewPost, openPost } = usePostEditor();
  const goToPost = useGoToPost();

  const blogPosts = useMemo(() => {
    // Dedupe by the React key — duplicate collection IDs or two Yjs
    // collections sharing a disk name would otherwise emit duplicate-key
    // warnings and force extra reconciliation.
    const seen = new Set<string>();
    const out: Array<{ slug: string; title: string; collectionName: string; collectionId: string }> = [];
    for (const colId of blogCollectionIds) {
      const yCol = yCollections.find(c => c.id === colId);
      if (!yCol) continue;
      const diskCol = diskCollections.find(d => d.name === yCol.name);
      if (!diskCol) continue;
      for (const post of diskCol.posts) {
        const key = `${yCol.name}/${post.slug}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ slug: post.slug, title: (post.frontmatter.title as string) || post.slug, collectionName: yCol.name, collectionId: colId });
      }
    }
    return out;
  }, [blogCollectionIds, yCollections, diskCollections]);

  const handleClickPost = useCallback((post: typeof blogPosts[number]) => {
    goToPost(post.collectionId, post.slug, pageId);
  }, [goToPost, pageId]);

  return (
    <>
      {blogPosts.map(post => {
        const isPostActive = previewPost?.collection === post.collectionName && previewPost?.slug === post.slug;
        return (
          <Row
            key={`${post.collectionName}/${post.slug}`}
            depth={depth + 1}
            selected={isPostActive}
            left={[
              { type: 'chevron', expanded: false, visible: false },
              {
                type: 'icon',
                icon: <PageIcon className={isPostActive ? 'w-4 h-4 text-text-muted' : 'w-4 h-4'} />,
              },
            ]}
            title={<span className="text-xs truncate select-none font-normal">{post.title}</span>}
            className="h-7 px-2 rounded gap-1"
            onClick={() => handleClickPost(post)}
            onDoubleClick={() => openPost(post.collectionName, post.slug)}
          />
        );
      })}
    </>
  );
}
