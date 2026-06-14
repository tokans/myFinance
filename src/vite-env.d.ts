/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" when built by the demo-capture rig (see src/lib/demoMode.ts). */
  readonly VITE_DEMO_MODE?: string;
  /** Absolute path to demo/output/, injected by the demo build for fixed save paths. */
  readonly VITE_DEMO_OUTPUT_DIR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
