/**
 * Phase 1 — unified-diff model (pure, no IO, no React).
 *
 * The diff cockpit's file list, "+N -M" badge, and side-by-side viewer are all
 * pure consumers of these functions. The agent core sends a unified diff (git
 * format) as the payload of a `diff.update` event (see @shared/agent-events);
 * the renderer parses it once here and renders from the typed model.
 *
 * Contract pinned by tests/diff-model.test.ts + tests/specs/diff-model.feature.
 * Deliberately dependency-free so it can later back a Monaco-based viewer
 * without changing the data model.
 */

export type DiffLineKind = "context" | "add" | "del";

export interface DiffLine {
  kind: DiffLineKind;
  /** present for context + del */
  oldLineNo?: number;
  /** present for context + add */
  newLineNo?: number;
  text: string;
}

export interface Hunk {
  /** raw "@@ -a,b +c,d @@" header line */
  header: string;
  lines: DiffLine[];
}

export type FileStatus = "modified" | "added" | "deleted" | "renamed";

export interface FileDiff {
  /** final (new) path; for a delete this is the old path */
  path: string;
  /** present for renames and deletes */
  oldPath?: string;
  status: FileStatus;
  added: number;
  removed: number;
  hunks: Hunk[];
}

export interface SbsSide {
  lineNo?: number;
  text: string;
  kind: DiffLineKind;
}

export interface SbsRow {
  left?: SbsSide;
  right?: SbsSide;
}

// ---------------------------------------------------------------------------

const DEV_NULL = "/dev/null";

function stripCr(s: string): string {
  return s.endsWith("\r") ? s.slice(0, -1) : s;
}

/** Strip a leading `a/` or `b/` git prefix from a diff path token. */
function stripGitPrefix(p: string): string {
  if (p === DEV_NULL) return p;
  if (p.startsWith("a/") || p.startsWith("b/")) return p.slice(2);
  return p;
}

interface HunkHeader {
  oldStart: number;
  newStart: number;
}

/** Parse "@@ -10,3 +10,4 @@" → { oldStart: 10, newStart: 10 }. */
function parseHunkHeader(line: string): HunkHeader | null {
  const m = /^@@+\s*-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s*@@/.exec(line);
  if (!m) return null;
  return { oldStart: Number(m[1]), newStart: Number(m[2]) };
}

/**
 * Parse a git/unified diff into typed FileDiff[]. Tolerant of malformed input:
 * anything it can't parse is skipped and an empty list is returned rather than
 * throwing. Untrusted-input safe (no eval, bounded by input length).
 */
