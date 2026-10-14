/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** mock (default) or live */
  readonly VITE_TRAIN_SOURCE?: string;
  /** URL of the deployed Train Tracker proxy, for live data */
  readonly VITE_TRAIN_PROXY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Fontsource weight entry points are CSS files without type declarations.
declare module "@fontsource/big-shoulders-display/*";
