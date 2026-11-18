import { useEffect, useState } from 'react';
import { localFetch } from '@/utils/sqLocalBase';
import { mimeForPath } from './mediaResolver';

/** Resolve project paths, not editor-page URLs. The source value is never rewritten. */
export function postPropertyImageFile(postFile: string | null, src: string): string | null {
  if (!src || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(src)) return null;
  const path = src.startsWith('/') ? `public${src}` : postFile ? `${postFile.slice(0, postFile.lastIndexOf('/') + 1)}${src}` : null;
  if (!path) return null;
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) return null; parts.pop(); }
    else if (part.includes('\\') || part.includes('\0')) return null;
    else parts.push(part);
  }
  return parts.length && !parts.includes('node_modules') && !parts.includes('.sq') ? parts.join('/') : null;
}
export function usePostPropertyImage(value: string, postFile: string | null, projectPath: string | null) {
  const file = postPropertyImageFile(postFile, value);
  const key = JSON.stringify([projectPath, file, value]);
  const [resolved, setResolved] = useState<{ key: string; url: string | null; failed: boolean } | null>(null);
  const remote = /^(https?:|data:image\/|blob:|\/\/)/i.test(value) ? value : null;
  useEffect(() => {
    if (!file || !projectPath) return;
    const controller = new AbortController();
    let ownedUrl: string | null = null;
    void localFetch(`/__sq/local/file?${new URLSearchParams({ path: projectPath, file })}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Image unavailable');
        const bytes = await response.arrayBuffer();
        if (controller.signal.aborted) return;
        if (!bytes.byteLength) throw new Error('Image unavailable');
        ownedUrl = URL.createObjectURL(new Blob([bytes], { type: mimeForPath(file) }));
        setResolved({ key, url: ownedUrl, failed: false });
      }).catch(() => { if (!controller.signal.aborted) setResolved({ key, url: null, failed: true }); });
    return () => { controller.abort(); if (ownedUrl) URL.revokeObjectURL(ownedUrl); };
  }, [file, projectPath, key]);
  return { url: remote ?? (resolved?.key === key ? resolved.url : null), unavailable: !!value && !remote && (resolved?.key === key ? resolved.failed : !file || !projectPath) };
}
