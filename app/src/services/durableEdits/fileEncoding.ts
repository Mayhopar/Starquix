// Canonical base64 for durable binary file states. The native Uint8Array base64
// API (Chromium 140 / Electron 38) is ~100× faster than the string paths, which
// cost ~300 ms of a library insert's image assets (perf ledger, insert-component).
type NativeBase64 = { fromBase64?: (s: string, o?: { lastChunkHandling?: string }) => Uint8Array };
type NativeBytes = Uint8Array & { toBase64?: () => string };

export function encodeFileBytes(bytes: Uint8Array): string {
  const native = (bytes as NativeBytes).toBase64;
  if (typeof native === 'function') return native.call(bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

/** Decodes and proves the input canonical: re-encoding must give the same string
 *  (rejects whitespace, missing padding, non-zero trailing bits, invalid chars). */
export function decodeFileBytes(source: string): Uint8Array {
  const fromBase64 = (Uint8Array as unknown as NativeBase64).fromBase64;
  let bytes: Uint8Array;
  if (typeof fromBase64 === 'function') {
    try { bytes = fromBase64(source, { lastChunkHandling: 'strict' }); } catch { throw new Error('Non-canonical binary file state'); }
  } else {
    const binary = atob(source);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  }
  if (encodeFileBytes(bytes) !== source) throw new Error('Non-canonical binary file state');
  return bytes;
}
