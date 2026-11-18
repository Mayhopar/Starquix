
export interface BrowserStorageInfo { usage: number | null; quota: number | null; persisted: boolean | null }
const bytes = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
export async function getBrowserStorage(): Promise<BrowserStorageInfo> {
  const info: BrowserStorageInfo = { usage: null, quota: null, persisted: null };
  try {
    const estimate = await navigator.storage?.estimate?.();
    info.usage = bytes(estimate?.usage); info.quota = bytes(estimate?.quota);
  } catch { /* Advisory only; actual writes remain authoritative. */ }
  try {
    const persisted = await navigator.storage?.persisted?.();
    info.persisted = typeof persisted === 'boolean' ? persisted : null;
  } catch { /* Privacy settings can deny this API. */ }
  return info;
}
/** Call only from the explicit Keep browser storage gesture. */
export async function requestBrowserPersistence(): Promise<boolean | null> {
  try {
    const result = await navigator.storage?.persist?.();
    return typeof result === 'boolean' ? result : null;
  } catch { return null; }
}
export function isStorageFailure(error: unknown): boolean {
  const fields = error && typeof error === 'object' ? error as { name?: unknown; message?: unknown } : {};
  const text = typeof error === 'string' ? error : [fields.name, fields.message].filter(value => typeof value === 'string').join(' ');
  return /quota|indexeddb|storage|disk full|databaseclosed|openfailed|securityerror/i.test(text);
}
export function storageFailureGuidance(error: unknown, operation: 'create' | 'import' | 'load'): string {
  if (isStorageFailure(error)) return 'Browser storage could not complete this action. Retry; if it still fails, use Help and download diagnostics. Existing projects and selected import files are kept.';
  return operation === 'import' ? 'The project could not be imported. Check the selected folder and try again. If it still fails, use Help. Your selected files are kept.' : 'The project action failed. Try again. Help and local diagnostics are available.';
}
