/**
 * Loads the pre-bundled Astro snapshot and decodes files
 * from base64 back to string/Uint8Array (library component inserts/assets).
 */
import type { Snapshot } from '@/vite-plugin/snapshot-shared';

const TEXT_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.tsx', '.jsx',
  '.json', '.html', '.css', '.scss', '.less', '.md', '.mdx',
  '.astro', '.svelte', '.vue', '.yaml', '.yml', '.toml',
  '.txt', '.xml', '.svg', '.sh', '.env', '.gitignore', '.gitkeep',
  '.prettierrc', '.eslintrc', '.browserslistrc',
]);

const CACHE_NAME = 'starquix-snapshot';
const SNAPSHOT_URL = '/astro-snapshot.json';
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function isTextFile(path: string): boolean {
  const fileName = path.split('/').pop() || path;
  const ext = '.' + fileName.split('.').pop()?.toLowerCase();
  return TEXT_EXTENSIONS.has(ext) || !fileName.includes('.') || fileName.endsWith('rc');
}

function base64ToUint8Array(base64: string, path: string): Uint8Array {
  if (!BASE64_RE.test(base64)) {
    throw new Error(`Snapshot file has invalid base64 bytes: ${path}`);
  }
  // Native base64 (Chromium 140): ~100× faster on the 5 MB snapshot (perf ledger, insert-component).
  const fromBase64 = (Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array }).fromBase64;
  if (typeof fromBase64 === 'function') {
    try { return fromBase64(base64); } catch { throw new Error(`Snapshot file has invalid base64 bytes: ${path}`); }
  }
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throw new Error(`Snapshot file has invalid base64 bytes: ${path}`);
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function expectedProductionVersion(): string | null {
  if (!import.meta.env.PROD) return null;
  const version = import.meta.env.VITE_SNAPSHOT_VERSION;
  if (typeof version !== 'string' || !version) {
    throw new Error('This production build has no compatible snapshot version. Reload while online.');
  }
  return version;
}

function validateSnapshot(value: unknown, source: string): Snapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${source} snapshot has an invalid shape.`);
  }
  const candidate = value as { version?: unknown; files?: unknown };
  if (typeof candidate.version !== 'string' || !candidate.version) {
    throw new Error(`${source} snapshot has an invalid version.`);
  }
  if (!candidate.files || typeof candidate.files !== 'object' || Array.isArray(candidate.files)) {
    throw new Error(`${source} snapshot has an invalid files map.`);
  }
  for (const [path, bytes] of Object.entries(candidate.files)) {
    if (!path || typeof bytes !== 'string') {
      throw new Error(`${source} snapshot has an invalid file entry.`);
    }
  }
  const expected = expectedProductionVersion();
  if (expected && candidate.version !== expected) {
    throw new Error(
      `${source} snapshot version ${candidate.version} is incompatible with this build; expected ${expected}. Reload while online.`,
    );
  }
  return candidate as Snapshot;
}

async function decodeResponse(response: Response, source: string): Promise<{
  snapshot: Snapshot;
  files: Record<string, string | Uint8Array>;
}> {
  if (!response.ok) throw new Error(`Failed to load snapshot: ${response.status}`);
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error(`${source} snapshot contains invalid JSON.`);
  }
  const snapshot = validateSnapshot(value, source);
  const files: Record<string, string | Uint8Array> = {};
  const decoder = new TextDecoder('utf-8', { fatal: true });

  for (const [path, base64] of Object.entries(snapshot.files)) {
    const bytes = base64ToUint8Array(base64, path);
    try {
      files[path] = isTextFile(path) ? decoder.decode(bytes) : bytes;
    } catch {
      throw new Error(`Snapshot text file has invalid UTF-8 bytes: ${path}`);
    }
  }
  return { snapshot, files };
}

async function openSnapshotCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const expected = expectedProductionVersion();
    return await caches.open(expected ? `${CACHE_NAME}-${expected}` : CACHE_NAME);
  } catch (error) {
    console.warn('[Snapshot] Cache API unavailable:', error);
    return null;
  }
}

let cachedSnapshot: Record<string, string | Uint8Array> | null = null;
let inFlight: Promise<Record<string, string | Uint8Array>> | null = null;
let cacheGeneration = 0;

// Version of the snapshot this session loaded (release diagnostics).
let loadedVersion: string | null = null;

export function getLoadedSnapshotVersion(): string | null {
  return loadedVersion;
}

async function fetchSnapshotData(generation: number): Promise<{
  snapshot: Snapshot;
  files: Record<string, string | Uint8Array>;
}> {
  const cachePromise = openSnapshotCache();
  let networkFailure: unknown;

  try {
    const response = await fetch(SNAPSHOT_URL);
    const cacheCopy = response.clone();
    const decoded = await decodeResponse(response, 'Network');
    if (generation !== cacheGeneration) throw new Error('Snapshot load was cleared before completion.');

    const cache = await cachePromise;
    if (cache && generation === cacheGeneration) {
      try {
        await cache.put(SNAPSHOT_URL, cacheCopy);
      } catch (error) {
        console.warn('[Snapshot] Could not store snapshot cache:', error);
      }
    }
    return decoded;
  } catch (error) {
    if (generation !== cacheGeneration) throw new Error('Snapshot load was cleared before completion.');
    networkFailure = error;
  }

  const cache = await cachePromise;
  if (!cache) throw networkFailure;

  let cachedResponse: Response | undefined;
  try {
    cachedResponse = await cache.match(SNAPSHOT_URL);
  } catch (error) {
    console.warn('[Snapshot] Could not read snapshot cache:', error);
    throw networkFailure;
  }
  if (!cachedResponse) throw networkFailure;

  const decoded = await decodeResponse(cachedResponse, 'Cached');
  if (generation !== cacheGeneration) throw new Error('Snapshot load was cleared before completion.');
  console.log('[Snapshot] Using compatible offline cache (version:', decoded.snapshot.version, ')');
  return decoded;
}

export function loadSnapshot(): Promise<Record<string, string | Uint8Array>> {
  if (cachedSnapshot) {
    console.log('[Snapshot] Using in-memory cache');
    return Promise.resolve(cachedSnapshot);
  }
  if (inFlight) return inFlight;

  const generation = cacheGeneration;
  const load = fetchSnapshotData(generation).then(({ snapshot, files }) => {
    if (generation !== cacheGeneration) throw new Error('Snapshot load was cleared before completion.');
    cachedSnapshot = files;
    loadedVersion = snapshot.version;
    console.log('[Snapshot] Decoded', Object.keys(files).length, 'files');
    return files;
  });
  inFlight = load;
  void load.then(
    () => { if (inFlight === load) inFlight = null; },
    () => { if (inFlight === load) inFlight = null; },
  );
  return load;
}

/**
 * Clear the cached snapshot (useful for testing or force refresh). An older
 * in-flight generation may finish its I/O, but it cannot publish module state.
 */
export function clearSnapshotCache(): void {
  cacheGeneration++;
  cachedSnapshot = null;
  inFlight = null;
  console.log('[Snapshot] Cache cleared');
}
