/** Presentation metadata only. Raw causes stay with the operation owner. */
export type IssueCode = 'read-unavailable' | 'invalid-input' | 'unsupported-edit'
  | 'storage-unavailable' | 'write-refused' | 'save-incomplete' | 'outcome-unknown'
  | 'startup-unavailable' | 'setup-conflict' | 'provider-auth' | 'provider-limit'
  | 'operation-failed' | 'render-unavailable';
export type Operation = 'components' | 'layouts' | 'media-list' | 'upload' | 'replace-media'
  | 'font' | 'source-read' | 'source-write' | 'folder-save'
  | 'import' | 'theme-import' | 'project-create' | 'project-rename' | 'project-delete'
  | 'save' | 'export' | 'deploy' | 'startup' | 'post-write' | 'ai' | 'controls';
export type WriteOutcome = 'not-applicable' | 'no-write' | 'pending' | 'written-not-durable' | 'partial' | 'unknown';
export interface OperationIssue {
  code: IssueCode;
  operation: Operation;
  outcome: WriteOutcome;
  owner: { projectId: string | null; entityKey: string; visit: number };
  episode: number;
  recover: 'none' | 'read-again' | 'correct-input' | 'retry-save' | 'restart-preview' | 'open-settings' | 'get-help';
  fallbackUsable: boolean;
}
export interface IssueCopy { title: string; detail?: string; actionLabel?: string }

const titles: Record<IssueCode, string> = {
  'read-unavailable': 'This content is unavailable.',
  'invalid-input': 'This value could not be used.',
  'unsupported-edit': 'This change is not supported.',
  'storage-unavailable': 'Browser storage could not complete this action.',
  'write-refused': 'This change could not be completed.',
  'save-incomplete': 'Some changes have not been confirmed as saved.',
  'outcome-unknown': 'This change has not been confirmed.',
  'startup-unavailable': 'The preview could not start.',
  'setup-conflict': 'The preview could not be prepared for this project.',
  'provider-auth': 'The AI request could not start. Check the provider connection.',
  'provider-limit': 'The AI request could not continue. Check the provider usage limit.',
  'operation-failed': 'This action could not be completed.',
  'render-unavailable': 'This view is unavailable.',
};
const readTitles: Partial<Record<Operation, string>> = {
  components: 'Project components are unavailable.', layouts: 'Project layouts are unavailable.',
  'media-list': 'Project media is unavailable.', 'source-read': 'The source could not be opened.',
};
const actions: Record<OperationIssue['recover'], string | undefined> = {
  none: undefined, 'read-again': 'Retry', 'correct-input': 'Review input', 'retry-save': 'Retry save',
  'restart-preview': 'Restart preview', 'open-settings': 'Open settings', 'get-help': 'Help',
};

/** Policy permission only; the feature must also supply a supported callback. */
export function mayOfferRecovery(issue: OperationIssue): boolean {
  if (issue.recover === 'none') return false;
  if (issue.recover === 'get-help' || issue.recover === 'retry-save') return true;
  if (issue.outcome !== 'not-applicable' && issue.outcome !== 'no-write') return false;
  if (issue.recover === 'restart-preview') return issue.code === 'startup-unavailable' && issue.outcome === 'not-applicable';
  if (issue.recover === 'read-again') return issue.code === 'read-unavailable' && issue.outcome === 'not-applicable';
  if (issue.recover === 'correct-input') return issue.code === 'invalid-input' || issue.code === 'unsupported-edit';
  return issue.code === 'provider-auth' || issue.code === 'provider-limit';
}

export function issueCopy(issue: OperationIssue): IssueCopy {
  const actionLabel = mayOfferRecovery(issue) ? actions[issue.recover] : undefined;
  if (issue.operation === 'startup') return {
    title: titles[issue.code] ?? titles['startup-unavailable'],
    detail: issue.code === 'setup-conflict'
      ? 'A source conflict prevented project setup. Your edits are stored in this browser; use Help to resolve the conflict.'
      : 'Project setup has not been confirmed. Your edits are stored in this browser; use Help before restarting.',
    actionLabel,
  };
  const title = issue.code === 'read-unavailable' ? readTitles[issue.operation] ?? titles[issue.code] : titles[issue.code] ?? titles['operation-failed'];
  return { title, actionLabel };
}

/** Scope keys remain in memory, never in diagnostics or exported projects. */
export function issueKey(issue: OperationIssue): string {
  const { projectId, entityKey, visit } = issue.owner;
  return JSON.stringify([projectId, entityKey, visit, issue.operation, issue.code, issue.episode]);
}
export function isIssueForOwner(issue: OperationIssue, owner: OperationIssue['owner']): boolean {
  return issue.owner.projectId === owner.projectId && issue.owner.entityKey === owner.entityKey && issue.owner.visit === owner.visit;
}

/** Only a nonessential failed read with an intact fallback may stay silent. */
export function isIssueSilent(issue: OperationIssue): boolean {
  return issue.fallbackUsable && issue.outcome === 'not-applicable'
    && (issue.code === 'read-unavailable' || issue.code === 'render-unavailable');
}
