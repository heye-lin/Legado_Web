/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional App/WebService API address. If absent, the web app runs in pure browser mode by default. */
  readonly VITE_API?: string
  /** Set to "false" to force legacy App/WebService mode, or "true" to force pure browser mode. */
  readonly VITE_STANDALONE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module 'vue3-virtual-scroll-list'
