/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL (public). Empty disables the global leaderboard. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon public key. Safe to ship; protected by row-level security. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
