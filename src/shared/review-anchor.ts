/**
 * Phase 2 — comment anchoring (pure, no IO/React).
 *
 * Inline review comments are pinned to a line by its CONTENT hash, not just its
 * line number, so a comment survives the agent editing the file: when a new
 * diff arrives, `reanchor` relocates each comment to wherever its line moved,
 * or marks it orphaned (never dropped) if the line is gone.
 *
 * The Review-code self-review flow emits `review.update` events (see
 * @shared/agent-events) which the panel folds; those become CommentAnchors in
 * the UI via this model.
 *
 * Contract pinned by tests/review-anchor.test.ts + tests/specs/review-anchor.feature.
 */
import type { FileDiff } from "./diff-model";

export type DiffSide = "old" | "new";

export interface CommentAnchor {
  id: string;
  path: string;
  side: DiffSide;
  lineNo: number;
  /** djb2 hash of the trimmed line text captured at anchor time. */
  lineTextHash: number;
  comment: string;
  resolved: boolean;
  /** Set when re-anchoring can no longer find the original line. */
  orphaned?: boolean;
}

/** Small stable string hash (djb2, xor variant), trimmed, unsigned 32-bit. */
export function djb2(text: string): number {
  let h = 5381;
  const s = text.trim();
  for (let i = 0; i < s.length; i += 1) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return h >>> 0;
}

/** Map of lineNo -> trimmed-text-hash for one side of a file diff. */
function sideLineHashes(file: FileDiff, side: DiffSide): Map<number, number> {
  const map = new Map<number, number>();
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      const lineNo = side === "new" ? line.newLineNo : line.oldLineNo;
      if (lineNo === undefined) continue;
      // Only lines that exist on the requested side.
      const onSide =
        line.kind === "context" ||
        (side === "new" && line.kind === "add") ||
        (side === "old" && line.kind === "del");
      if (!onSide) continue;
      map.set(lineNo, djb2(line.text));
    }
  }
  return map;
}

/** Look up the trimmed text at a given line on a side (for anchor creation). */
function lineHashAt(
  file: FileDiff,
  side: DiffSide,
  lineNo: number,
): number | undefined {
  return sideLineHashes(file, side).get(lineNo);
}

/**
 * Create a comment anchor, capturing the content hash of the target line so it
 * can be relocated later. If the line isn't found, the hash is 0 (the anchor
 * will orphan on the first reanchor against a file lacking that line).
 */
export function anchorComment(
  file: FileDiff,
  side: DiffSide,
  lineNo: number,
  comment: string,
  id: string,
  resolved = false,
): CommentAnchor {
  return {
    id,
    path: file.path,
    side,
    lineNo,
    lineTextHash: lineHashAt(file, side, lineNo) ?? 0,
    comment,
    resolved,
    orphaned: false,
  };
}

/**
 * Relocate anchors against a fresh diff of the same file. For each anchor:
 *  - find all lines on its side whose content hash matches;
 *  - if any, move it to the one NEAREST its previous lineNo (tiebreak);
 *  - if none, mark it orphaned but keep it (a comment is never dropped).
 * Anchors for a different path are returned unchanged.
 */
export function reanchor(
  anchors: readonly CommentAnchor[],
  file: FileDiff,
): CommentAnchor[] {
  const hashes = sideLineHashes(file, "new");
  const oldHashes = sideLineHashes(file, "old");

  return anchors.map((anchor) => {
    if (anchor.path !== file.path && anchor.path !== file.oldPath) {
      return { ...anchor };
    }
    const map = anchor.side === "new" ? hashes : oldHashes;
    const candidates: number[] = [];
    for (const [lineNo, hash] of map) {
      if (hash === anchor.lineTextHash) candidates.push(lineNo);
    }
    if (candidates.length === 0) {
      return { ...anchor, orphaned: true };
    }
    // Nearest line to the previous position (stable tiebreak: lower wins).
    candidates.sort((a, b) => {
      const da = Math.abs(a - anchor.lineNo);
      const db = Math.abs(b - anchor.lineNo);
      return da !== db ? da - db : a - b;
    });
    return { ...anchor, lineNo: candidates[0], orphaned: false };
  });
}

/** All anchors attached to a specific path + side + line. */
export function commentsForLine(
  anchors: readonly CommentAnchor[],
  path: string,
  side: DiffSide,
  lineNo: number,
): CommentAnchor[] {
  return anchors.filter(
    (a) => a.path === path && a.side === side && a.lineNo === lineNo,
  );
}
