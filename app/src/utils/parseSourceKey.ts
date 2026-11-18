// src/utils/parseSourceKey.ts

type ParsedSourceKey =
  | { type: 'legacy'; key: string }
  | { type: 'instance'; instanceId: string; childId: string };

export function parseSourceKey(key: string): ParsedSourceKey {
  const parts = key.split(':');

  // Legacy format: "id:1:1" or "file:line:column" (3 parts, middle is numeric)
  if (parts.length === 3 && !isNaN(Number(parts[1]))) {
    return { type: 'legacy', key };
  }

  // New format: "instanceId:childId" (2 parts)
  if (parts.length === 2) {
    return { type: 'instance', instanceId: parts[0], childId: parts[1] };
  }

  // Default to legacy for unknown formats
  return { type: 'legacy', key };
}
