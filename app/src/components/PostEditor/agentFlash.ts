import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/** Agent multiplayer (owner 2026-11-08, ledger G7): the top-level blocks an
 *  outside writer just changed carry `sq-agent-flash` for a moment. A node
 *  decoration, because ProseMirror redraws a replaced block right after the
 *  transaction — a class set on its DOM by hand was gone 150 ms later (live
 *  probe 2026-11-08). View only: never part of PostDoc or a write. */
export const agentFlashKey = new PluginKey<DecorationSet>('sqAgentFlash');
type FlashMeta = { add: { from: number; to: number; id: number } } | { clear: number };

export const agentFlash = Extension.create({
  name: 'sqAgentFlash',
  addProseMirrorPlugins: () => [new Plugin<DecorationSet>({
    key: agentFlashKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        const meta = tr.getMeta(agentFlashKey) as FlashMeta | undefined;
        let next = set.map(tr.mapping, tr.doc);
        if (meta && 'clear' in meta) next = next.remove(next.find(undefined, undefined, spec => spec.flash === meta.clear));
        if (meta && 'add' in meta) {
          const { from, to, id } = meta.add, decorations: Decoration[] = [];
          tr.doc.nodesBetween(from, to, (node, pos) => {
            decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'sq-agent-flash' }, { flash: id }));
            return false; // top-level blocks only
          });
          next = next.add(tr.doc, decorations);
        }
        return next;
      },
    },
    props: { decorations: state => agentFlashKey.getState(state) },
  })],
});

export const AGENT_FLASH_MS = 1600;
let flashes = 0;
/** Marks [from, to) of `tr`'s new doc for the flash; the caller clears it with `clearAgentFlash(id)` after AGENT_FLASH_MS. */
export function addAgentFlash<T extends { setMeta(key: PluginKey, value: unknown): T }>(tr: T, from: number, to: number): { tr: T; id: number } {
  const id = ++flashes;
  return { tr: tr.setMeta(agentFlashKey, { add: { from, to, id } }), id };
}
export const clearAgentFlashMeta = (id: number): FlashMeta => ({ clear: id });
