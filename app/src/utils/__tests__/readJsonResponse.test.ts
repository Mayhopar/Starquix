import { expect, it, vi } from 'vitest';
import { JsonResponseError, readJsonResponse } from '../readJsonResponse';

it.each(['application/json', 'Application/Problem+JSON; charset=utf-8'])('decodes %s exactly once', async type => {
  const response = new Response('{"items":[]}', { headers: { 'content-type': type } });
  const json = vi.spyOn(response, 'json');
  expect(await readJsonResponse(response, value => value)).toEqual({ items: [] });
  expect(json).toHaveBeenCalledTimes(1);
});
it.each([
  ['http', () => new Response('/private/token', { status: 403 })],
  ['media-type', () => new Response('/private/token', { headers: { 'content-type': 'text/html' } })],
  ['media-type', () => new Response('{"items":[]}')],
  ['syntax', () => new Response('/private/token', { headers: { 'content-type': 'application/json' } })],
] as const)('returns finite %s metadata without response text', async (kind, response) => {
  const value = response();
  const error = await readJsonResponse(value, x => x).catch(e => e);
  expect(error).toBeInstanceOf(JsonResponseError);
  expect(error).toMatchObject({ kind, status: value.status, message: 'Response could not be read' });
  expect(JSON.stringify(error)).not.toMatch(/private|token/);
});
it('replaces a decoder error with shape metadata', async () => {
  await expect(readJsonResponse(Response.json({}), () => { throw new Error('/private/token'); })).rejects.toMatchObject({ kind: 'shape', status: 200, message: 'Response could not be read' });
});
