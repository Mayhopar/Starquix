// src/components/ImportProjectModal.tsx
// "Import project": copy an Astro folder in as a files-truth project.
// A name field + confirm (like the old theme upload window), but a folder pick
// needs a webkitdirectory input, which ui/Dropzone does not expose.
import React, { useCallback, useRef, useState } from 'react';
import { Button, Field, Modal, OperationNotice, Row } from '@/components/ui';
import { CloseIcon } from '@/assets/icons';
import { entriesFromFileList } from '@/services/projectImport/processFolder';
import { importFilesTruthProject } from '@/services/projectImport/createFilesTruthProject';
import { importFeedback } from '@/services/projectImport/importFeedback';
import type { IssueCopy } from '@/utils/operationIssue';

interface ImportProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImported: (projectId: string) => void;
}

type State = 'idle' | 'reading' | 'importing' | 'error';

export const ImportProjectModal: React.FC<ImportProjectModalProps> = ({ isOpen, onClose, onImported }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState('');
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState<IssueCopy | null>(null);

  const reset = useCallback(() => { setFiles([]); setName(''); setState('idle'); setError(null); }, []);
  const handleClose = useCallback(() => { reset(); onClose(); }, [reset, onClose]);

  const handlePick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    if (list.length === 0) return;
    setFiles(list);
    const rel = (list[0] as File & { webkitRelativePath?: string }).webkitRelativePath || '';
    setName(rel.split('/')[0] || 'Imported project');
    setError(null);
  }, []);

  const handleImport = useCallback(async () => {
    if (files.length === 0 || !name.trim()) return;
    setState('reading');
    setError(null);
    let phase: 'read' | 'import' = 'read';
    try {
      const entries = await entriesFromFileList(files);
      phase = 'import';
      setState('importing');
      // Files-truth (Phase 6): the folder is copied in AS-IS and boots in
      // the desktop instance — no conversion.
      const r = await importFilesTruthProject(entries, name.trim());
      console.info('[import] done', r);
      const projectId = r.projectId;
      reset();
      onImported(projectId);
    } catch (err) {
      console.error('[Import] Failed', err);
      setError(importFeedback(err, phase));
      setState('error');
    }
  }, [files, name, reset, onImported]);

  const busy = state === 'reading' || state === 'importing';

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="sm" className="flex flex-col">
      <Row title="Import Astro project" className="pl-4 pr-2 border-b border-stroke" hover={false}
        right={[{ type: 'custom', unboxed: true, node: (
          <Button variant="ghost" size="sm" iconOnly aria-label="Close" icon={<CloseIcon className="w-4 h-4" />} onClick={handleClose} />
        ) }]} />

      <div className="px-4 py-2 space-y-2">
        <input
          ref={inputRef}
          type="file"
          data-testid="import-folder-input"
          className="hidden"
          multiple
          onChange={handlePick}
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        />
        <Row title="Folder" size="sm" className="px-0" hover={false}
          right={[{ type: 'custom', unboxed: true, node: (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              label={files.length > 0 ? `${files.length} files selected` : 'Choose folder…'}
            />
          ) }]} />

        <div>
          <Row title="Project name" size="sm" className="px-0" hover={false} />
          <Field
            type="text"
            value={name}
            onChange={setName}
            aria-label="Project name"
            disabled={busy}
            placeholder="My site"
          />
        </div>

        {error && <OperationNotice title={error.title} detail={error.detail} />}

        <div className="text-2xs text-text-secondary">Skips node_modules, build output and hidden files like .env. Up to 2,000 files / 500 MB.</div>
      </div>

      <div className="flex items-center gap-2 border-t border-stroke px-4 py-2">
        <div className="flex-1" />
        <Button variant="ghost" size="md" onClick={handleClose} label="Cancel" />
        <Button
          variant="primary"
          size="md"
          onClick={handleImport}
          disabled={files.length === 0 || !name.trim()}
          loading={busy}
          label={state === 'reading' ? 'Reading…' : state === 'importing' ? 'Importing…' : 'Import'}
        />
      </div>
    </Modal>
  );
};
