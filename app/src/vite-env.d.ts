/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  /** '1' = the web demo build (services/webDesktop.ts): the editor talks to a per-visitor web-host over HTTP. */
  readonly VITE_SQ_WEB?: string;
  /** Web demo: the web-host API base (default '/api', the demo Worker). */
  readonly VITE_SQ_WEB_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Virtual module: built-in component library fallback (bundled at build time)
declare module 'virtual:built-in-components' {
  import type { ScannedComponent } from '@/hooks/useComponentLibrary';
  const components: ScannedComponent[];
  export default components;
}

