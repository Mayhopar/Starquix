import { memo, useCallback, useState, useRef } from 'react';
import type { ContentCollection } from '@/core/collections/types';
import type { DiscoveredPost } from '@/hooks/useContentCollections';
import { contentOps, newPostFrontmatter } from '@/core/collections/content-ops';
import { postFileName } from '@/core/collections/postFileName';
import { useDispatch } from '@/store/hooks';
import { useUndoContext } from '@/context/UndoContext';
import { usePostEditor } from '@/context/PostEditorContext';
import { useVariables } from '@/context/VariablesContext';
import { Row, IconButton } from '@/components/ui';
import { PageIcon, FolderIcon, PlusIcon, TrashIcon } from '@/assets/icons';


interface CollectionTreeProps {
  collection: ContentCollection;
  diskPosts: DiscoveredPost[];
}

export const CollectionTree = memo(function CollectionTree({ collection, diskPosts }: CollectionTreeProps) {
  const dispatch = useDispatch();
  const { takeSnapshot, claimSnapshot } = useUndoContext();
  const { editingPost, openPost, closePost } = usePostEditor();
  const currentEditingPost = useRef(editingPost); currentEditingPost.current = editingPost;
  const { setActiveCollectionId } = useVariables();
  const [isExpanded, setIsExpanded] = useState(true);
  const [issue, setIssue] = useState<string | null>(null);
  // A delete acts at once and ⌘Z brings the files back (owner 2026-11-10: delete anything AND undo). A second click
  // while one is in flight is ignored: it would fail and claim the post is "still available".
  const deleting = useRef(new Set<string>());

  const handleDeleteCollection = useCallback(async () => {
    if (deleting.current.has('collection')) return;
    deleting.current.add('collection');
    takeSnapshot();
    // local: synthesized rows (files are truth) — no doc collection to delete.
    // A doc collection's dispatch claims the snapshot itself (its files then have no ⌘Z, as before).
    if (!collection.id.startsWith('local:')) dispatch({ type: 'DELETE_CONTENT_COLLECTION', collectionId: collection.id });
    try { await contentOps.deleteCollection(collection.name, claimSnapshot()); setIssue(null); }
    catch { setIssue('The collection change could not be stored. Your posts are still available.'); }
    finally { deleting.current.delete('collection'); }
  }, [collection.id, collection.name, dispatch, takeSnapshot, claimSnapshot]);

  const handleNewPost = useCallback(async () => {
    const slug = `untitled-${Date.now()}`;
    // Shaped like the existing posts — a hardcoded triple broke files-truth
    // collections whose schema requires other fields (pubDate → overlay 500).
    try { await contentOps.createPost(collection.name, slug, newPostFrontmatter(diskPosts), ''); setIssue(null); }
    catch { setIssue('The post could not be created. Please try again.'); return; }
    // A created post the user then has to FIND is a dead end — open it. Also
    // moves focus off this button (a lingering focus made Space/Enter mint
    // more posts, found live 2026-08-10).
    setActiveCollectionId(null);
    openPost(collection.name, slug);
  }, [collection.name, diskPosts, openPost, setActiveCollectionId]);

  const handleSelectPost = useCallback((post: DiscoveredPost) => {
    setActiveCollectionId(null);
    openPost(collection.name, post.slug);
  }, [collection.name, openPost, setActiveCollectionId]);

  const handleDeletePost = useCallback(async (post: DiscoveredPost) => {
    const key = `post:${post.slug}`;
    if (deleting.current.has(key)) return;
    deleting.current.add(key);
    takeSnapshot();
    try {
      await contentOps.deletePost(collection.name, post.slug, claimSnapshot());
      setIssue(null);
      if (currentEditingPost.current?.slug === post.slug && currentEditingPost.current?.collection === collection.name) closePost();
    } catch { setIssue('The deletion could not be stored. Your post is still available.'); }
    finally { deleting.current.delete(key); }
  }, [collection.name, closePost, takeSnapshot, claimSnapshot]);

  return (
    <>
      {issue && <div role="alert" className="px-3 py-2 text-xs text-error">{issue}</div>}
      <Row
        depth={0}
        left={[
          {
            type: 'chevron',
            expanded: isExpanded,
            visible: diskPosts.length > 0,
            onToggle: () => setIsExpanded(!isExpanded),
          },
          { type: 'icon', icon: <FolderIcon className="w-4 h-4" /> },
        ]}
        title={
          <>
            <span className="text-xs truncate select-none">{collection.name}</span>
            <span className="text-xs text-text-secondary ml-1 font-normal">{diskPosts.length}</span>
          </>
        }
        right={[
          {
            type: 'custom',
            unboxed: true,
            showOnHover: true,
            node: (
              <IconButton
                size="sm"
                title="New post"
                className="bg-transparent hover:bg-transparent text-text-muted hover:text-text"
                onClick={(e) => { e.stopPropagation(); handleNewPost(); }}
              ><PlusIcon className="w-4 h-4" /></IconButton>
            ),
          },
          {
            type: 'custom',
            unboxed: true,
            showOnHover: true,
            node: (
              <IconButton
                size="sm"
                title="Delete collection"
                className="bg-transparent hover:bg-transparent text-text-muted hover:text-error"
                onClick={(e) => { e.stopPropagation(); void handleDeleteCollection(); }}
              ><TrashIcon className="w-4 h-4" /></IconButton>
            ),
          },
        ]}
        className="h-7 px-2 rounded gap-1"
        onClick={() => setIsExpanded(!isExpanded)}
      />

      {isExpanded && diskPosts.map(post => (
        <Row
          key={post.slug}
          depth={1}
          selected={editingPost?.slug === post.slug && editingPost?.collection === collection.name}
          left={[
            { type: 'chevron', expanded: false, visible: false },
            { type: 'icon', icon: <PageIcon className="w-4 h-4" /> },
          ]}
          title={<span className="text-xs truncate select-none font-normal">{postFileName(post)}</span>}
          right={[
            {
              type: 'custom',
              unboxed: true,
              showOnHover: true,
              node: (
                <IconButton
                  size="sm"
                  title="Delete post"
                  className="bg-transparent hover:bg-transparent text-text-muted hover:text-error"
                  onClick={(e) => { e.stopPropagation(); void handleDeletePost(post); }}
                ><TrashIcon className="w-4 h-4" /></IconButton>
              ),
            },
          ]}
          className="h-7 px-2 rounded gap-1"
          onClick={() => handleSelectPost(post)}
        />
      ))}

      {isExpanded && diskPosts.length === 0 && (
        <Row
          depth={1}
          hover
          left={[
            { type: 'chevron', expanded: false, visible: false },
            { type: 'icon', icon: <span /> },
          ]}
          title={<span className="text-xs text-text-secondary italic font-normal">No posts</span>}
          className="h-7 px-2 rounded gap-1"
        />
      )}
    </>
  );
});
