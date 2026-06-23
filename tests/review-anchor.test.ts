/**
 * Phase 2 contract test — comment anchoring (pure). Encodes
 * tests/specs/review-anchor.feature. Imports the not-yet-written
 * src/shared/review-anchor.ts (TDAD red).
 *
 * Uses the P1 diff model to build FileDiffs from real patches so the anchor
 * logic is tested against the actual line-numbering it will see in production.
 */
import { describe, it, expect } from "vitest";
import { parseUnifiedDiff } from "../src/shared/diff-model";
import {
  djb2,
  anchorComment,
  reanchor,
  commentsForLine,
  type CommentAnchor,
} from "../src/shared/review-anchor";

// new side has: line1 "a", line2 "const foo = 1;", line3 "c"
const FILE_FOO = parseUnifiedDiff(`--- a/a.ts
+++ b/a.ts
@@ -1,3 +1,3 @@
 a
-const foo = 0;
+const foo = 1;
 c
`)[0];

describe("djb2", () => {
  it("is stable and trims whitespace", () => {
    expect(djb2("  x  ")).toBe(djb2("x"));
    expect(djb2("a")).not.toBe(djb2("b"));
  });
});

describe("anchorComment", () => {
  it("captures the target line's content hash on the new side", () => {
    const a = anchorComment(FILE_FOO, "new", 2, "looks good", "c1");
    expect(a.lineNo).toBe(2);
    expect(a.lineTextHash).toBe(djb2("const foo = 1;"));
    expect(a.orphaned).toBeFalsy();
    expect(a.path).toBe("a.ts");
    expect(a.side).toBe("new");
  });
});

function fileWith(newLines: string[]): ReturnType<typeof parseUnifiedDiff>[0] {
  // Build a synthetic all-context new-side file at given line numbers.
  const body = newLines.map((l) => ` ${l}`).join("\n");
  const patch = `--- a/a.ts\n+++ b/a.ts\n@@ -1,${newLines.length} +1,${newLines.length} @@\n${body}\n`;
  return parseUnifiedDiff(patch)[0];
}

describe("reanchor", () => {
  it("moves a comment when its line shifts down", () => {
    const start = anchorComment(fileWith(["target line"]), "new", 1, "c", "c1");
    const moved = reanchor(
      [start],
      fileWith(["x", "y", "z", "w", "v", "u", "target line"]),
    );
    expect(moved[0].lineNo).toBe(7);
    expect(moved[0].orphaned).toBeFalsy();
  });

  it("orphans a comment when its line is deleted (never dropped)", () => {
    const start = anchorComment(fileWith(["gone line"]), "new", 1, "c", "c1");
    const out = reanchor([start], fileWith(["something else"]));
    expect(out).toHaveLength(1);
    expect(out[0].orphaned).toBe(true);
  });

  it("resolves identical lines to the nearest line number", () => {
    const start = anchorComment(
      fileWith(["a", "b", "c", "d", "dup"]),
      "new",
      5,
      "c",
      "c1",
    );
    // new file: dup at line 2 and line 6; nearest to 5 is 6
    const out = reanchor(
      [start],
      fileWith(["x", "dup", "y", "z", "w", "dup"]),
    );
    expect(out[0].lineNo).toBe(6);
  });

  it("preserves the resolved flag through re-anchoring", () => {
    const a = anchorComment(fileWith(["kept"]), "new", 1, "c", "c1");
    a.resolved = true;
    const out = reanchor([a], fileWith(["kept"]));
    expect(out[0].resolved).toBe(true);
  });

  it("is idempotent when nothing moved", () => {
    const a = anchorComment(fileWith(["stable"]), "new", 1, "c", "c1");
    const once = reanchor([a], fileWith(["stable"]));
    const twice = reanchor(once, fileWith(["stable"]));
    expect(once[0].lineNo).toBe(1);
    expect(twice[0].lineNo).toBe(1);
  });
});

describe("commentsForLine", () => {
  const anchors: CommentAnchor[] = [
    anchorComment(fileWith(["a", "b", "c"]), "new", 3, "n", "1"),
    { ...anchorComment(fileWith(["a", "b", "c"]), "new", 3, "o", "2"), side: "old" },
    { ...anchorComment(fileWith(["a", "b", "c"]), "new", 3, "p", "3"), path: "b.ts" },
  ];

  it("filters by path, side and line", () => {
    const out = commentsForLine(anchors, "a.ts", "new", 3);
    expect(out).toHaveLength(1);
    expect(out[0].comment).toBe("n");
  });

  it("returns empty for no anchors", () => {
    expect(commentsForLine([], "a.ts", "new", 1)).toEqual([]);
  });
});
