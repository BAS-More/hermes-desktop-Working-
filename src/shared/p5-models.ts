/**
 * Phase 5 — pure models for deep links, CI status, and @mention autocomplete.
 *
 * These back the session/PR-CI status bar, the `hermes://` deep-link launcher,
 * and @mention file autocomplete. All pure (no IO/React) and security-hardened:
 * a deep link NEVER auto-executes — it only validates inputs and yields a prompt
 * the user must still confirm (mirrors Claude Code's inert-deep-link design).
 *
 * Contract pinned by tests/p5-models.test.ts + tests/specs/p5-models.feature.
 */

// ---- deep links -----------------------------------------------------------

export type DeepLinkResult =
  | { ok: true; action: "open"; cwd?: string; repo?: string; prompt?: string }
  | { ok: false; reason: string };

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MAX_PROMPT = 5000;

/** Reject UNC (\\server\share) and network (//host) working directories. */
function isNetworkPath(p: string): boolean {
  return /^\\\\/.test(p) || /^\/\//.test(p);
}

export function parseDeepLink(url: string): DeepLinkResult {
  if (typeof url !== "string" || url.trim() === "") {
    return { ok: false, reason: "empty url" };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "malformed url" };
  }
  if (parsed.protocol !== "hermes:") {
    return { ok: false, reason: "non-hermes scheme" };
  }
  // hermes://open — host is "open"
  const action = parsed.host || parsed.pathname.replace(/^\/+/, "");
  if (action !== "open") {
    return { ok: false, reason: "unsupported action" };
  }

  const params = parsed.searchParams;
  const result: DeepLinkResult = { ok: true, action: "open" };

  const cwd = params.get("cwd");
  if (cwd) {
    if (isNetworkPath(cwd)) {
      return { ok: false, reason: "network/UNC cwd rejected" };
    }
    result.cwd = cwd;
  }

  const repo = params.get("repo");
  if (repo) {
    if (!REPO_RE.test(repo)) {
      return { ok: false, reason: "malformed repo (expected owner/name)" };
    }
    result.repo = repo;
  }

  const q = params.get("q");
  if (q) {
    // URLSearchParams already decodes %20/%0A; just enforce the cap.
    if (q.length > MAX_PROMPT) {
      return { ok: false, reason: "prompt exceeds 5000 chars" };
    }
    result.prompt = q;
  }

  return result;
}

// ---- CI status ------------------------------------------------------------

export interface CiCheck {
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion?: "success" | "failure" | "cancelled" | "neutral";
}

export interface CiSummary {
  state: "pending" | "passing" | "failing";
  passed: number;
  failed: number;
  pending: number;
}

export function ciSummary(checks: CiCheck[]): CiSummary {
  let passed = 0;
  let failed = 0;
  let pending = 0;
  for (const c of checks ?? []) {
    if (c.status !== "completed") {
      pending += 1;
    } else if (c.conclusion === "success" || c.conclusion === "neutral") {
      passed += 1;
    } else if (c.conclusion === "failure" || c.conclusion === "cancelled") {
      failed += 1;
    } else {
      // completed with no/unknown conclusion — treat as pending, not a pass.
      pending += 1;
    }
  }
  const state: CiSummary["state"] =
    failed > 0
      ? "failing"
      : pending > 0
        ? "pending"
        : passed > 0
          ? "passing"
          : "pending";
  return { state, passed, failed, pending };
}

export function canAutoMerge(
  summary: CiSummary,
  opts: { autoMergeEnabled: boolean },
): boolean {
  return opts.autoMergeEnabled && summary.state === "passing";
}

export function shouldAutoFix(
  summary: CiSummary,
  opts: { autoFixEnabled: boolean },
): boolean {
  return opts.autoFixEnabled && summary.state === "failing";
}

// ---- @mention autocomplete ------------------------------------------------

export interface MentionQuery {
  active: boolean;
  query: string;
  start: number;
}

const INACTIVE: MentionQuery = { active: false, query: "", start: -1 };

/**
 * Detect an in-progress "@word" token ending at the caret. The token starts at
 * an "@" preceded by start-of-string or whitespace and runs to the caret with
 * no intervening whitespace.
 */
export function parseMentionQuery(
  text: string,
  caretIndex: number,
): MentionQuery {
  if (typeof text !== "string") return INACTIVE;
  const caret = Math.max(0, Math.min(caretIndex, text.length));
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at === -1) return INACTIVE;
  const token = before.slice(at + 1);
  if (/\s/.test(token)) return INACTIVE; // a space ended the mention
  const prevChar = at > 0 ? before[at - 1] : "";
  if (prevChar !== "" && !/\s/.test(prevChar)) return INACTIVE; // mid-word @
  return { active: true, query: token, start: at };
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

/**
 * Filter file paths by a query, ranking basename-prefix matches above other
 * substring matches. Case-insensitive. Stable within a rank.
 */
export function filterMentionCandidates(
  files: string[],
  query: string,
  limit = 8,
): string[] {
  const q = (query || "").toLowerCase();
  if (q === "") return files.slice(0, limit);
  const prefix: string[] = [];
  const substr: string[] = [];
  for (const f of files) {
    const base = basename(f).toLowerCase();
    const full = f.toLowerCase();
    if (base.startsWith(q)) prefix.push(f);
    else if (full.includes(q)) substr.push(f);
  }
  return [...prefix, ...substr].slice(0, limit);
}
