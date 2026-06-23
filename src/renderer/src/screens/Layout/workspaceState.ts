import type { ChatRun } from "./chatRuns";

/**
 * Workspace restore — remember which conversations were open, which was active,
 * and the current screen, so the app reopens where the user left off.
 *
 * Design (per LLM Council, 2026-06): UI layout state belongs to the renderer,
 * so it lives in localStorage (the same pattern as the sidebar-collapsed /
 * sessions-expanded prefs). Conversation BODIES already live durably in the
 * engine SessionDB per profile, so we persist only *pointers* — sessionId,
 * profile, title, order — never message content. A wiped localStorage loses
 * tab arrangement only; no conversation is ever lost.
 *
 * Versioned + corruption-safe: any parse/shape problem degrades to "start
 * fresh" (an empty restore), never throws into launch.
 */

const WORKSPACE_KEY = "hermes.workspace.v1";
const WORKSPACE_VERSION = 1;
/** Cap how many tabs we restore so a runaway session list can't wedge launch. */
const MAX_RESTORED_TABS = 20;

/** One persisted open tab — pointers only, no message bodies. */
export interface PersistedTab {
  sessionId: string;
  profile: string;
  title?: string;
}

export interface WorkspaceState {
  version: number;
  savedAt: number;
  /** Open tabs that are worth restoring (had a real session), in tab order. */
  tabs: PersistedTab[];
  /** sessionId of the tab that was active, or null. */
  activeSessionId: string | null;
  /** The screen/view that was showing, or null to default to chat. */
  view: string | null;
}

/**
 * Persist the current workspace. Only runs with a real sessionId are saved —
 * blank "scratch" tabs (sessionId=null, no title) are skipped since there is
 * nothing to restore. Best-effort: storage failures are swallowed.
 */
export function saveWorkspace(
  runs: ChatRun[],
  activeRunId: string,
  view: string,
): void {
  try {
    const tabs: PersistedTab[] = runs
      .filter((r) => !!r.sessionId)
      .slice(0, MAX_RESTORED_TABS)
      .map((r) => ({
        sessionId: r.sessionId as string,
        profile: r.profile,
        title: r.title,
      }));
    const activeRun = runs.find((r) => r.runId === activeRunId);
    const state: WorkspaceState = {
      version: WORKSPACE_VERSION,
      savedAt: Date.now(),
      tabs,
      activeSessionId: activeRun?.sessionId ?? null,
      view,
    };
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable / quota — non-fatal, restore just won't happen */
  }
}

/**
 * Load the last persisted workspace, or null if none / corrupt / forward-
 * incompatible. Never throws — a bad blob degrades to a clean start.
 */
export function loadWorkspace(): WorkspaceState | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(WORKSPACE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const state = parsed as Partial<WorkspaceState>;
  // Forward-incompatible (written by a newer app): ignore rather than guess.
  if (typeof state.version === "number" && state.version > WORKSPACE_VERSION) {
    return null;
  }
  if (!Array.isArray(state.tabs)) return null;
  // Defensive: keep only well-formed tab entries.
  const tabs = state.tabs.filter(
    (t): t is PersistedTab =>
      !!t &&
      typeof t === "object" &&
      typeof (t as PersistedTab).sessionId === "string" &&
      typeof (t as PersistedTab).profile === "string",
  );
  return {
    version: WORKSPACE_VERSION,
    savedAt: typeof state.savedAt === "number" ? state.savedAt : 0,
    tabs,
    activeSessionId:
      typeof state.activeSessionId === "string" ? state.activeSessionId : null,
    view: typeof state.view === "string" ? state.view : null,
  };
}

/** Clear the persisted workspace (used by a "start fresh" affordance). */
export function clearWorkspace(): void {
  try {
    localStorage.removeItem(WORKSPACE_KEY);
  } catch {
    /* ignore */
  }
}
