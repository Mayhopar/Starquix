/**
 * REGRESSION (owner, 2026-08-11): "when i upload photo in content tab in media
 * component nothing happens, i keep seeing a placeholder".
 *
 * The upload dialog used to be bound to LIVE editor state rather than to the
 * slot the user clicked:
 *
 *     const [mediaSlot, setMediaSlot] = useState<{ index; currentSrc } | null>(null);
 *     …
 *     const activeComponent = selectedComponent ?? hoverComponent;   // hover-or-selection
 *     if (!info) setMediaSlot(null);                                 // in updateSelectedComponent
 *     {mediaSlot && activeComponent && onUploadMedia && (
 *       <MediaSlotDialog onPick={src => editMediaItem(activeComponent.source, …)} … />)}
 *
 * Two consequences, both of which read as "nothing happened":
 *   1. any selection change while the dialog is open UNMOUNTED it mid-upload —
 *      the file came back and there was nothing left to write into;
 *   2. if the selection landed on a DIFFERENT component, the write went to that
 *      one instead of the block the user clicked.
 *
 * The dialog now captures the target `pos` when it OPENS, and writes there.
 *
 * The node view's DOM is deliberately not touched here (it is owned by
 * tiptap/schema.ts and covered by its own tests): this drives the exact storage
 * callbacks the node view calls, plus the toolbar the editor renders around it.
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Editor } from '@tiptap/react';
import type { AstroComponentStorage } from '../tiptap/schema';
import { NO_PREVIEW_MEDIA } from '../mediaResolver';

/** The storage the node view talks through, plus the live Editor it is given. */
const storage: AstroComponentStorage = {
  previewFor: new WeakMap(),
  origin: null,
  views: new Set(),
  onHover: null,
  onSlotDelete: null,
  onSlotUpload: null,
};
let editor: Editor | null = null;

vi.mock('../tiptap/schema', async importOriginal => {
  const actual = await importOriginal<typeof import('../tiptap/schema')>();
  return {
    ...actual,
    componentStorage: (ed: Editor) => {
      editor = ed;
      return storage;
    },
  };
});
vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => null }));
vi.mock('@/hooks/useComponentLibrary', () => ({ useComponentLibrary: () => ({ userProject: [] }) }));

beforeEach(() => {
  Range.prototype.getBoundingClientRect = () => new DOMRect(10, 20, 80, 20);
  Range.prototype.getClientRects = () => [new DOMRect(10, 20, 80, 20)] as unknown as DOMRectList;
});
import { PostBodyEditor } from '../PostBodyEditor';
import type { PostWriteQueue } from '@/postmodel/writeQueue';

const BODY = [
  '<Media items={[null]} class="col-span-8" />',
  '',
  '<Media items={[null]} class="col-span-8" />',
  '',
  'Some words after the images.',
].join('\n');

function mount(body = BODY, previewOrigin: string | null = null) {
  const enqueue = vi.fn(async () => {});
  const queue = { enqueue, size: 0 } as unknown as PostWriteQueue;
  const onUploadMedia = vi.fn(async () => '/uploads/photo.png');
  render(
    <PostBodyEditor
      body={body}
      format="mdx"
      queue={queue}
      frontmatterRef={{ current: {} } as React.RefObject<Record<string, unknown>>}
      previewOrigin={previewOrigin}
      collection="works"
      slug="untitled"
      filePath="src/content/works/untitled.mdx"
      onUploadMedia={onUploadMedia}
    />,
  );
  return { enqueue, onUploadMedia };
}

/** Doc positions of the component blocks, in order. */
function componentPositions(): number[] {
  const out: number[] = [];
  editor!.state.doc.descendants((node, pos) => {
    if (node.type.name === 'astroComponent') out.push(pos);
    return true;
  });
  return out;
}

const sourceAt = (pos: number) => String(editor!.state.doc.nodeAt(pos)!.attrs.source ?? '');

/** The dialog's Dropzone input is the only file input on screen. */
async function uploadInDialog() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { files: [new File(['x'], 'photo.png', { type: 'image/png' })] } });
  });
}

beforeEach(() => {
  storage.onHover = null;
  storage.onSlotDelete = null;
  storage.onSlotUpload = null;
  storage.previewFor = new WeakMap();
  storage.media = NO_PREVIEW_MEDIA;
  storage.views = new Set();
  editor = null;
  vi.clearAllMocks();
});

describe('media slot dialog writes to the block that was clicked', () => {
  it('parses both components out of the body', () => {
    mount();
    expect(componentPositions()).toHaveLength(2);
  });

  it('survives a selection change while it is open', async () => {
    mount();
    const [posA] = componentPositions();
    await act(async () => storage.onSlotUpload!({ pos: posA, index: 0 }));
    expect(screen.getByRole('button', { name: 'Upload' })).toBeTruthy();

    // The old code closed the dialog the moment the selection stopped being a
    // NodeSelection on a component — the upload then had nowhere to land.
    await act(async () => {
      editor!.commands.selectAll();
    });

    expect(screen.getByRole('button', { name: 'Upload' })).toBeTruthy();
  });

  it('writes into the clicked block even after the selection moved elsewhere', async () => {
    const { enqueue } = mount();
    const [posA, posB] = componentPositions();
    await act(async () => storage.onSlotUpload!({ pos: posA, index: 0 }));

    // Selection (and the hover toolbar with it) moves to the OTHER component.
    await act(async () => {
      editor!.commands.setNodeSelection(posB);
      storage.onHover!({ pos: posB });
    });
    await uploadInDialog();

    expect(sourceAt(posA)).toContain('/uploads/photo.png');
    expect(sourceAt(posB)).not.toContain('/uploads/photo.png');
    expect(enqueue).toHaveBeenCalled();
  });

  it('clears the clicked block on a slot delete, not the hovered one', async () => {
    mount();
    const [posA, posB] = componentPositions();
    await act(async () => storage.onSlotUpload!({ pos: posA, index: 0 }));
    await uploadInDialog();
    expect(sourceAt(posA)).toContain('/uploads/photo.png');

    await act(async () => {
      storage.onHover!({ pos: posB });
      storage.onSlotDelete!({ pos: posA, index: 0 });
    });

    expect(sourceAt(posA)).not.toContain('/uploads/photo.png');
    // No silent failure notice for a write that succeeded.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('SAYS why nothing was written when the block is gone', async () => {
    mount();
    const [posA] = componentPositions();

    await act(async () => storage.onSlotDelete!({ pos: posA + 999, index: 0 }));

    expect(screen.getByRole('alert').textContent).toContain('no longer in the post');
  });
});

