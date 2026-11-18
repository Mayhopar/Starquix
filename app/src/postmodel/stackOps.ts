/**
 * PostDoc builders for the `/` layout inserts (task-242): bind an import,
 * build a fresh (dirty) stack block. Every later layout edit is a ProseMirror
 * transaction (components/PostEditor/stackCommands.ts).
 */
import {
  type PostBlock,
  type PostDoc,
  type StackAttrs,
  type StackBlock,
} from './postModel';

export type RowPreset = 'two-columns' | 'text-image';

function freshStack(name: string, direction: StackBlock['direction'], attrs: StackAttrs, slots: PostBlock[][]): StackBlock {
  return { kind: 'stack', name, direction, attrs, slots, head: '', between: '', tail: '', dirty: true, gapBefore: '\n\n' };
}

function mediaBlock(name: string): PostBlock {
  return { kind: 'component', name, source: `<${name} items={[null]} />`, span: null, raw: '', dirty: true, gapBefore: '\n\n' };
}

/** A fresh row for a `/` preset (the Media, if any, already bound as `mediaName`). */
export function rowBlock(stackName: string, preset: RowPreset, mediaName?: string): StackBlock {
  return freshStack(stackName, 'row', {}, [[], preset === 'text-image' && mediaName ? [mediaBlock(mediaName)] : []]);
}

/** A fresh (empty) column carrying `attrs`. */
export function columnBlock(stackName: string, attrs: StackAttrs): StackBlock {
  return freshStack(stackName, 'column', attrs, [[]]);
}
