/**
 * Dropzone - drag-and-drop / click-to-browse file target (ImageBlock &
 * FillBlock upload zones, deduped).
 */
import React, { useRef, useState } from 'react';
import { cx } from './cx';

export interface DropzoneProps {
  /** Called with the dropped/picked files */
  onFiles: (files: File[]) => void;
  /** input accept attribute, e.g. "image/*" */
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  className?: string;
  /** Zone content (label, icon, preview…) */
  children: React.ReactNode;
}

export function Dropzone({ onFiles, accept, multiple = false, disabled = false, className = '', children }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const emit = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    onFiles(Array.from(list));
  };

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) inputRef.current?.click();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (!disabled) emit(e.dataTransfer.files);
      }}
      className={cx(
        'flex flex-col items-center justify-center gap-1 rounded-inner border border-dashed border-stroke-darker bg-bg-contrast text-text-secondary text-xs cursor-pointer transition-colors hover:border-stroke-active hover:text-text-muted',
        dragOver && 'border-stroke-active bg-bg-hover text-text-muted',
        disabled && 'opacity-50 pointer-events-none',
        className,
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          emit(e.target.files);
          e.target.value = '';
        }}
      />
      {children}
    </div>
  );
}
