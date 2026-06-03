import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { LEADERBOARD } from "../config/constants";

/**
 * Global arcade leaderboard backed by Supabase.
 *
 * Reads (top scores, rank) go straight to Supabase with the anon public key —
 * they're public by design. WRITES are gated: a score can only be inserted
 * through a real, single-use match. `startMatch()` (called when a game begins)
 * asks the DB for a server-timestamped match id; `submitScore()` hands that id
 * to the `submit_run` SECURITY DEFINER function, which atomically consumes the
 * match, plausibility-checks the score against elapsed time, and inserts it.
 * Direct anon INSERT into `scores` is revoked in the DB, so a forged REST insert
 * with the public key no longer works. If the env vars are absent the
 * leaderboard simply disables itself so the game still runs locally.
 */

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;

/** Match id issued by `start_match`, consumed by the next `submitScore`. */
let currentMatchId: string | null = null;

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
 * Begin a new run: ask the DB for a single-use, server-timestamped match id and
 * stash it for the next submit. Safe to call when the leaderboard is disabled
 * (no-op). Failures are swallowed — the player just gets an unsaved score later.
 */
export async function startMatch(): Promise<void> {
  currentMatchId = null;
  const c = getClient();
  if (!c) return;
  try {
    const { data, error } = await c.rpc("start_match");
    if (error) {
      console.error("[leaderboard] startMatch failed:", error.message);
      return;
    }
    if (typeof data === "string") currentMatchId = data;
  } catch (e) {
    console.error("[leaderboard] startMatch threw:", e);
  }
}

/**
 * Submit a run through the match gate, then fetch the resulting top board. The
 * server (submit_run) returns the rank and row id atomically; we fetch the top
 * separately for display. Network/validation failures degrade gracefully: `ok`
 * is false and rank/top are best-effort. A timeout guards against a hung network
 * leaving the player stuck on "submitting". The match id is single-use and is
 * cleared whether or not the submit succeeds.
 */
export async function submitScore(name: string, score: number): Promise<SubmitResult> {
  const c = getClient();
  const matchId = currentMatchId;
  currentMatchId = null;
  if (!c || !matchId) return { rank: 0, top: [], ok: false };

  const clean = name.toUpperCase().slice(0, LEADERBOARD.NAME_LEN_MAX);
  const clamped = Math.max(0, Math.min(LEADERBOARD.MAX_SCORE, Math.round(score)));

  const run = async (): Promise<SubmitResult> => {
    const { data, error } = await c.rpc("submit_run", {
      p_match: matchId,
      p_name: clean,
      p_score: clamped,
    });
    if (error) {
      console.error("[leaderboard] submit failed:", error.message);
      const top = await getTop();
      return { rank: 0, top, ok: false };
    }
    // submit_run returns a single { row_id, rank } row.
    const row = Array.isArray(data) ? data[0] : data;
    const top = await getTop();
    return {
      rank: typeof row?.rank === "number" ? row.rank : 0,
      top,
      ok: true,
      rowId: row?.row_id as number | undefined,
    };
  };

  return withTimeout(run(), 7000, { rank: 0, top: [], ok: false });
}
