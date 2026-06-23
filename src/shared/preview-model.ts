/**
 * Phase 4 — preview stack model (pure, no IO/React).
 *
 * Extends the existing <webview partition="web-preview"> mechanism with:
 *  - per-project storage partitions so cookies/localStorage never leak across
 *    projects (the previous single shared partition did leak);
 *  - target classification (web / html / pdf / image / video) so the preview
 *    pane picks the right viewer;
 *  - a reducer for the agent's auto-verify loop result (screenshot/DOM/click/
 *    fill checks → passed/failed) that the UI renders.
 *
 * Contract pinned by tests/preview-model.test.ts + tests/specs/preview-model.feature.
 *
 * NOTE: the partition hash here uses a pure FNV-1a (dependency-free, works in
 * the renderer). It is for STORAGE ISOLATION NAMING, not a security boundary by
 * itself — Electron enforces isolation per partition. If a stronger guarantee
 * is wanted, the main process can re-derive the same partition with SHA-256
 * over the normalized path (see punch-list).
 */

export type PreviewKind =
  | "web"
  | "html"
  | "pdf"
  | "image"
  | "video"
  | "unknown";

/** Normalize a path so trivial spelling differences don't fork partitions. */
function normalizePath(p: string): string {
  return p.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** FNV-1a 32-bit, hex. Pure, deterministic, dependency-free. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Deterministic Electron partition name for a project's preview storage.
 * Persistent partitions get the "persist:" prefix Electron requires for
 * on-disk storage; ephemeral ones are in-memory only.
 */
export function previewPartition(projectPath: string, persist: boolean): string {
  const hash = fnv1a(normalizePath(projectPath));
  const base = `hermes-preview-${hash}`;
  return persist ? `persist:${base}` : base;
}

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "mkv", "avi", "m4v"]);

/** Classify a preview target by URL scheme or file extension. */
export function classifyPreviewTarget(target: string): PreviewKind {
  const t = (target || "").trim();
  if (t === "") return "unknown";
  if (/^https?:\/\//i.test(t)) return "web";
  const ext = t.includes(".") ? t.split(".").pop()!.toLowerCase() : "";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "pdf") return "pdf";
  if (IMAGE_EXT.has(ext)) return "image";
  if (VIDEO_EXT.has(ext)) return "video";
  return "unknown";
}

// ---- auto-verify result reducer -------------------------------------------

export type VerifyKind = "screenshot" | "dom" | "click" | "fill";

export interface VerifyCheck {
  kind: VerifyKind;
  ok: boolean;
  detail?: string;
}

export type VerifyStatus = "idle" | "running" | "passed" | "failed";

export interface PreviewState {
  status: VerifyStatus;
  lastChecks: VerifyCheck[];
}

export type VerifyEvent =
  | { type: "verify.start" }
  | { type: "verify.check"; payload: VerifyCheck }
  | { type: "verify.done" };

export function initialPreviewState(): PreviewState {
  return { status: "idle", lastChecks: [] };
}

/**
 * Fold a verify event into preview state. Pure. A single failed check flips the
 * overall status to "failed" immediately (and it stays failed through done).
 */
export function applyVerifyEvent(
  state: PreviewState,
  event: VerifyEvent,
): PreviewState {
  switch (event?.type) {
    case "verify.start":
      return { status: "running", lastChecks: [] };
    case "verify.check": {
      const checks = [...state.lastChecks, event.payload];
      const anyFailed = checks.some((c) => !c.ok);
      return {
        status: anyFailed ? "failed" : "running",
        lastChecks: checks,
      };
    }
    case "verify.done": {
      const allOk =
        state.lastChecks.length > 0 && state.lastChecks.every((c) => c.ok);
      return { ...state, status: allOk ? "passed" : "failed" };
    }
    default:
      return state;
  }
}
