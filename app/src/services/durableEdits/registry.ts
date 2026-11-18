import type { MaterializationCommand, MaterializationReceipt } from './types';

export interface MaterializerContext {
  projectId: string;
  /** The enclosing journal operation; the method argument is the command ID. */
  operationId: string;
  revision: number;
  commandIndex: number;
}

export type ReconcileResult =
  | { status: 'written'; receipt: MaterializationReceipt }
  | { status: 'not-written' }
  /** A durable writer outcome proves only a partial write, not safe replay. */
  | { status: 'partial'; error: unknown }
  | { status: 'unknown'; error: unknown };

export interface MaterializerAdapter<C extends MaterializationCommand> {
  /** Only return not-written when repeating this command is verified safe. */
  reconcile(command: C, operationId: string, context: MaterializerContext): Promise<ReconcileResult>;
  /** Resolve only with a verified writer receipt, scoped to the command ID. */
  dispatch(command: C, operationId: string, context: MaterializerContext): Promise<MaterializationReceipt>;
}

type Kind = MaterializationCommand['kind'];
type CommandOf<K extends Kind> = Extract<MaterializationCommand, { kind: K }>;

export function createMaterializerRegistry() {
  const adapters = new Map<Kind, { adapter: MaterializerAdapter<MaterializationCommand> }>();
  const listeners = new Set<() => void>();
  return {
    registerMaterializer<K extends Kind>(kind: K, adapter: MaterializerAdapter<CommandOf<K>>): () => void {
      const registration = { adapter: adapter as MaterializerAdapter<MaterializationCommand> };
      adapters.set(kind, registration);
      for (const listener of listeners) {
        try { listener(); } catch (error) { console.error('[materializer registry]', error); }
      }
      return () => { if (adapters.get(kind) === registration) adapters.delete(kind); };
    },
    get(kind: Kind): MaterializerAdapter<MaterializationCommand> | undefined { return adapters.get(kind)?.adapter; },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export const materializerRegistry = createMaterializerRegistry();
export const registerMaterializer = materializerRegistry.registerMaterializer;
