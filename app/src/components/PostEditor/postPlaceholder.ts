import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
/** View decoration only: it never becomes part of PostDoc or a write. */
export const postPlaceholder = Extension.create({
  name: 'postPlaceholder',
  addProseMirrorPlugins: () => [new Plugin({ props: {
    decorations(state) {
      if (state.doc.childCount === 0) return DecorationSet.create(state.doc, [Decoration.widget(0, () => {
        const hint = document.createElement('span');
        hint.className = 'sq-post-empty';
        hint.dataset.placeholder = 'Start writing, or type / for a component…';
        return hint;
      })]);
      const child = state.doc.firstChild;
      const decos: Decoration[] = [];
      if (state.doc.childCount === 1 && child?.type.name === 'paragraph' && child.content.size === 0) {
        decos.push(Decoration.node(0, child.nodeSize, { class: 'sq-post-empty', 'data-placeholder': 'Start writing, or type / for a component…' }));
      }
      // An empty layout slot / section still reads as a place to write.
      state.doc.descendants((node, pos) => {
        // stacks sit at the top level or inside a column (D3): never descend into prose
        if (node.type.name === 'stackRow') return true;
        if (node.type.name !== 'stackSlot' && node.type.name !== 'stackColumn') return false;
        const only = node.childCount === 1 ? node.firstChild : null;
        if (only?.type.name === 'paragraph' && only.content.size === 0) {
          decos.push(Decoration.node(pos + 1, pos + 1 + only.nodeSize, { class: 'sq-post-empty', 'data-placeholder': 'Write here, or type /…' }));
        }
        return true;
      });
      return decos.length ? DecorationSet.create(state.doc, decos) : DecorationSet.empty;
    },
  } })],
});
