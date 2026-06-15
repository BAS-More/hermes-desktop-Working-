import type { ChatMessage } from "../Chat/Chat";

/**
 * One concurrently-running (or open) conversation. Several runs coexist so the
 * user can background a session — or a whole agent/profile — and return to it
 * live. `runId` is minted in the renderer and threaded through the main process
 * so streaming events route back to the right run.
 */
export interface ChatRun {
  runId: string;
  /** Immutable: the profile/agent this run was started under. */
  profile: string;
  /** Gateway session id, known once the first turn reports it. */
  sessionId: string | null;
  /** True while the agent is generating for this run. */
  loading: boolean;
  /** Best-effort title (first user message) for the active-sessions bar. */
  title?: string;
  /** Seed transcript when the run was opened from history. */
  seed?: ChatMessage[];
}

/** Mint a fresh, empty run under the given profile. */
export function mintRun(profile: string, seed?: ChatMessage[]): ChatRun {
  return {
    runId:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `run-${crypto.randomUUID()}`
        : `run-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    profile,
    sessionId: null,
    loading: false,
    seed,
  };
}

/** Immutably patch one run's fields by id. */
export function patchRun(
  runs: ChatRun[],
  runId: string,
  patch: Partial<ChatRun>,
): ChatRun[] {
  return runs.map((r) => (r.runId === runId ? { ...r, ...patch } : r));
}

/** The first live run already bound to a given gateway session id, if any. */
export function findRunBySession(
  runs: ChatRun[],
  sessionId: string,
): ChatRun | undefined {
  return runs.find((r) => r.sessionId === sessionId);
}

/** Session ids of every currently-loading run (for sidebar spinners). */
export function loadingSessionIds(runs: ChatRun[]): Set<string> {
  const ids = new Set<string>();
  for (const r of runs) {
    if (r.loading && r.sessionId) ids.add(r.sessionId);
  }
  return ids;
}
