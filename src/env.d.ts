/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly SMU1_DEPLOY_TARGET: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
