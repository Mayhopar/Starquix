/**
 * Image proxy endpoint for screenshot capture.
 * Fetches external images server-side (bypassing CORS) so the bridge
 * can inline them as data URIs for screenshot capture.
 *
 * Usage: GET /__image-proxy?url=https://example.com/image.jpg
 */
import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ url }) => {
  const imageUrl = url.searchParams.get('url');
  if (!imageUrl) {
    return new Response('Missing url param', { status: 400 });
  }

  try {
    const res = await fetch(imageUrl);
    if (!res.ok) {
      return new Response(`Upstream ${res.status}`, { status: 502 });
    }

    const contentType = res.headers.get('content-type') || 'application/octet-stream';
    const body = await res.arrayBuffer();

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err) {
    return new Response(String(err), { status: 502 });
  }
};
