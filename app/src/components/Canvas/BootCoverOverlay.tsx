import { useEffect, useState } from 'react';
import { db, getAssetBlob } from '@/db';
import { coverAssetId } from '@/hooks/useCoverCapture';

/**
 * task-120 (6.3): boot overlay. While the iframe boots, show the project's
 * last cover screenshot (blurred, spinner on top) instead of a white void.
 * Falls back to the plain spinner when no cover exists (first ever boot).
 */
export function BootCoverOverlay({ projectId }: { projectId: string | null }) {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    let url: string | null = null;
    (async () => {
      try {
        const cover = await db.assets.get(coverAssetId(projectId));
        if (!cover || cancelled) return;
        url = URL.createObjectURL(getAssetBlob(cover));
        if (!cancelled) setCoverUrl(url);
      } catch {
        // No cover / Dexie unavailable — plain spinner is the fallback.
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [projectId]);

  return (
    <div className="fixed inset-0 flex items-center justify-center z-20 pointer-events-none">
      {coverUrl && (
        <img
          src={coverUrl}
          alt=""
          data-testid="boot-cover"
          className="absolute inset-0 w-full h-full object-cover opacity-60"
          style={{ filter: 'blur(8px)' }}
        />
      )}
      <div className="relative w-8 h-8 border-2 border-text-secondary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
