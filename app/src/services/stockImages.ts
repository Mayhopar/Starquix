// src/services/stockImages.ts
// Pexels stock photo search (browser fetch, CORS-enabled, key in Authorization header).

export interface StockImage {
  id: number;
  alt: string;
  width: number;
  height: number;
  photographer: string;
  url: string;
}

export interface StockSearchOptions {
  orientation?: 'landscape' | 'portrait' | 'square';
  count?: number;
}

interface PexelsPhoto {
  id: number; width: number; height: number;
  alt: string | null; photographer: string | null;
  src?: { original?: string; large?: string };
}

export async function searchStockImages(
  query: string,
  apiKey: string,
  opts: StockSearchOptions = {},
): Promise<StockImage[]> {
  const params = new URLSearchParams({
    query,
    per_page: String(Math.min(opts.count ?? 5, 10)),
  });
  if (opts.orientation) params.set('orientation', opts.orientation);

  const res = await fetch(`https://api.pexels.com/v1/search?${params}`, {
    headers: { Authorization: apiKey },
  });
  if (!res.ok) throw new Error(`Pexels API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  return ((json.photos ?? []) as PexelsPhoto[]).map((p) => ({
    id: p.id,
    alt: p.alt ?? '',
    width: p.width,
    height: p.height,
    photographer: p.photographer ?? '',
    url: p.src?.large ?? p.src?.original ?? '',
  }));
}
