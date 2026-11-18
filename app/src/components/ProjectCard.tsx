// src/components/ProjectCard.tsx
import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { Project } from '@/api/types';
import { Button, Card, Field, OperationNotice, Row } from '@/components/ui';
import { TrashIcon, PencilIcon } from '@/assets/icons';
import { isStorageFailure } from '@/services/browserStorage';
import { issueKey, type OperationIssue } from '@/utils/operationIssue';

interface ProjectCardProps {
  project: Project;
  coverUrl?: string;
  onDelete: (projectId: string) => void;
  onRename: (projectId: string, newName: string) => void | Promise<void>;
  deleting?: boolean;
  deleteIssue?: OperationIssue;
}

export function ProjectCard({ project, coverUrl, onDelete, onRename, deleting, deleteIssue }: ProjectCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(project.name);
  const [renameFailure, setRenameFailure] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const draft = useRef(editValue);
  const pending = useRef(false);
  const attemptedDraft = useRef<string | null>(null);
  const active = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  useEffect(() => {
    if (!isEditing) { setEditValue(project.name); draft.current = project.name; }
  }, [project.name, isEditing]);
  useEffect(() => {
    if (isEditing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); }
  }, [isEditing]);

  const startEditing = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (pending.current || isEditing) return;
    draft.current = project.name;
    attemptedDraft.current = null;
    setEditValue(project.name);
    setRenameFailure(null);
    setIsEditing(true);
  };

  const commit = async (trigger: 'enter' | 'blur') => {
    if (pending.current || !active.current || deleting || deleteIssue) return;
    if (trigger === 'blur' && attemptedDraft.current === draft.current) return;
    const submitted = draft.current;
    const trimmed = submitted.trim();
    if (!trimmed || trimmed === project.name) {
      setRenameFailure(null);
      setIsEditing(false);
      return;
    }
    pending.current = true;
    attemptedDraft.current = submitted;
    setRenaming(true);
    try {
      await onRename(project._id, trimmed);
      if (!active.current) return;
      setRenameFailure(null);
      if (draft.current === submitted) setIsEditing(false);
    } catch (error) {
      if (active.current) setRenameFailure(isStorageFailure(error)
        ? 'The name was not saved. Free device storage without clearing this site’s data, then submit your draft again.'
        : 'The name was not saved. Your draft is kept here; submit it again when you are ready.');
    } finally {
      pending.current = false;
      if (active.current) setRenaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation();
      void commit('enter');
    } else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (pending.current) return;
      draft.current = project.name;
      setEditValue(project.name);
      setRenameFailure(null);
      setIsEditing(false);
    }
  };

  return (
    <div>
      <Link to={`/editor/${project._id}`} onClick={e => { if (isEditing || deleting || deleteIssue) e.preventDefault(); }} className="group block">
        <Card interactive className="bg-bg rounded-lg transition-all duration-200">
          <div className="relative aspect-video bg-bg-contrast border-b border-stroke overflow-hidden">
            {coverUrl ? <img src={coverUrl} alt={project.name} className="w-full h-full object-cover" /> : (
              <div className="absolute inset-0 flex items-center justify-center"><div className="text-sm text-text-secondary">Preview</div></div>
            )}
          </div>
          <Row hover={false} className="px-3 py-2" title={isEditing ? (
            <Field ref={inputRef} aria-label="Project name" value={editValue} disabled={deleting || !!deleteIssue}
              onChange={value => { draft.current = value; setEditValue(value); }}
              onKeyDown={handleKeyDown} onBlur={() => { void commit('blur'); }} error={!!renameFailure} />
          ) : <p className="text-sm-medium text-text truncate">{project.name}</p>}
            right={[
              ...(renaming ? [{ type: 'spinner' as const }] : []),
              { type: 'custom', unboxed: true, node: <Button variant="ghost" size="sm" iconOnly
                icon={<PencilIcon className="w-4 h-4" />} aria-label="Rename Project" title="Rename Project"
                disabled={renaming || deleting || !!deleteIssue} onClick={startEditing}
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-200" /> },
              { type: 'custom', unboxed: true, node: <Button variant="ghost" size="sm" iconOnly
                icon={<TrashIcon className="w-4 h-4" />} aria-label="Delete Project" title="Delete Project"
                disabled={renaming || deleting} onClick={e => { e.preventDefault(); e.stopPropagation(); onDelete(project._id); }}
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-200" /> },
            ]} />
        </Card>
      </Link>
      {renameFailure && <OperationNotice title={renameFailure} />}
      {deleteIssue && <OperationNotice key={issueKey(deleteIssue)} title="Project deletion did not finish."
        detail="Some project data may have been removed. This card stays here until deletion finishes." />}
    </div>
  );
}
