import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { Popover, Row, EmptyState } from '@/components/ui';
import { isSystemComponentPath, SQ_OURS as OURS, SQ_HIDDEN } from '@/utils/systemComponents';
import {
  LayoutTextImageIcon, LayoutTwoColumnsIcon, LayoutColoredSectionIcon,
  ImageIcon, ComponentIcon, CodeBracesIcon, AngleIcon, Heading2Icon, Heading3Icon,
  ListBulletedIcon, ListNumberedIcon, QuoteIcon, MinusIcon, type IconComponent,
} from '@/assets/icons';

/**
 * The `/` component menu for a post body.
 *
 * task-207 D12 made the decision task-206 deferred: the menu lists EVERY
 * `.astro` under `src/components/sq/`, ours first. There is still no registry —
 * the folder IS the list, so promoting a component is all it takes to make it
 * insertable. The server-side allowlist keeps its real job (guarding the
 * copy-from-template path against a client-supplied name); it is not a
 * DISPLAY filter.
 */
export type LayoutPreset = 'text-image' | 'two-columns' | 'colored';
/** Plain writing blocks — the ones the page styles (articleTokens BODY). Work in .md and .mdx. */
export type TextBlock = 'h2' | 'h3' | 'ul' | 'ol' | 'quote' | 'hr' | 'code' | 'custom';

interface SlashItemBase {
  label: string;
  caption?: string;
}
/** A writing block, applied in place of the `/` paragraph (no component). */
export interface TextSlashItem extends SlashItemBase { text: TextBlock; component?: undefined; layout?: undefined }
export interface ComponentSlashItem extends SlashItemBase {
  /** Local name preferred for the import; the writer may pick another if taken.
   *  For a layout: the Stack component (the preset says which arrangement). */
  component: string;
  /** editorial layouts (task-242) — set only on the three layout entries */
  layout?: LayoutPreset;
  text?: undefined;
}
export type SlashItem = TextSlashItem | ComponentSlashItem;

/** Writing blocks, listed first: they are what a writer reaches for most. */
export const TEXT_ITEMS: readonly TextSlashItem[] = [
  { text: 'h2', label: 'Heading', caption: 'Starts a section' },
  { text: 'h3', label: 'Subheading', caption: 'Inside a section' },
  { text: 'ul', label: 'Bulleted list' },
  { text: 'ol', label: 'Numbered list' },
  { text: 'quote', label: 'Quote' },
  { text: 'hr', label: 'Divider' },
  { text: 'code', label: 'Code' },
  { text: 'custom', label: 'Custom code', caption: 'Your own HTML or JSX' },
];
const TEXT_ICONS: Record<TextBlock, IconComponent> = {
  h2: Heading2Icon,
  h3: Heading3Icon,
  ul: ListBulletedIcon,
  ol: ListNumberedIcon,
  quote: QuoteIcon,
  hr: MinusIcon,
  code: CodeBracesIcon,
  custom: AngleIcon,
};

export type SlashGroup = 'Text' | 'Layouts' | 'Media & components';
export const groupOf = (item: SlashItem): SlashGroup => item.text ? 'Text' : item.layout ? 'Layouts' : 'Media & components';

/**
 * The `/` layout entries (design D8): listed FIRST, only in an .mdx post and
 * never inside a layout (one nesting level, D3).
 */
export const LAYOUT_ITEMS: readonly ComponentSlashItem[] = [
  { component: 'Stack', layout: 'text-image', label: 'Text + image', caption: 'Writing beside a picture' },
  { component: 'Stack', layout: 'two-columns', label: 'Two columns', caption: 'Two blocks side by side' },
  { component: 'Stack', layout: 'colored', label: 'Colored section', caption: 'A passage on a background' },
];

const LAYOUT_ICONS: Record<LayoutPreset, IconComponent> = {
  'text-image': LayoutTextImageIcon,
  'two-columns': LayoutTwoColumnsIcon,
  colored: LayoutColoredSectionIcon,
};

/** The typed Row slot owns the shared compact icon size and optical weight. */
function ItemIcon({ item }: { item: SlashItem }) {
  const Icon = item.text ? TEXT_ICONS[item.text] : item.layout ? LAYOUT_ICONS[item.layout] : item.component === 'Media' ? ImageIcon : ComponentIcon;
  return <Icon aria-hidden="true" className="w-4 h-4" />;
}

