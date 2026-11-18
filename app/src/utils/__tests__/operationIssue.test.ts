import { expect, it } from 'vitest';
import { issueCopy, issueKey, isIssueForOwner, isIssueSilent, mayOfferRecovery, type OperationIssue } from '../operationIssue';

const issue = (overrides: Partial<OperationIssue> = {}): OperationIssue => ({ code: 'operation-failed', operation: 'save',
  outcome: 'unknown', owner: { projectId: 'browser_a', entityKey: 'save', visit: 1 }, episode: 1,
  recover: 'get-help', fallbackUsable: false, ...overrides });

it('unknown failure copy cannot interpolate arbitrary diagnostics or scope identifiers', () => {
  const input = { ...issue(), message: '<html>/Users/private/token-secret', owner: { projectId: 'private-project', entityKey: 'private-file', visit: 2 } };
  expect(JSON.stringify(issueCopy(input))).not.toMatch(/<html>|Users|token-secret|private-project|private-file/);
  expect(issueCopy(input).title).toBe('This action could not be completed.');
});
it('separates issue visits, projects and episodes and rejects a previous owner', () => {
  const current = issue();
  const others = [issue({ episode: 2 }), issue({ owner: { ...current.owner, projectId: 'browser_b' } }), issue({ owner: { ...current.owner, visit: 2 } })];
  expect(new Set([current, ...others].map(issueKey)).size).toBe(4);
  expect(isIssueForOwner(current, { ...current.owner, visit: 2 })).toBe(false);
  expect(isIssueForOwner(current, { ...current.owner, projectId: 'browser_b' })).toBe(false);
  expect(isIssueForOwner(current, current.owner)).toBe(true);
});
it.each(['pending', 'written-not-durable', 'partial', 'unknown', 'no-write'] as const)('never silences a failed requested mutation with outcome %s', outcome => {
  expect(isIssueSilent(issue({ code: 'read-unavailable', outcome, fallbackUsable: true }))).toBe(false);
});
it('silences only a nonessential read with a valid fallback', () => {
  expect(isIssueSilent(issue({ code: 'read-unavailable', operation: 'components', outcome: 'not-applicable', fallbackUsable: true }))).toBe(true);
  expect(isIssueSilent(issue({ code: 'read-unavailable', operation: 'components', outcome: 'not-applicable' }))).toBe(false);
});
it('refuses restart for deterministic setup or an uncertain write, while retaining supported save recovery', () => {
  const conflict = issue({ code: 'setup-conflict', operation: 'startup', outcome: 'not-applicable', recover: 'restart-preview' });
  expect(mayOfferRecovery(conflict)).toBe(false);
  expect(issueCopy(conflict).actionLabel).toBeUndefined();
  expect(mayOfferRecovery(issue({ recover: 'read-again' }))).toBe(false);
  expect(mayOfferRecovery(issue({ recover: 'retry-save' }))).toBe(true);
});
