import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Editor } from '@tiptap/react';
import { GripIcon } from '@/assets/icons';
import { Button, Menu, MenuItem } from '@/components/ui';
import {
  blockAt, selectBlock, moveBlock, moveBlockToPos, canDropAt, duplicateBlock, deleteBlock, turnInto, canTurnInto,
  TEXT_STYLES, type BlockRef,
} from './blockCommands';

/**
 * Notion-style block handle (owner 2026-09-30): hover any block → ⋮⋮ in the
 * left gutter. Click → the block is selected and a menu opens (Turn into,
 * Duplicate, Move up/down, Delete). Drag → a line shows where it lands — any
 * container: the page, a column, either side of a row; drop moves it. Every action is one transaction (⌘Z) and
 * `onChanged` saves it.
 */
const HANDLE = 24;
const DRAG_THRESHOLD = 4;

type Hover = { ref: BlockRef; left: number; top: number };
type Drop = { at: number; top: number; left: number; width: number };

export function BlockHandle({ editor, wrapperRef, onChanged }: {
  editor: Editor | null;
  wrapperRef: RefObject<HTMLDivElement | null>;
  onChanged: () => void;
}) {
  const [hover, setHover] = useState<Hover | null>(null);
  const [menu, setMenu] = useState<BlockRef | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  // read inside the long-lived listeners (their closures would be stale)
  const hoverRef = useRef<Hover | null>(null);
  hoverRef.current = hover;
  const menuRef = useRef(menu);
  menuRef.current = menu;
  const dragging = useRef(false);

  const place = (ref: BlockRef): Hover | null => {
    const dom = editor?.view.nodeDOM(ref.pos) as HTMLElement | null;
    const wrapper = wrapperRef.current?.getBoundingClientRect();
    if (!dom?.getBoundingClientRect || !wrapper) return null;
    const r = dom.getBoundingClientRect();
    const pane = wrapperRef.current?.closest('.sq-post-writing-area')?.getBoundingClientRect();
    // first line of text blocks, the top of atoms/layouts
    const lineTop = Math.min(r.height, parseFloat(getComputedStyle(dom).lineHeight) || HANDLE) / 2 - HANDLE / 2;
    const left = Math.max(r.left - HANDLE - 6, (pane?.left ?? r.left) + 4);
    return { ref, left: left - wrapper.left, top: r.top - wrapper.top + Math.max(0, lineTop) };
  };

  // Hover tracking over the whole writing area (the gutter included).
  useEffect(() => {
    if (!editor) return;
    const area = wrapperRef.current?.closest('.sq-post-writing-area') as HTMLElement | null;
    if (!area) return;
    // hit-testing (posAtCoords) at most once per frame, on the latest pointer position
    let frame = 0;
    let last: MouseEvent | null = null;
    const hitTest = () => {
      frame = 0;
      const e = last;
      if (!e || dragging.current || menuRef.current) return;
      if (handleRef.current?.contains(e.target as Node)) return;
      const pm = editor.view.dom.getBoundingClientRect();
      const x = Math.min(Math.max(e.clientX, pm.left + 2), pm.right - 2);
      const hit = editor.view.posAtCoords({ left: x, top: e.clientY });
      const ref = hit ? blockAt(editor.state.doc, hit.pos, hit.inside) : null;
      if (!ref) { setHover(null); return; }
      if (hoverRef.current?.ref.pos === ref.pos && hoverRef.current.ref.node === ref.node) return;
      setHover(place(ref));
    };
    const onMove = (e: MouseEvent) => { last = e; if (!frame) frame = requestAnimationFrame(hitTest); };
    const onLeave = () => { last = null; if (!dragging.current && !menuRef.current) setHover(null); };
    const onDocChange = ({ transaction }: { transaction: { docChanged: boolean } }) => { if (transaction.docChanged && !dragging.current) setHover(null); };
    area.addEventListener('mousemove', onMove);
    area.addEventListener('mouseleave', onLeave);
    editor.on('transaction', onDocChange);
    return () => { cancelAnimationFrame(frame); area.removeEventListener('mousemove', onMove); area.removeEventListener('mouseleave', onLeave); editor.off('transaction', onDocChange); };
  }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Where a drop lands: the gap before/after the block under the pointer, in
   * WHATEVER container that block is in — the page, a column, either side of a
   * row (so a block crosses columns horizontally). Where the schema refuses it
   * (a layout into a row's side) the enclosing block's gap is tried instead.
   */
  const dropAt = (ref: BlockRef, clientX: number, clientY: number): Drop | null => {
    if (!editor) return null;
    const { state, view } = editor;
    const wrapper = wrapperRef.current?.getBoundingClientRect();
    const hit = view.posAtCoords({ left: clientX, top: clientY });
    if (!wrapper || !hit) return null;
    for (let over = blockAt(state.doc, hit.pos, hit.inside); over; ) {
      const r = (view.nodeDOM(over.pos) as HTMLElement | null)?.getBoundingClientRect?.();
      if (!r) return null;
      const before = clientY < r.top + r.height / 2;
      const at = before ? over.pos : over.pos + over.node.nodeSize;
      if (canDropAt(state, ref, at)) {
        if (at === ref.pos || at === ref.pos + ref.node.nodeSize) return null; // its own place
        return { at, top: (before ? r.top - 4 : r.bottom + 4) - wrapper.top, left: r.left - wrapper.left, width: r.width };
      }
      const outer = blockAt(state.doc, over.pos);
      over = outer && outer.pos !== over.pos ? outer : null;
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const start = hoverRef.current;
    if (!editor || !start || e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    let frame = 0;
    let last: PointerEvent | null = null;
    const track = () => {
      frame = 0;
      if (!last) return;
      const next = dropAt(start.ref, last.clientX, last.clientY);
      setDrop(prev => (prev && next && prev.at === next.at && prev.top === next.top ? prev : next));
    };
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_THRESHOLD) return;
      moved = true; dragging.current = true;
      last = ev;
      if (!frame) frame = requestAnimationFrame(track);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      cancelAnimationFrame(frame);
      dragging.current = false;
      setDrop(null);
      if (!moved) { selectBlock(editor, start.ref); setMenu(start.ref); return; }
      const target = dropAt(start.ref, ev.clientX, ev.clientY);
      if (target && moveBlockToPos(editor, start.ref, target.at)) onChanged();
      setHover(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const act = (run: () => boolean) => { setMenu(null); if (run()) onChanged(); };
  return <>
    {hover && <div className="absolute" style={{ left: hover.left, top: hover.top }} data-sq-block-handle="">
      <Button ref={handleRef} size="sm" variant="ghost" iconOnly aria-label="Drag to move · click for block options" title="Drag to move · click for options"
        active={menu !== null} className="cursor-grab text-text-muted" icon={<GripIcon className="w-4 h-4" />}
        onPointerDown={onPointerDown} onClick={e => e.preventDefault()} />
    </div>}
    {drop && <div aria-hidden="true" className="absolute h-0.5 rounded-full bg-overlay-selection pointer-events-none" style={{ left: drop.left, top: drop.top, width: drop.width }} />}
    <Menu isOpen={menu !== null} onClose={() => { setMenu(null); setHover(null); }} triggerRef={handleRef}>
      {menu && editor && canTurnInto(menu) && TEXT_STYLES.map(s => (
        <MenuItem key={s.value} label={`Turn into ${s.label.toLowerCase()}`} onSelect={() => act(() => turnInto(editor, menu, s.value))} />
      ))}
      {menu && editor && <>
        <MenuItem label="Duplicate" onSelect={() => act(() => duplicateBlock(editor, menu))} />
        <MenuItem label="Move up" onSelect={() => act(() => moveBlock(editor, menu, -1))} />
        <MenuItem label="Move down" onSelect={() => act(() => moveBlock(editor, menu, 1))} />
        <MenuItem label="Delete" danger onSelect={() => act(() => deleteBlock(editor, menu))} />
      </>}
    </Menu>
  </>;
}
