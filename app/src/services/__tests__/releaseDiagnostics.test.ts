import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../snapshotLoader', () => ({ getLoadedSnapshotVersion: () => 'sk-secret-fixture' }));
import { ALLOWED_DIAGNOSTIC_FIELDS, createReleaseDiagnostics, downloadReleaseDiagnostics } from '../releaseDiagnostics';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('allowlists values as well as keys and never reads localStorage or exports raw runtime data', () => {
  const getItem = vi.fn(() => 'sk-secret-fixture');
  vi.stubGlobal('localStorage', { getItem });
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Chrome/secret sk-secret-fixture');
  const report = createReleaseDiagnostics({ failureCategory: 'sk-secret-fixture' as never });
  expect(Object.keys(report).sort()).toEqual(ALLOWED_DIAGNOSTIC_FIELDS.slice().sort());
  expect(JSON.stringify(report)).not.toContain('sk-secret-fixture');
  expect(report.snapshotVersion).toBe(null);
  expect(report.failureCategory).toBe('unknown'); expect(report.browserFamily).toBe('chrome');
  expect(getItem).not.toHaveBeenCalled();
  expect(report.timestamp).toMatch(/^\d{4}-\d\d-\d\dT/);
});
it('downloads a local JSON blob with a constant filename and releases its URL', () => {
  const create = vi.fn(() => 'blob:local'); const revoke = vi.fn();
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
    expect(this.download).toBe('starquix-diagnostics.json'); expect(this.href).toBe('blob:local');
  });
  downloadReleaseDiagnostics();
  expect(create.mock.calls[0][0]).toBeInstanceOf(Blob); expect(click).toHaveBeenCalledOnce(); expect(revoke).toHaveBeenCalledWith('blob:local');
});
