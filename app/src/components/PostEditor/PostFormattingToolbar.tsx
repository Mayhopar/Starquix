import { useRef, useMemo, useState, useEffect, createRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import { Button, Field, Popover } from '@/components/ui';
import { CodeBracesIcon, LinkIcon, PaletteIcon, FormatBoldIcon, FormatItalicIcon, FormatStrikeIcon } from '@/assets/icons';
import type { SelectionAnchor } from './selectionAnchor';
import { TEXT_STYLES, currentTextStyle, applyTextStyle, type TextStyle } from './blockCommands';
import { Divider } from './StackToolbar';

export function PostFormattingToolbar({ editor, anchor, onClose, onColor }: {
  editor: Editor; anchor: SelectionAnchor | null; onClose: () => void;
  /** editorial layouts D7: group the selected blocks into a colored section */
  onColor?: () => void;
}) {
  const triggerRef = useMemo(() => createRef<HTMLSpanElement>(), [anchor?.rect.left, anchor?.rect.top, anchor?.rect.width]);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const editingLink = linkDraft !== null;
  useEffect(() => { if (editingLink) toolbarRef.current?.querySelector('input')?.focus(); }, [editingLink]);
  if (!anchor) return null;
  const restore = () => editor.chain().setTextSelection({ from: anchor.from, to: anchor.to }).focus();
  const close = () => {
    if (toolbarRef.current?.contains(document.activeElement)) restore().run();
    setLinkDraft(null);
    onClose();
  };
  const setStyle = (value: string) => applyTextStyle(editor, restore(), value as TextStyle).run();
  const applyLink = () => {
    const href = (linkDraft ?? '').trim();
    if (href) restore().extendMarkRange('link').setLink({ href }).run();
    else restore().extendMarkRange('link').unsetLink().run();
    setLinkDraft(null);
  };
  const mark = (name: string, label: string, content: ReactNode, run: () => void) =>
    <Button size="sm" variant="ghost" iconOnly aria-label={label} title={label} active={editor.isActive(name)} icon={content} onClick={run} />;
  return <>
    {createPortal(<span aria-hidden="true" ref={triggerRef} className="fixed pointer-events-none" style={{ left: anchor.rect.left + anchor.rect.width / 2, top: anchor.rect.top, width: 0, height: 0 }} />, document.body)}
    <Popover isOpen onClose={close} triggerRef={triggerRef} placement="top" offset={8}>
      <div ref={toolbarRef} role="toolbar" aria-label="Text formatting" className="flex items-center gap-0.5 p-1"
        onMouseDown={event => { const tag = (event.target as HTMLElement).tagName; if (tag !== 'SELECT' && tag !== 'INPUT') event.preventDefault(); }}
        onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); if (linkDraft !== null) setLinkDraft(null); else close(); } }}>
        {linkDraft !== null ? <>
          <Field size="sm" aria-label="Link address" placeholder="https://…" value={linkDraft} containerClassName="w-56"
            onChange={value => setLinkDraft(String(value))}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); applyLink(); } }} />
          <Button size="sm" variant="primary" label="Apply" onClick={applyLink} />
          {editor.isActive('link') && <Button size="sm" variant="ghost" label="Remove" onClick={() => { restore().extendMarkRange('link').unsetLink().run(); setLinkDraft(null); }} />}
        </> : <>
          <Field as="select" size="sm" aria-label="Text style" value={currentTextStyle(editor)} options={[...TEXT_STYLES]} onChange={value => setStyle(String(value))} />
          <Divider />
          {mark('bold', 'Bold', <FormatBoldIcon aria-hidden="true" className="w-4 h-4" />, () => restore().toggleBold().run())}
          {mark('italic', 'Italic', <FormatItalicIcon aria-hidden="true" className="w-4 h-4" />, () => restore().toggleItalic().run())}
          {mark('strike', 'Strikethrough', <FormatStrikeIcon aria-hidden="true" className="w-4 h-4" />, () => restore().toggleStrike().run())}
          {mark('code', 'Inline code', <CodeBracesIcon className="w-4 h-4" />, () => restore().toggleCode().run())}
          <Divider />
          {mark('link', 'Link', <LinkIcon className="w-4 h-4" />, () => setLinkDraft(String(editor.getAttributes('link').href ?? '')))}
          {onColor && <>
            <Divider />
            <Button size="sm" variant="ghost" iconOnly aria-label="Put on a colored section" title="Put on a colored section" icon={<PaletteIcon className="w-4 h-4" />} onClick={() => { restore().run(); onColor(); }} />
          </>}
        </>}
      </div>
    </Popover>
  </>;
}
