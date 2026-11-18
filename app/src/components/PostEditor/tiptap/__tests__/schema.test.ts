/**
 * Adapter identity: PostDoc → Tiptap JSON → PostDoc must serialize
 * byte-identical for every corpus body (untouched doc). Plus edit behaviors:
 * atom delete, paragraph edit, block insert — the model ops that replace the
 * old splice stack.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { parsePostBody, serializePostDoc } from '@/postmodel/postModel';
import {
  componentStorage,
  postDocToTiptap,
  tiptapToPostDoc,
  postEditorExtensions,
  normalizeInitialSelection,
  focusBodyBlock,
} from '../schema';

const DIR = join(__dirname, '..', '..', '..', '..', 'postmodel', '__tests__', 'corpus');

describe('tiptap adapter round-trip', () => {
  for (const name of readdirSync(DIR)) {
    it(`PostDoc→Tiptap→PostDoc keeps ${name} byte-identical`, () => {
      const src = readFileSync(join(DIR, name), 'utf8');
      const original = parsePostBody(src);
      const roundTripped = tiptapToPostDoc(postDocToTiptap(original), original);
      expect(serializePostDoc(roundTripped)).toBe(src);
    });
  }
});

describe('initial selection', () => {
  it('never node-selects a leading atom (stray Backspace deleted the imports block)', () => {
    const original = parsePostBody("import A from './a';\n\nProse here.");
    const editor = new Editor({
      extensions: postEditorExtensions,
      content: postDocToTiptap(original) as object,
    });
    try {
      normalizeInitialSelection(editor);
      expect(editor.state.selection).not.toBeInstanceOf(NodeSelection);
      // caret sits in the paragraph, not on the ESM atom
      expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
    } finally {
      editor.destroy();
    }
  });
});

describe('focusBodyBlock (double-clicked post text opens here)', () => {
  it('puts the caret in the top-level block holding the canvas body line', () => {
    const original = parsePostBody('First.\n\nSecond\nstill second.\n\nThird.');
    const editor = new Editor({ extensions: postEditorExtensions, content: postDocToTiptap(original) as object });
    try {
      focusBodyBlock(editor, original, 4); // body line 4 = second line of the 2nd paragraph
      expect(editor.state.selection.$from.parent.textContent).toMatch(/^Second\sstill second\.$/);
      focusBodyBlock(editor, original, 6);
      expect(editor.state.selection.$from.parent.textContent).toBe('Third.');
    } finally {
      editor.destroy();
    }
  });
});

describe('component span via node attrs (width control)', () => {
  it('setting span on an unwrapped component wraps it in a col-span div', () => {
    const src = readFileSync(join(DIR, 'multiline-component.txt'), 'utf8');
    const original = parsePostBody(src);
    const json = postDocToTiptap(original);
    const node = json.content!.find((n) => n.type === 'astroComponent')!;
    node.attrs = { ...node.attrs, span: 6 };
    const out = serializePostDoc(tiptapToPostDoc(json, original));
    expect(out).toBe('<div class="col-span-6">\n  <CreditWrapper\n    title="Team"\n  >\n    <Credit name="Oleg" />\n  </CreditWrapper>\n</div>');
  });

  it('changing span on a wrapped component rewrites the wrapper', () => {
    const src = readFileSync(join(DIR, 'span-wrapper.txt'), 'utf8');
    const original = parsePostBody(src);
    const json = postDocToTiptap(original);
    const node = json.content!.find((n) => n.type === 'astroComponent')!;
    node.attrs = { ...node.attrs, span: 12 };
    const out = serializePostDoc(tiptapToPostDoc(json, original));
    expect(out).toBe('<div class="col-span-12">\n  <Media items={[null]} />\n</div>');
  });


  it("setting span 'full' wraps in col-span-full; the wrapper round-trips", () => {
    const src = readFileSync(join(DIR, 'span-wrapper.txt'), 'utf8');
    const original = parsePostBody(src);
    const json = postDocToTiptap(original);
    const node = json.content!.find((n) => n.type === 'astroComponent')!;
    node.attrs = { ...node.attrs, span: 'full' };
    const out = serializePostDoc(tiptapToPostDoc(json, original));
    expect(out).toBe('<div class="col-span-full">\n  <Media items={[null]} />\n</div>');
    // parse the result back: span survives as 'full', untouched round-trip identical
    const reparsed = parsePostBody(out);
    const block = reparsed.blocks[0];
    expect(block.kind === 'component' && block.span).toBe('full');
    expect(serializePostDoc(tiptapToPostDoc(postDocToTiptap(reparsed), reparsed))).toBe(out);
  });

  it('clearing span unwraps the component', () => {
    const src = readFileSync(join(DIR, 'span-wrapper.txt'), 'utf8');
    const original = parsePostBody(src);
    const json = postDocToTiptap(original);
    const node = json.content!.find((n) => n.type === 'astroComponent')!;
    node.attrs = { ...node.attrs, span: null };
    const out = serializePostDoc(tiptapToPostDoc(json, original));
    expect(out).toBe('<Media items={[null]} />');
  });
});

describe('component span renders immediately in the editor (node view width)', () => {
  it('span lands on the page\'s alignment lines (text / wide / full); attr change re-renders', () => {
    const original = parsePostBody('<Media items={[null]} />\n\nProse.');
    const editor = new Editor({
      extensions: postEditorExtensions,
      content: postDocToTiptap(original) as object,
    });
    try {
      const dom = () => editor.view.nodeDOM(0) as HTMLElement;
      // clamped to the writing pane (100cqw) so a wide chip never slides under the sidebar
      expect(dom().dataset.sqPreviewWidth).toBe('min(100%, 100cqw)'); // span null = default 8/12 measure
      editor.chain().setNodeSelection(0).updateAttributes('astroComponent', { span: 12 }).run();
      expect(dom().dataset.sqPreviewWidth).toBe('min(64rem, 100cqw - 48px)'); // the wide line (articleTokens LEGACY_SPAN)
      editor.chain().setNodeSelection(0).updateAttributes('astroComponent', { span: 'full' }).run();
      expect(dom().dataset.sqPreviewWidth).toBe('100cqw');
      // the page has no line for other spans: they read at the text measure there, so here too
      editor.chain().setNodeSelection(0).updateAttributes('astroComponent', { span: 4 }).run();
      expect(dom().dataset.sqPreviewWidth).toBe('min(100%, 100cqw)');
    } finally {
      editor.destroy();
    }
  });
});

describe('empty media placeholder tiles', () => {
  it('renders one tile per item slot ([▢] / [▢][▢]) for an all-empty Media', () => {
    const original = parsePostBody('<Media items={[null, null]} />\n\nProse.');
    const editor = new Editor({
      extensions: postEditorExtensions,
      content: postDocToTiptap(original) as object,
    });
    try {
      const dom = editor.view.nodeDOM(0) as HTMLElement;
      expect(dom.querySelectorAll('.sq-media-placeholder-tile')).toHaveLength(2);
      expect(dom.classList.contains('sq-component-placeholder')).toBe(false);
    } finally {
      editor.destroy();
    }
  });

  it('a non-media component keeps the name placeholder', () => {
    const original = parsePostBody('<CreditWrapper title="Team">\n  <Credit name="x" />\n</CreditWrapper>\n\nProse.');
    const editor = new Editor({
      extensions: postEditorExtensions,
      content: postDocToTiptap(original) as object,
    });
    try {
      const dom = editor.view.nodeDOM(0) as HTMLElement;
      expect(dom.querySelectorAll('.sq-media-placeholder-tile')).toHaveLength(0);
      expect(dom.textContent).toContain('<CreditWrapper />');
    } finally {
      editor.destroy();
    }
  });
});


describe('node-view hover events', () => {
  it('mouseenter reports the node pos (drives the hover toolbar); clicks only select', () => {
    const original = parsePostBody('<Media items={[null, null]} />\n\nProse.');
    const editor = new Editor({
      extensions: postEditorExtensions,
      content: postDocToTiptap(original) as object,
    });
    try {
      const storage = (editor.storage as unknown as {
        astroComponent: { onHover: ((p: { pos: number } | null) => void) | null };
      }).astroComponent;
      const hovers: unknown[] = [];
      storage.onHover = p => hovers.push(p);
      const dom = editor.view.nodeDOM(0) as HTMLElement;
      dom.dispatchEvent(new MouseEvent('mouseenter'));
      dom.dispatchEvent(new MouseEvent('mouseleave'));
      expect(hovers).toEqual([{ pos: 0 }, null]);
    } finally {
      editor.destroy();
    }
  });
});


describe('per-slot bin on filled media', () => {
  it('renders a bin per filled slot; clicking it reports {pos, index}', () => {
    const original = parsePostBody('<Media items={["/a.png", "/b.png"]} />\n\nProse.');
    const editor = new Editor({
      extensions: postEditorExtensions,
      content: postDocToTiptap(original) as object,
    });
    try {
      const storage = componentStorage(editor);
      const deletes: unknown[] = [];
      storage.onSlotDelete = p => deletes.push(p);
      // Previews are keyed by NODE, never by ordinal (see AstroComponentStorage).
      storage.previewFor.set(
        editor.state.doc.nodeAt(0)!,
        '<div class="sq-media"><img src="/a.png" data-sq-media-slot="0"><img src="/b.png" data-sq-media-slot="1"></div>',
      );
      storage.views.forEach(render => render());
      const dom = editor.view.nodeDOM(0) as HTMLElement;
      const bins = dom.querySelectorAll('.sq-slot-bin');
      expect(bins).toHaveLength(2);
      bins[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(deletes).toEqual([{ pos: 0, index: 1 }]);
    } finally {
      editor.destroy();
    }
  });
});


describe('empty slots stay uploadable', () => {
  it('all-empty tiles click → onSlotUpload with the tile index', () => {
    const original = parsePostBody('<Media items={[null, null]} />\n\nProse.');
    const editor = new Editor({ extensions: postEditorExtensions, content: postDocToTiptap(original) as object });
    try {
      const storage = (editor.storage as unknown as { astroComponent: { onSlotUpload: ((p: unknown) => void) | null } }).astroComponent;
      const ups: unknown[] = [];
      storage.onSlotUpload = p => ups.push(p);
      const dom = editor.view.nodeDOM(0) as HTMLElement;
      dom.querySelectorAll('.sq-media-placeholder-tile')[1]
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(ups).toEqual([{ pos: 0, index: 1 }]);
    } finally {
      editor.destroy();
    }
  });

  it('a mixed render (one filled, one empty) keeps the empty slot clickable after bin-delete', () => {
    const original = parsePostBody('<Media items={[null, "/b.png"]} />\n\nProse.');
    const editor = new Editor({ extensions: postEditorExtensions, content: postDocToTiptap(original) as object });
    try {
      const storage = componentStorage(editor);
      const ups: unknown[] = [];
      storage.onSlotUpload = p => ups.push(p);
      storage.previewFor.set(
        editor.state.doc.nodeAt(0)!,
        '<div class="sq-media"><button data-sq-media-slot="0"></button><img src="/b.png" data-sq-media-slot="1"></div>',
      );
      storage.views.forEach(render => render());
      const dom = editor.view.nodeDOM(0) as HTMLElement;
      expect(dom.querySelectorAll('.sq-slot-empty')).toHaveLength(1);
      dom.querySelector('.sq-slot-empty')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(ups).toEqual([{ pos: 0, index: 0 }]);
      expect(dom.querySelectorAll('.sq-slot-bin')).toHaveLength(1); // filled slot keeps its bin
    } finally {
      editor.destroy();
    }
  });
});

describe('tiptap adapter edits', () => {
  it('deleting an atom keeps every other block byte-identical', () => {
    const src = readFileSync(join(DIR, 'timepad.txt'), 'utf8');
    const original = parsePostBody(src);
    const json = postDocToTiptap(original);
    // remove the first astroComponent atom (SingleImage)
    const idx = json.content!.findIndex((n) => n.type === 'astroComponent');
    expect(idx).toBeGreaterThanOrEqual(0);
    json.content!.splice(idx, 1);
    const out = serializePostDoc(tiptapToPostDoc(json, original));
    expect(out).not.toContain('<SingleImage src="./images/timepad/hero.png"');
    // neighbors intact, verbatim
    expect(out).toContain('Timepad ran the largest independent ticketing platform');
    expect(out).toContain('<CreditWrapper title="Team">');
    expect(out).toContain('```js');
  });

  it('editing one paragraph leaves fences, comments and imports verbatim', () => {
    const src = readFileSync(join(DIR, 'timepad.txt'), 'utf8');
    const original = parsePostBody(src);
    const json = postDocToTiptap(original);
    const para = json.content!.find(
      (n) => n.type === 'paragraph' && JSON.stringify(n).includes('Timepad ran'),
    )!;
    para.content = [{ type: 'text', text: 'Rewritten paragraph.' }];
    const out = serializePostDoc(tiptapToPostDoc(json, original));
    expect(out).toContain('Rewritten paragraph.');
    expect(out).not.toContain('Timepad ran the largest');
    // untouched constructs stay byte-identical
    expect(out).toContain("import SingleImage from '../../components/SingleImage.astro';");
    expect(out).toContain('{/* <SingleVideo src="./images/timepad/teaser.mp4"');
    expect(out).toContain("```js\nimport SingleImage from '../../components/SingleImage.astro';");
  });

  it('a new paragraph typed between blocks gets blank-line separators', () => {
    const original = parsePostBody('First.\n\nSecond.');
    const json = postDocToTiptap(original);
    json.content!.splice(1, 0, { type: 'paragraph', content: [{ type: 'text', text: 'Mid.' }] });
    expect(serializePostDoc(tiptapToPostDoc(json, original))).toBe('First.\n\nMid.\n\nSecond.');
  });

  it('soft line wraps never reach ProseMirror as \\n (it would turn them into hard breaks)', () => {
    const src = 'one\ntwo three.\n\nNext paragraph.';
    const original = parsePostBody(src);
    const json = postDocToTiptap(original);
    const collectText = (n: { text?: string; content?: unknown[] }): string[] => [
      ...(n.text ? [n.text] : []),
      ...(n.content ?? []).flatMap((c) => collectText(c as { text?: string })),
    ];
    for (const text of collectText(json)) expect(text).not.toContain('\n');
    // the wrapped paragraph is still recognized as untouched → byte-identical
    expect(serializePostDoc(tiptapToPostDoc(json, original))).toBe(src);
  });

  it('an edited soft-wrapped paragraph unwraps instead of gaining hard breaks', () => {
    const original = parsePostBody('one\ntwo three.\n\nNext paragraph.');
    const json = postDocToTiptap(original);
    json.content![0].content = [{ type: 'text', text: 'one two three edited.' }];
    const out = serializePostDoc(tiptapToPostDoc(json, original));
    expect(out).toBe('one two three edited.\n\nNext paragraph.');
    expect(out).not.toContain('  \n');
  });

  it("Tiptap's trailing empty paragraph after a last atom never reaches the file", () => {
    const original = parsePostBody('Prose.');
    const json = postDocToTiptap(original);
    json.content!.push(
      { type: 'astroComponent', attrs: { name: 'Media', source: '<Media />', span: null } },
      { type: 'paragraph' },
    );
    const out = serializePostDoc(tiptapToPostDoc(json, original));
    expect(out).toBe('Prose.\n\n<Media />');
  });

  it('two ESM passthroughs joined by a single newline keep their gap', () => {
    const src = "import A from './a';\nimport B from './b';\n\nProse.";
    // remark-mdx parses contiguous imports as ONE mdxjsEsm node; simulate the
    // Task-7 shape of a separately inserted import block instead.
    const original = parsePostBody(src);
    const json = postDocToTiptap(original);
    const roundTripped = tiptapToPostDoc(json, original);
    expect(serializePostDoc(roundTripped)).toBe(src);
  });
});
