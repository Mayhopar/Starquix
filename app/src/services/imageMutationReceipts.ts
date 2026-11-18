import { localFetch } from '@/utils/sqLocalBase';
import { LocalMutationNoWriteError } from './localTransport';
import { getActiveSaveProjectId } from './pendingProjectMutations';

interface Attempt {
  projectId: string | null;
  path: string;
  bytes: Promise<Uint8Array>;
  receipt?: { session: string; id: string };
  completion: Promise<Response>;
  failed: boolean;
  dispatched: boolean;
  noWrite: boolean;
}
const attempts = new Set<Attempt>();
async function readBytes(file?: File): Promise<Uint8Array> {
  if (!file) return new Uint8Array();
  if (typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}
function recordNoWriteOutcome(attempt: Attempt, noWrite: boolean): void {
  for (const old of attempts) {
    if (old.projectId === attempt.projectId && old.path === attempt.path && old.receipt?.session === attempt.receipt?.session && old.receipt?.id === attempt.receipt?.id) old.noWrite = noWrite;
  }
}
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Re-invoking the SAME failed image operation is an owner retry. Exact bytes,
 * destination and operation must match for unknown/partial outcomes, so a lost
 * acknowledgement never uploads a second suffixed copy. Explicit no-write
 * refusals are settled at once, so corrected inputs may use any filename. */
export function fetchImageMutation(
  projectId: string | null, path: string, file?: File,
  preparePreview?: (bytes: Uint8Array) => void,
): Promise<Response> {
  const activeAtStart = getActiveSaveProjectId();
  const previous = [...attempts].filter(a => a.projectId === projectId && a.path === path);
  const attempt: Attempt = { projectId, path, bytes: readBytes(file), completion: Promise.resolve(new Response()), failed: false, dispatched: false, noWrite: false };
  attempts.add(attempt);
  const request = (async () => {
    const bytes = await attempt.bytes;
    // Derive an editor preview from the same captured bytes before dispatch.
    // The callback must not mutate them; a preparation failure sends no write.
    preparePreview?.(bytes);
    const matching: Attempt[] = [];
    for (const old of previous) {
      try { if (equal(await old.bytes, bytes)) matching.push(old); }
      catch (error) {
        // A concurrently failing preparation is not a comparison veto.
        if (old.dispatched) throw error;
      }
    }
    const old = matching[matching.length - 1];
    if (old) attempt.bytes = old.bytes;
    if (old && !old.failed) {
      try {
        const response = await old.completion;
        attempts.delete(attempt);
        return response.clone();
      } catch (error) {
        attempt.receipt = old.receipt;
        throw error;
      }
    }
    attempt.receipt = old?.receipt;
    if (!attempt.receipt) {
      const sessionResponse = await localFetch('/__sq/local/mutation-session');
      if (!sessionResponse.ok) throw new Error(`Image receipt service is not ready (${sessionResponse.status})`);
      const { session } = await sessionResponse.json() as { session: string };
      if (!session) throw new Error('Image receipt session is missing');
      attempt.receipt = { session, id: crypto.randomUUID() };
    }
    if (getActiveSaveProjectId() !== activeAtStart || (activeAtStart !== null && activeAtStart !== projectId)) throw new Error('Image destination project changed; return to it and retry the original operation');
    let response: Response;
    try {
      // Reusing a receipt starts a new unknown window until its outcome arrives.
      recordNoWriteOutcome(attempt, false);
      attempt.dispatched = true;
      // readBytes owns a full ArrayBuffer; send exactly those identity bytes.
      response = await localFetch(path, { method: 'POST', body: file ? bytes.buffer as ArrayBuffer : undefined,
        headers: { 'x-sq-mutation-session': attempt.receipt.session, 'x-sq-mutation-id': attempt.receipt.id, ...(file?.type ? { 'content-type': file.type } : {}) },
      });
    } catch (error) {
      if (error instanceof LocalMutationNoWriteError) recordNoWriteOutcome(attempt, true);
      throw error;
    }
    if (!response.ok) {
      recordNoWriteOutcome(attempt, response.headers.get('x-sq-mutation-outcome') === 'no-write');
      const body = await response.clone().json().catch(() => ({})) as { error?: string };
      throw new Error(body.error ?? `Image operation failed (${response.status})`);
    }
    for (const prior of matching) attempts.delete(prior);
    attempts.delete(attempt);
    return response;
  })();
  attempt.completion = request.catch(error => {
    attempt.failed = true;
    if (!attempt.dispatched) {
      // Preparation stayed active until rejection settled. No mutation was sent.
      attempts.delete(attempt);
    } else if (attempt.noWrite && attempt.receipt) {
      // The endpoint proved this receipt family has no remaining mutation.
      // Keep the upload rejection visible, but never trap a corrected filename.
      for (const old of attempts) {
        if (old.failed && old.noWrite && old.projectId === projectId && old.path === path && old.receipt?.session === attempt.receipt.session && old.receipt?.id === attempt.receipt.id) attempts.delete(old);
      }
    }
    throw error;
  });
  void attempt.completion.catch(() => {});
  return attempt.completion.then(response => response.clone());
}
