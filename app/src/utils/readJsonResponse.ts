/** Read-only boundary: never expose response bodies or URLs in an error. */
export class JsonResponseError extends Error {
  constructor(readonly kind: 'http' | 'media-type' | 'syntax' | 'shape', readonly status: number) {
    super('Response could not be read');
  }
}
export async function readJsonResponse<T>(response: Response, decode: (value: unknown) => T): Promise<T> {
  if (!response.ok) throw new JsonResponseError('http', response.status);
  const mediaType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (!mediaType || !/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)$/.test(mediaType)) {
    throw new JsonResponseError('media-type', response.status);
  }
  let value: unknown;
  try { value = await response.json(); } catch { throw new JsonResponseError('syntax', response.status); }
  try { return decode(value); } catch { throw new JsonResponseError('shape', response.status); }
}
