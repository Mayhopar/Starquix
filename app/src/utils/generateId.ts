export function generateId(): string {
  return `el-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function generatePageId(): string {
  return `page-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** The `drawn-` prefix is load-bearing: isDrawnKey()/classifyKey() detect it. */
export function generateDrawnKey(): string {
  return `drawn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
