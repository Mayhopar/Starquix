import React, { useEffect, useRef, useState } from 'react';
import { Row, Field } from '@/components/ui';
import type { SeoFieldState } from '@/store/seo/headSeo';

interface Props<F extends string> {
  label: string;
  field: F;
  st: SeoFieldState;
  save: (field: F, value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  /** Search engines cut longer text: the counter turns to warning past it. */
  max?: number;
  trailing?: React.ReactNode;
}

/**
 * A label row + a full-width field that commits on blur / Enter (one durable
 * write per edit, never per keystroke). While focused, the user's text wins
 * over a re-read; Escape returns to the file's value.
 */
export function SeoTextField<F extends string>({ label, field, st, save, placeholder, multiline, max, trailing }: Props<F>) {
  const committed = typeof st.value === 'string' ? st.value : '';
  const [draft, setDraft] = useState(committed);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(committed); }, [committed]);

  const commit = () => {
    focused.current = false;
    if (draft.replace(/\s+/g, ' ').trim() !== committed) save(field, draft);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
    if (e.key === 'Escape') { setDraft(committed); focused.current = false; requestAnimationFrame(() => (e.target as HTMLElement).blur()); }
  };
  const length = (draft || st.placeholder || '').length;
  const setIn = st.setIn ? `${st.setIn.file.split('/').pop()}:${st.setIn.line}` : undefined;
  const shared = {
    value: draft,
    onChange: (v: string) => setDraft(v),
    onFocus: () => { focused.current = true; },
    onBlur: commit,
    onKeyDown,
    placeholder: st.placeholder ?? placeholder,
    disabled: !st.editable,
    'aria-label': label,
    error: st.duplicateIn ? `Also set in ${st.duplicateIn}` : undefined,
  };

  return (
    <div data-testid={`seo-${field}`}>
      <Row hover={false} title={label} size="sm" className="px-0"
        rightText={setIn ?? (max ? `${length}/${max}` : undefined)}
        right={max && !setIn && length > max ? [{ type: 'badge', label: 'Long', variant: 'warning' }] : undefined} />
      {multiline
        ? <Field as="textarea" rows={3} {...shared} />
        : <Field {...shared} trailing={trailing} />}
    </div>
  );
}
