import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { LEADERBOARD } from "../config/constants";

/**
 * Global arcade leaderboard backed by Supabase.
 *
 * The client talks to Supabase directly from the browser using the anon public
 * key (safe by design — Postgres row-level security + CHECK constraints guard
 * the `scores` table). If the env vars are absent the leaderboard simply
 * disables itself so the game still runs locally.
 */

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
  if (!URL || !KEY) return null;
  if (!client) client = createClient(URL, KEY);
  return client;
}

/** True when Supabase credentials are configured at build time. */
export function isLeaderboardEnabled(): boolean {
  return Boolean(URL && KEY);
}

export interface ScoreRow {
  id?: number;
  name: string;
  score: number;
}

export interface SubmitResult {
  /** 1-based arcade rank for the submitted score (0 if unavailable). */
  rank: number;
  /** Current top rows for display. */
  top: ScoreRow[];
  /** Whether the insert itself succeeded. */
  ok: boolean;
  /** Primary key of the inserted row, for unambiguous highlighting. */
  rowId?: number;
}

/** Reject (resolve to fallback) if a promise takes too long, so the UI never hangs. */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/** Top `limit` scores, highest first. */
export async function getTop(limit: number = LEADERBOARD.TOP_N): Promise<ScoreRow[]> {
  const c = getClient();
  if (!c) return [];
  const { data, error } = await c
    .from("scores")
    .select("id,name,score")
    .order("score", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) {
    console.error("[leaderboard] getTop failed:", error.message);
    return [];
  }
  return (data ?? []) as ScoreRow[];
}

/** Exact 1-based rank for a score (count of strictly-higher scores + 1). */
export async function getRank(score: number): Promise<number> {
  const c = getClient();
  if (!c) return 0;
  const { data, error } = await c.rpc("get_rank", { s: score });
  if (error || typeof data !== "number") {
    if (error) console.error("[leaderboard] getRank failed:", error.message);
    return 0;
  }
  return data;
}

/**
 * Submit a run, then fetch the resulting rank and top board. Network/validation
 * failures degrade gracefully: `ok` reflects the insert, while rank/top are
 * best-effort so the UI can still show whatever it can. A timeout guards against
 * a hung network leaving the player stuck on "submitting".
 */
export async function submitScore(name: string, score: number): Promise<SubmitResult> {
  const c = getClient();
  if (!c) return { rank: 0, top: [], ok: false };

  const clean = name.toUpperCase().slice(0, LEADERBOARD.NAME_LEN);
  const clamped = Math.max(0, Math.min(LEADERBOARD.MAX_SCORE, Math.round(score)));

  const run = async (): Promise<SubmitResult> => {
    const { data, error } = await c
      .from("scores")
      .insert({ name: clean, score: clamped })
      .select("id")
      .single();
    if (error) console.error("[leaderboard] submit failed:", error.message);

    const [rank, top] = await Promise.all([getRank(clamped), getTop()]);
    return { rank, top, ok: !error, rowId: data?.id as number | undefined };
  };

  return withTimeout(run(), 7000, { rank: 0, top: [], ok: false });
}
