/**
 * Phase 1 contract test — unified-diff model (pure, no IO/React).
 * Encodes tests/specs/diff-model.feature. Written before src/shared/diff-model.ts
 * exists (TDAD red). The file list, +N -M badge, and side-by-side viewer are all
 * pure consumers of these functions.
 */
import { describe, it, expect } from "vitest";
import {
  parseUnifiedDiff,
  toSideBySide,
  fileBadge,
  totalBadge,
  type FileDiff,
} from "@shared/diff-model";

const TWO_FILE = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,4 @@
 line one
+added 1
+added 2
+added 3
-removed 1
diff --git a/src/b.ts b/src/b.ts
--- a/src/b.ts
+++ b/src/b.ts
@@ -1,3 +1,1 @@
 keep
-gone 1
-gone 2
`;

const NEW_FILE = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+hello
+world
`;

const DEL_FILE = `diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
--- a/src/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-bye
-now
`;

const RENAME = `diff --git a/src/old.ts b/src/new.ts
similarity index 90%
rename from src/old.ts
rename to src/new.ts
--- a/src/old.ts
+++ b/src/new.ts
@@ -1,1 +1,1 @@
-old line
+new line
`;

describe("parseUnifiedDiff: counts", () => {
  it("parses a two-file patch with correct add/remove counts", () => {
    const files = parseUnifiedDiff(TWO_FILE);
    expect(files).toHaveLength(2);
    const a = files.find((f) => f.path === "src/a.ts")!;
    const b = files.find((f) => f.path === "src/b.ts")!;
    expect([a.added, a.removed]).toEqual([3, 1]);
    expect([b.added, b.removed]).toEqual([0, 2]);
  });

  it("totals the badge across all files", () => {
    expect(totalBadge(parseUnifiedDiff(TWO_FILE))).toBe("+3 -3");
  });

  it("per-file badge formats +N -M", () => {
    const a = parseUnifiedDiff(TWO_FILE).find((f) => f.path === "src/a.ts")!;
    expect(fileBadge(a)).toBe("+3 -1");
  });
});

describe("parseUnifiedDiff: file status", () => {
  it("detects a new file from /dev/null old path", () => {
    const f = parseUnifiedDiff(NEW_FILE)[0];
    expect(f.path).toBe("src/new.ts");
    expect(f.status).toBe("added");
    expect(f.removed).toBe(0);
  });

  it("detects a deleted file from /dev/null new path", () => {
    const f = parseUnifiedDiff(DEL_FILE)[0];
    expect(f.path).toBe("src/old.ts");
    expect(f.status).toBe("deleted");
    expect(f.added).toBe(0);
  });

  it("keeps both paths on a rename", () => {
    const f = parseUnifiedDiff(RENAME)[0];
    expect(f.path).toBe("src/new.ts");
    expect(f.oldPath).toBe("src/old.ts");
    expect(f.status).toBe("renamed");
  });
});

describe("parseUnifiedDiff: line numbers", () => {
  it("assigns old/new line numbers from the hunk header", () => {
    const f = parseUnifiedDiff(TWO_FILE).find((x) => x.path === "src/a.ts")!;
    const lines = f.hunks[0].lines;
    const ctx = lines.find((l) => l.kind === "context")!;
    expect(ctx.oldLineNo).toBe(1);
    expect(ctx.newLineNo).toBe(1);
    const add = lines.find((l) => l.kind === "add")!;
    expect(add.newLineNo).toBeGreaterThan(0);
    expect(add.oldLineNo).toBeUndefined();
    const del = lines.find((l) => l.kind === "del")!;
    expect(del.oldLineNo).toBeGreaterThan(0);
    expect(del.newLineNo).toBeUndefined();
  });
});

describe("toSideBySide", () => {
  it("pairs one deletion and one addition as a single change row", () => {
    const f = parseUnifiedDiff(`--- a/x
+++ b/x
@@ -1,1 +1,1 @@
-old
+new
`)[0];
    const rows = toSideBySide(f.hunks[0]);
    const change = rows.find((r) => r.left && r.right)!;
    expect(change.left!.text).toBe("old");
    expect(change.right!.text).toBe("new");
    expect(change.left!.kind).toBe("del");
    expect(change.right!.kind).toBe("add");
  });

  it("puts a context line on both sides", () => {
    const f = parseUnifiedDiff(`--- a/x
+++ b/x
@@ -1,1 +1,1 @@
 same
`)[0];
    const rows = toSideBySide(f.hunks[0]);
    expect(rows[0].left!.text).toBe("same");
    expect(rows[0].right!.text).toBe("same");
  });

  it("aligns unequal deletions and additions without dropping lines", () => {
    const f = parseUnifiedDiff(`--- a/x
+++ b/x
@@ -1,3 +1,1 @@
-d1
-d2
-d3
+a1
`)[0];
    const rows = toSideBySide(f.hunks[0]);
    const lefts = rows.map((r) => r.left?.text).filter(Boolean);
    const rights = rows.map((r) => r.right?.text).filter(Boolean);
    expect(lefts).toEqual(["d1", "d2", "d3"]);
    expect(rights).toEqual(["a1"]);
  });
});

describe("parseUnifiedDiff: robustness", () => {
  it("returns [] for an empty patch without throwing", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
    expect(parseUnifiedDiff("   \n  ")).toEqual([]);
  });

  it("handles CRLF and 'No newline at end of file' markers", () => {
    const patch =
      "--- a/x\r\n+++ b/x\r\n@@ -1,1 +1,1 @@\r\n-old\r\n+new\r\n\\ No newline at end of file\r\n";
    const f = parseUnifiedDiff(patch)[0];
    expect(f.added).toBe(1);
    expect(f.removed).toBe(1);
    for (const h of f.hunks) {
      for (const l of h.lines) {
        expect(l.text.includes("\r")).toBe(false);
        expect(l.text.includes("No newline")).toBe(false);
      }
    }
  });

  it("ignores a non-string input safely", () => {
    expect(parseUnifiedDiff(undefined as unknown as string)).toEqual([]);
  });
});