export function parseUnifiedDiff(patch: string): FileDiff[] {
  if (typeof patch !== "string" || patch.trim() === "") return [];

  const lines = patch.split("\n").map(stripCr);
  const files: FileDiff[] = [];
  let cur: FileDiff | null = null;
  let curHunk: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  let renameFrom: string | undefined;
  let renameTo: string | undefined;
  let sawDevNullOld = false;
  let sawDevNullNew = false;

  const finishFile = (): void => {
    if (!cur) return;
    // Resolve status now that we've seen the headers.
    if (renameFrom && renameTo) {
      cur.oldPath = renameFrom;
      cur.path = renameTo;
      cur.status = "renamed";
    } else if (sawDevNullOld) {
      cur.status = "added";
    } else if (sawDevNullNew) {
      cur.status = "deleted";
    }
    files.push(cur);
  };

  for (const raw of lines) {
    if (raw.startsWith("diff --git")) {
      finishFile();
      const m = /^diff --git\s+(\S+)\s+(\S+)/.exec(raw);
      const a = m ? stripGitPrefix(m[1]) : "";
      const b = m ? stripGitPrefix(m[2]) : a;
      cur = {
        path: b || a,
        ...(a && a !== b ? { oldPath: a } : {}),
        status: "modified",
        added: 0,
        removed: 0,
        hunks: [],
      };
      curHunk = null;
      renameFrom = renameTo = undefined;
      sawDevNullOld = sawDevNullNew = false;
      continue;
    }

    if (!cur) {
      // Allow a bare patch with no "diff --git" line (just ---/+++/@@).
      if (raw.startsWith("--- ")) {
        cur = {
          path: "",
          status: "modified",
          added: 0,
          removed: 0,
          hunks: [],
        };
        curHunk = null;
      } else {
        continue;
      }
    }

    if (raw.startsWith("rename from ")) {
      renameFrom = raw.slice("rename from ".length).trim();
      continue;
    }
    if (raw.startsWith("rename to ")) {
      renameTo = raw.slice("rename to ".length).trim();
      continue;
    }

    if (raw.startsWith("--- ")) {
      const p = raw.slice(4).trim();
      if (p === DEV_NULL) sawDevNullOld = true;
      else if (cur && !cur.path) cur.path = stripGitPrefix(p);
      else if (cur && !cur.oldPath && stripGitPrefix(p) !== cur.path) {
        cur.oldPath = stripGitPrefix(p);
      }
      continue;
    }
    if (raw.startsWith("+++ ")) {
      const p = raw.slice(4).trim();
      if (p === DEV_NULL) sawDevNullNew = true;
      else if (cur && (!cur.path || sawDevNullOld))
        cur.path = stripGitPrefix(p);
      continue;
    }

    if (raw.startsWith("@@")) {
      const hdr = parseHunkHeader(raw);
      if (!hdr || !cur) continue;
      curHunk = { header: raw, lines: [] };
      cur.hunks.push(curHunk);
      oldNo = hdr.oldStart;
      newNo = hdr.newStart;
      continue;
    }

    if (!curHunk || !cur) continue;

    // "\ No newline at end of file" — metadata, not a content line.
    if (raw.startsWith("\\")) continue;

    const marker = raw[0];
    const text = raw.slice(1);
    if (marker === "+") {
      curHunk.lines.push({ kind: "add", newLineNo: newNo, text });
      cur.added += 1;
      newNo += 1;
    } else if (marker === "-") {
      curHunk.lines.push({ kind: "del", oldLineNo: oldNo, text });
      cur.removed += 1;
      oldNo += 1;
    } else if (marker === " ") {
      curHunk.lines.push({
        kind: "context",
        oldLineNo: oldNo,
        newLineNo: newNo,
        text,
      });
      oldNo += 1;
      newNo += 1;
    }
    // Any other leading char (e.g. a stray blank line between hunks) is ignored.
  }

  finishFile();
  return files;
}

/**
 * Convert one hunk into aligned side-by-side rows.
 *
 * Rules (pinned by tests):
 *  - context → same text on both sides.
 *  - a run of deletions immediately followed by additions is paired row-by-row
 *    (del on left, add on right). Whichever side has extra lines gets rows with
 *    only that side populated — no line is ever dropped.
 */
export function toSideBySide(hunk: Hunk): SbsRow[] {
  const rows: SbsRow[] = [];
  const lines = hunk.lines;
  let i = 0;

  const sideOf = (l: DiffLine): SbsSide => ({
    ...(l.kind === "del"
      ? { lineNo: l.oldLineNo }
      : l.kind === "add"
        ? { lineNo: l.newLineNo }
        : { lineNo: l.newLineNo ?? l.oldLineNo }),
    text: l.text,
    kind: l.kind,
  });

  while (i < lines.length) {
    const line = lines[i];

    if (line.kind === "context") {
      const side = sideOf(line);
      rows.push({ left: { ...side }, right: { ...side } });
      i += 1;
      continue;
    }

    // Gather a contiguous run of dels then adds.
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i].kind === "del") dels.push(lines[i++]);
    while (i < lines.length && lines[i].kind === "add") adds.push(lines[i++]);

    const pairs = Math.max(dels.length, adds.length);
    for (let p = 0; p < pairs; p += 1) {
      const d = dels[p];
      const a = adds[p];
      rows.push({
        ...(d ? { left: sideOf(d) } : {}),
        ...(a ? { right: sideOf(a) } : {}),
      });
    }

    // Defensive: if neither branch advanced (shouldn't happen), bail.
    if (dels.length === 0 && adds.length === 0) i += 1;
  }

  return rows;
}

export function fileBadge(file: FileDiff): string {
  return `+${file.added} -${file.removed}`;
}

export function totalBadge(files: FileDiff[]): string {
  const added = files.reduce((s, f) => s + f.added, 0);
  const removed = files.reduce((s, f) => s + f.removed, 0);
  return `+${added} -${removed}`;
}
