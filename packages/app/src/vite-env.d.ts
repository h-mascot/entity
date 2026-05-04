/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENTITY_API_BASE?: string;
  readonly VITE_ENTITY_WS_URL?: string;
  readonly VITE_ENTITY_WS_PORT?: string;
  readonly VITE_MC_ORIGIN?: string;
  readonly VITE_OPENCLAW_BASE?: string;
  readonly VITE_ENTITY_FS_MULTISOURCE?: string;
  readonly VITE_ENTITY_AGENT_NATIVE_EDITOR?: string;
  readonly VITE_ENTITY_CLOUD_CHAT_URL?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_APP_VERSION?: string;
  readonly MODE: string;
}

declare module 'react-dom/client';
declare module '*.html?raw' {
  const content: string;
  export default content;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