/** Captions we write for OUR components; a promoted one describes itself. */
const OUR_CAPTIONS: Record<string, string> = { Media: 'Image, or a row of 2–3' };

/**
 * Menu items: OURS always, then whatever the user promoted into sq/, each
 * alphabetical.
 *
 * Ours are listed even when the scan does not show them, and that is
 * load-bearing rather than defensive: `ensure-sq-component` only copies them
 * into `src/components/sq/` on the FIRST insert, so on a fresh project the
 * folder does not exist and a purely scan-derived menu would make them
 * permanently uninsertable — the chicken-and-egg this once shipped as a bug.
 *
 * A component with no manifest still lists (D1c): it inserts with no props and
 * simply gets no settings block.
 */
export function slashItemsFor(
  components: Array<{ name: string; path: string }>,
  ours: readonly string[] = OURS,
): SlashItem[] {
  const seen = new Set<string>();
  const take = (name: string, isOurs: boolean) => {
    if (seen.has(name) || SQ_HIDDEN.includes(name)) return null;
    seen.add(name);
    return {
      component: name,
      label: name,
      caption: OUR_CAPTIONS[name] ?? 'From your components',
      ours: isOurs,
    };
  };
  const items = [
    ...ours.map(name => take(name, true)),
    ...components
      .filter(c => isSystemComponentPath(c.path))
      .map(c => take(c.name, ours.includes(c.name))),
  ].filter((i): i is NonNullable<typeof i> => i !== null);

  items.sort((a, b) =>
    a.ours === b.ours ? a.label.localeCompare(b.label) : (a.ours ? -1 : 1));
  return items.map(({ ours: _ours, ...item }) => item);
}

export function SlashMenu({ items, left, top, disabledReason, onPick, onDismiss, onActivate, activeIndex = 0, listId = 'sq-post-slash' }: {
  items: SlashItem[];
  activeIndex?: number;
  /** pointer hover moves the SAME highlight the arrow keys move */
  onActivate?: (index: number) => void;
  listId?: string;
  left: number;
  top: number;
  /** Set when the post cannot hold components (a .md file) — said under the
   *  writing blocks it CAN insert, never a dead end. */
  disabledReason?: string | null;
  onPick: (item: SlashItem) => void;
  onDismiss: () => void;
}) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  return <>
    {createPortal(<span ref={triggerRef} aria-hidden="true" className="fixed pointer-events-none" style={{ left, top, width: 0, height: 0 }} />, document.body)}
    <Popover isOpen onClose={onDismiss} triggerRef={triggerRef} placement="bottom-start" offset={4} width={256} key={`${left}:${top}`}>
    <div id={listId} role="listbox" aria-label="Insert a block" className="p-1"
      onMouseDown={event => event.preventDefault()}>
      {items.length === 0 ? (
        <EmptyState title="Nothing to insert here" caption={disabledReason ?? 'Add a component to this menu from the Assets tab.'} />
      ) : (
        items.map((item, index) => {
          const group = groupOf(item);
          const first = index === 0 || groupOf(items[index - 1]) !== group;
          return <div key={item.text ?? item.layout ?? item.component} role="presentation">
            {first && <div role="presentation" className={`px-2 pb-1 text-2xs font-medium text-text-muted ${index === 0 ? 'pt-1' : 'pt-2'}`}>{group}</div>}
            <Row
              rowProps={{ id: `${listId}-${index}`, role: 'option', 'aria-selected': index === activeIndex, onMouseEnter: () => onActivate?.(index) }}
              title={item.label}
              caption={item.caption}
              left={[{ type: 'icon', icon: <ItemIcon item={item} />, className: 'mr-1' }]}
              size="sm"
              // Active menu options use the hover surface, not document-row selection.
              className={`px-2 py-1.5 rounded-inner ${index === activeIndex ? 'bg-bg-hover' : ''}`}
              onClick={() => onPick(item)}
            />
          </div>;
        })
      )}
      {disabledReason && items.length > 0 && <p className="px-2 pt-2 pb-1 text-2xs text-text-muted">{disabledReason}</p>}
    </div>
    </Popover>
  </>;
}
