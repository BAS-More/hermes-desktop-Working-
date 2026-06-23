import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DiffView } from "./DiffView";

const PATCH = `diff --git a/src/a.ts b/src/a.ts
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

describe("DiffView", () => {
  it("renders one row per changed file with its badge", () => {
    render(<DiffView patch={PATCH} />);
    const rows = screen.getAllByTestId("diff-file-row");
    expect(rows).toHaveLength(2);
    const badges = screen.getAllByTestId("diff-file-badge").map((b) => b.textContent);
    expect(badges).toContain("+3 -1");
    expect(badges).toContain("+0 -2");
  });

  it("shows the +N -M total badge across all files", () => {
    render(<DiffView patch={PATCH} />);
    expect(screen.getByTestId("diff-total-badge").textContent).toBe("+3 -3");
  });

  it("renders the empty state for a blank patch", () => {
    render(<DiffView patch="" />);
    expect(screen.getByTestId("diff-empty")).toBeTruthy();
  });

  it("selecting a file in the list switches the side-by-side pane", () => {
    render(<DiffView patch={PATCH} />);
    const rows = screen.getAllByTestId("diff-file-row");
    fireEvent.click(rows[1]);
    expect(rows[1].getAttribute("aria-selected")).toBe("true");
    // pane title reflects the second file
    expect(screen.getByTestId("diff-pane").textContent).toContain("src/b.ts");
  });

  it("fires open-external and reveal callbacks with the active path", () => {
    const onOpenExternal = vi.fn();
    const onRevealInFolder = vi.fn();
    render(
      <DiffView
        patch={PATCH}
        onOpenExternal={onOpenExternal}
        onRevealInFolder={onRevealInFolder}
      />,
    );
    fireEvent.click(screen.getByTestId("diff-open-external"));
    fireEvent.click(screen.getByTestId("diff-reveal"));
    expect(onOpenExternal).toHaveBeenCalledWith("src/a.ts");
    expect(onRevealInFolder).toHaveBeenCalledWith("src/a.ts");
  });

  it("hides action buttons when no handlers are provided", () => {
    render(<DiffView patch={PATCH} />);
    expect(screen.queryByTestId("diff-open-external")).toBeNull();
    expect(screen.queryByTestId("diff-reveal")).toBeNull();
  });

  it("renders side-by-side rows with deletions left and additions right", () => {
    render(<DiffView patch={PATCH} />);
    const sbs = screen.getByTestId("diff-sbs");
    // first file: 1 context + (3 add / 1 del paired into 3 rows) = 4 rows
    const rows = sbs.querySelectorAll("tr.diff-sbs-row");
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(sbs.querySelector(".diff-sbs-left.diff-del")?.textContent).toBe(
      "removed 1",
    );
    expect(sbs.querySelector(".diff-sbs-right.diff-add")?.textContent).toBe(
      "added 1",
    );
  });
});
