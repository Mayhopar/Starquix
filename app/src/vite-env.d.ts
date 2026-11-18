/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
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

