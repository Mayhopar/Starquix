import { useContext, useState, useCallback, useMemo, type ReactNode } from 'react';
import { stableContext } from '@/utils/stableContext';

interface EditingPost {
  collection: string;
  slug: string;
  /** Body line (1-based, body-relative) the writing view puts the caret on. */
  focusBodyLine?: number;
}

interface PreviewPost {
  collection: string;
  slug: string;
}

interface PostEditorContextValue {
  editingPost: EditingPost | null;
  openPost: (collection: string, slug: string, focusBodyLine?: number) => void;
  closePost: () => void;
  /** Currently previewed post on canvas (single click in tree) */
  previewPost: PreviewPost | null;
  setPreviewPost: (collection: string, slug: string) => void;
  clearPreviewPost: () => void;
}

const PostEditorContext = stableContext<PostEditorContextValue | null>('PostEditorContext', null);

export function PostEditorProvider({ children }: { children: ReactNode }) {
  const [editingPost, setEditingPost] = useState<EditingPost | null>(null);
  const [previewPost, setPreviewPostState] = useState<PreviewPost | null>(null);

  const openPost = useCallback((collection: string, slug: string, focusBodyLine?: number) => {
    setEditingPost({ collection, slug, ...(focusBodyLine ? { focusBodyLine } : {}) });
  }, []);

  const closePost = useCallback(() => {
    setEditingPost(null);
  }, []);

  const setPreviewPost = useCallback((collection: string, slug: string) => {
    setPreviewPostState({ collection, slug });
  }, []);

  const clearPreviewPost = useCallback(() => {
    setPreviewPostState(null);
  }, []);

  const value = useMemo(() => ({
    editingPost, openPost, closePost,
    previewPost, setPreviewPost, clearPreviewPost,
  }), [editingPost, openPost, closePost, previewPost, setPreviewPost, clearPreviewPost]);

  return (
    <PostEditorContext.Provider value={value}>
      {children}
    </PostEditorContext.Provider>
  );
}

export function usePostEditor() {
  const ctx = useContext(PostEditorContext);
  if (!ctx) throw new Error('usePostEditor must be used within PostEditorProvider');
  return ctx;
}
