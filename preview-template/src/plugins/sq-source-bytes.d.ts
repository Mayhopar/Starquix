// Type surface for sq-source-bytes.js (byte-space .astro source surgery).

/** A byte-space edit. `start === end` is an insertion. */
export interface ByteEdit {
  start: number;
  end: number;
  text: string;
}
export function findTagStart(buf: Buffer, offset: number, name: string): number | null;
export function applyByteEdits(buf: Buffer, edits: readonly ByteEdit[]): Buffer;
