import { useEffect, useRef } from 'react';

export interface PostTitleFieldsProps {
  title: string | null;
  subtitle: string | null;
  /** the frontmatter key the subtitle is (the page's pick: description / subtitle / excerpt) */
  subtitleKey?: string;
  fileName: string;
  onChange: (key: string, value: string) => void;
  onCommit: () => void;
  onFocusBody: () => void;
}
function resize(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = '0';
  element.style.height = `${element.scrollHeight}px`;
}
export function PostTitleFields({ title, subtitle, subtitleKey = 'subtitle', fileName, onChange, onCommit, onFocusBody }: PostTitleFieldsProps) {
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const subtitleRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { resize(titleRef.current); }, [title]);
  useEffect(() => { resize(subtitleRef.current); }, [subtitle]);
  useEffect(() => {
    if (titleRef.current?.value === '') titleRef.current.focus();
  }, []);
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const widths = new WeakMap<Element, number>();
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        if (widths.get(entry.target) === entry.contentRect.width) continue;
        widths.set(entry.target, entry.contentRect.width);
        resize(entry.target as HTMLTextAreaElement);
      }
    });
    if (titleRef.current) observer.observe(titleRef.current);
    if (subtitleRef.current) observer.observe(subtitleRef.current);
    return () => observer.disconnect();
  }, [title === null, subtitle === null]);
  const enter = (event: React.KeyboardEvent<HTMLTextAreaElement>, next: () => void) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    // Moving focus commits via blur exactly once; composition never exits.
    event.currentTarget.blur();
    next();
  };
  return <>
    {title === null ? <h1 className="sq-post-title">{fileName}</h1> : <textarea
      ref={titleRef} value={title} aria-label="Title" placeholder="Title" rows={1}
      className="sq-post-title sq-post-title-input"
      onChange={event => onChange('title', event.target.value)} onBlur={onCommit}
      onInput={event => resize(event.currentTarget)}
      onKeyDown={event => enter(event, () => subtitleRef.current ? subtitleRef.current.focus() : onFocusBody())}
    />}
    {subtitle !== null && <textarea
      ref={subtitleRef} value={subtitle} aria-label="Subtitle" placeholder="Add a subtitle" rows={1}
      className="sq-post-subtitle sq-post-title-input"
      onChange={event => onChange(subtitleKey, event.target.value)} onBlur={onCommit}
      onInput={event => resize(event.currentTarget)} onKeyDown={event => enter(event, onFocusBody)}
    />}
  </>;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/**
 * The byline's date, edited where the page draws it (like the title). A date-only
 * value gets the native date input, a timestamp a text input that keeps it whole;
 * the kind is fixed when editing starts. Every change publishes (a focused draft
 * stays durable); closing without a change commits nothing, like a property row.
 */
export function PostBylineDate({ fieldKey, value, text, editing, disabled, onEditingChange, onChange, onCommit }: {
  fieldKey: string; value: string; text: string | null; editing: boolean; disabled: boolean;
  onEditingChange: (editing: boolean) => void; onChange: (key: string, value: string) => void; onCommit: () => unknown;
}) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const session = useRef({ dateOnly: true, changed: false, done: false, refocus: false });
  useEffect(() => {
    if (!editing) { if (session.current.refocus) triggerRef.current?.focus(); return; }
    inputRef.current?.focus();
    // The calendar opens with the click; without a user activation the focused input is enough.
    if (session.current.dateOnly) try { inputRef.current?.showPicker?.(); } catch { /* not user-activated */ }
  }, [editing]);
  const open = () => {
    if (disabled) return;
    session.current = { dateOnly: DATE_ONLY.test(value), changed: false, done: false, refocus: false };
    onEditingChange(true);
  };
  const finish = (refocus: boolean) => {
    if (session.current.done) return;
    session.current.done = true; session.current.refocus = refocus;
    onEditingChange(false);
    if (session.current.changed) void onCommit();
  };
  if (editing) return <input ref={inputRef} type={session.current.dateOnly ? 'date' : 'text'} aria-label={fieldKey} value={value}
    size={Math.max(value.length, 10)} className="sq-post-meta-input" onBlur={() => finish(false)}
    onChange={event => { session.current.changed = true; onChange(fieldKey, event.target.value); }}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(true); }
    }} />;
  return <span ref={triggerRef} role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled || undefined} aria-label={`Edit ${fieldKey}`}
    className="sq-post-meta-date" onClick={open}
    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } }}>{text ?? value}</span>;
}
