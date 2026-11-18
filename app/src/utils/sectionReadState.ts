import type { OperationIssue } from './operationIssue';
export type SectionReadState<T> =
  | { status: 'loading'; data: T | null }
  | { status: 'ready'; data: T }
  | { status: 'unavailable'; data: T | null; issue: OperationIssue };
