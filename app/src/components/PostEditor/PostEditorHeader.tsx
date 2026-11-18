import { useRef, useState } from 'react';
import { Button, Popover, Row } from '@/components/ui';
import { LayoutStackedIcon } from '@/assets/icons';
import { PostLayoutBlock } from '@/components/DesignBar/blocks/PostLayoutBlock';
import type { PostLayoutSettings } from '@/core/post/postLayoutProps';

/**
 * The writing view's bar: where the post lives, and the post layout (header
 * style + what the header shows) — the same settings panel the canvas shows,
 * editing this collection's post route, so the writer never has to leave.
 */
export function PostEditorHeader({ collection, fileName, onLayoutChange }: {
  collection: string;
  fileName: string;
  onLayoutChange?: (settings: PostLayoutSettings) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return <header className="h-10 shrink-0 border-b border-stroke bg-bg">
    <Row size="sm" hover={false} className="h-10 px-4" title={
      <span className="text-xs text-text-muted" title={`${collection} / ${fileName}`}>
        {collection}<span aria-hidden="true"> / </span>{fileName}
      </span>
    } right={[{ type: 'custom', unboxed: true, node: <Button ref={triggerRef} size="sm" variant="ghost" label="Post layout"
      icon={<LayoutStackedIcon className="w-4 h-4" />} active={open} onClick={() => setOpen(o => !o)} /> }]} />
    <Popover isOpen={open} onClose={() => setOpen(false)} triggerRef={triggerRef} placement="bottom-end" width={280}>
      <PostLayoutBlock file={`src/pages/${collection}/[slug].astro`} onChange={onLayoutChange} className="p-2" />
    </Popover>
  </header>;
}