/**
 * C8 (2026-08-12 review): the refusal text was guessed from the source string,
 * so a named-shape component was told it "doesn't take its media from an items
 * list" — true of the writer's old mistake, useless as an explanation, and
 * simply WRONG for the common case (an index the component doesn't declare).
 * The reason now comes from `mediaWriteBlock`, the gate the writer runs.
 */
describe('a refused write names its actual cause', () => {
  const NAMED = '<DoubleImage src1="/a.png" src2="/b.png" caption="" />\n\nProse.';

  it('an out-of-range slot says the component declares fewer slots', async () => {
    mount(NAMED);
    const [pos] = componentPositions();

    await act(async () => storage.onSlotDelete!({ pos, index: 5 }));

    const alert = screen.getByRole('alert').textContent ?? '';
    expect(alert).toContain('fewer media slots');
    expect(alert).not.toContain('items list'); // the old, wrong explanation
  });

  it('an expression-valued media prop says it is written as code', async () => {
    mount('<SingleImage src={hero} />\n\nProse.');
    const [pos] = componentPositions();

    await act(async () => storage.onSlotDelete!({ pos, index: 0 }));

    expect(screen.getByRole('alert').textContent).toContain('written as code');
  });

  it('a component with no media surface at all says so', async () => {
    mount('<Credit role="x" name="y" />\n\nProse.');
    const [pos] = componentPositions();

    await act(async () => storage.onSlotDelete!({ pos, index: 0 }));

    expect(screen.getByRole('alert').textContent).toContain('no media attribute');
  });
});

/**
 * C6 (2026-08-12 review): the 1/2/3 count buttons rendered for named-shape
 * components (parseMediaItems now returns their slots) but `setMediaItemCount`
 * returns null for every named shape and the null was swallowed — every click
 * was a silent no-op, the same failure the owner reported one layer up. The row
 * is gated on the writer's own answer, `readMediaSlots().countEditable`.
 */
describe('the media-count row only shows where the count can be set', () => {
  const countButton = () => screen.queryByRole('button', { name: '2 items' });

  it('shows for the array shape (<Media items={…}/>)', async () => {
    mount();
    const [pos] = componentPositions();
    await act(async () => storage.onHover!({ pos }));
    expect(countButton()).toBeTruthy();
  });

  it('is HIDDEN for a named-shape component, whose count is fixed by its markup', async () => {
    mount('<DoubleImage src1="/a.png" src2="/b.png" caption="" />\n\nProse.');
    const [pos] = componentPositions();
    await act(async () => storage.onHover!({ pos }));
    // The width control still shows — the component IS media, it just doesn't
    // own an editable count.
    expect(screen.queryAllByRole('button', { name: /width/i }).length).toBeGreaterThan(0);
    expect(countButton()).toBeNull();
  });
});

/**
 * C2 (2026-08-12 review): the node view's optimistic render read a preview
 * source off the storage that NOTHING ever assigned — so every root-relative
 * source resolved to null and a real photo was replaced by an inert grey frame.
 * The editor knows the origin; it must hand it over.
 *
 * Asserted through the CONSEQUENCE (the URL a slot resolves to) rather than the
 * field, so it keeps holding whatever the seam is called.
 */
describe('the preview origin reaches the node views', () => {
  it('is assigned from previewOrigin as soon as the editor is wired', () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    try {
      mount(BODY, 'http://localhost:4399');
      expect(storage.media.urlFor('/uploads/p.png')).toBe('http://localhost:4399/uploads/p.png');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/**
 * A ProseMirror command chain REPORTS whether it applied, and the editor threw
 * that answer away: `chain().setNodeSelection(pos).updateAttributes(…).run()`
 * returns false when the command cannot run (a captured pos that is no longer a
 * node boundary, a doc that moved underneath it), and the caller was told the
 * write had happened — with a save queued behind it for a doc that never
 * changed. "Nothing was written" has to be sayable (2026-08-12 review).
 */
describe('a write the doc refuses is never reported as done', () => {
  it('states that nothing was written, and queues no save', async () => {
    const { enqueue } = mount();
    const [pos] = componentPositions();
    const chain = vi.spyOn(editor!, 'chain').mockReturnValue({
      setNodeSelection: () => ({ updateAttributes: () => ({ run: () => false }) }),
    } as unknown as ReturnType<Editor['chain']>);

    try {
      await act(async () => storage.onSlotDelete!({ pos, index: 0 }));

      expect(screen.getByRole('alert').textContent).toContain("couldn't apply");
      expect(enqueue).not.toHaveBeenCalled();
    } finally {
      chain.mockRestore();
    }
  });
});
