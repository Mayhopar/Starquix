/**
 * Field presets: SearchField, UnitField, InlineEdit.
 */
import React, { forwardRef, useEffect, useRef, useState } from 'react';
import { SearchIcon, CloseIcon } from '@/assets/icons';
import { Field, type FieldProps, type InputSize } from './Field';
import { cx } from './cx';

// ── SearchField ────────────────────────────────────────────────────────

export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  size?: InputSize;
  className?: string;
  autoFocus?: boolean;
  'aria-label'?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

/** Search input with leading search icon and a clear button when non-empty. */
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(
  ({ value, onChange, placeholder = 'Search…', size = 'md', className, onKeyDown, autoFocus, ...rest }, ref) => {
    const innerRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
      if (autoFocus) innerRef.current?.focus();
    }, [autoFocus]);

    return (
      <Field
        ref={(el) => {
          (innerRef as React.MutableRefObject<HTMLInputElement | null>).current = el as HTMLInputElement | null;
          if (typeof ref === 'function') ref(el as HTMLInputElement | null);
          else if (ref) ref.current = el as HTMLInputElement | null;
        }}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        size={size}
        className={className}
        aria-label={rest['aria-label'] ?? 'Search'}
        icon={<SearchIcon className="w-4 h-4" />}
        onKeyDown={onKeyDown}
        trailing={
          value ? (
            <button
              type="button"
              aria-label="Clear search"
              className="flex items-center justify-center w-4 h-4 cursor-pointer text-text-secondary hover:text-text"
              onClick={() => {
                onChange('');
                innerRef.current?.focus();
              }}
            >
              <CloseIcon className="w-4 h-4" />
            </button>
          ) : undefined
        }
      />
    );
  },
);
SearchField.displayName = 'SearchField';

// ── UnitField ──────────────────────────────────────────────────────────

export type UnitFieldProps = Omit<Extract<FieldProps, { as?: 'input' }>, 'as' | 'type'>;

/** Numeric field with a unit suffix (the SpacingBlock control, deduped). */
export const UnitField = forwardRef<HTMLInputElement, UnitFieldProps>((props, ref) => (
  <Field ref={ref as React.Ref<HTMLInputElement>} {...props} type="number" />
));
UnitField.displayName = 'UnitField';

// ── InlineEdit ─────────────────────────────────────────────────────────

export interface InlineEditProps {
  value: string;
  /** Commit handler — called on Enter or blur with a changed, non-empty value */
  onCommit: (value: string) => void;
  /** Whether editing is active (controlled) */
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  className?: string;
  inputClassName?: string;
  'aria-label'?: string;
}

/** Click-to-rename text: renders plain text, or an input while `editing`.
 *  Enter/blur commits, Escape cancels. */
export function InlineEdit({
  value,
  onCommit,
  editing,
  onEditingChange,
  className,
  inputClassName,
  ...rest
}: InlineEditProps) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(value);
      // Focus after mount
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing, value]);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
    onEditingChange(false);
  };

  if (!editing) {
    return <span className={cx('truncate', className)}>{value}</span>;
  }

  return (
    <input
      ref={inputRef}
      value={draft}
      aria-label={rest['aria-label'] ?? 'Rename'}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') onEditingChange(false);
      }}
      onClick={(e) => e.stopPropagation()}
      className={cx(
        'bg-input-fill border border-stroke-active rounded-sm px-1 text-xs text-text outline-none min-w-0 w-full',
        inputClassName,
      )}
    />
  );
}
