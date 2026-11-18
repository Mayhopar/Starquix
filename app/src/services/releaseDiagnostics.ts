import { version } from '../../package.json';
import { getLoadedSnapshotVersion } from './snapshotLoader';
export const ALLOWED_DIAGNOSTIC_FIELDS = ['appVersion', 'timestamp', 'browserFamily', 'snapshotVersion', 'failureCategory'] as const;
const failures = ['none', 'capability', 'storage', 'startup', 'save', 'render', 'unknown'] as const;
export type FailureCategory = typeof failures[number];
export function createReleaseDiagnostics(context: { failureCategory?: FailureCategory } = {}) {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const browserFamily = /Edg\//.test(ua) ? 'edge' : /Chrome\//.test(ua) ? 'chrome' : /Firefox\//.test(ua) ? 'firefox' : /Safari\//.test(ua) ? 'safari' : 'unknown';
  const snapshot: unknown = getLoadedSnapshotVersion();
  return {
    appVersion: /^\d+\.\d+\.\d+$/.test(version) ? version : 'unknown',
    timestamp: new Date().toISOString(), browserFamily,
    snapshotVersion: typeof snapshot === 'string' && /^[a-f0-9]{12}$/.test(snapshot) ? snapshot : null,
    failureCategory: failures.includes(context.failureCategory as FailureCategory) ? context.failureCategory! : 'unknown',
  };
}
export function downloadReleaseDiagnostics(context: { failureCategory?: FailureCategory } = {}): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(createReleaseDiagnostics(context), null, 2)], { type: 'application/json' }));
  try {
    const link = document.createElement('a'); link.href = url; link.download = 'starquix-diagnostics.json'; link.click();
  } finally { URL.revokeObjectURL(url); }
}
