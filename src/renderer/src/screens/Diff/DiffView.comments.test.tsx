import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DiffView } from "./DiffView";
import { anchorComment } from "../../../../shared/review-anchor";
import { parseUnifiedDiff } from "../../../../shared/diff-model";

const PATCH = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,4 @@
 line one
+added 1
+added 2
+added 3
-removed 1
`;

const fileA = parseUnifiedDiff(PATCH)[0];

describe("DiffView — inline collaboration (P2)", () => {
  it("shows a Review code button only when onReviewCode is given", () => {
    const { rerender } = render(<DiffView patch={PATCH} />);
    expect(screen.queryByTestId("diff-review-code")).toBeNull();
    const onReviewCode = vi.fn();
    rerender(<DiffView patch={PATCH} onReviewCode={onReviewCode} />);
    fireEvent.click(screen.getByTestId("diff-review-code"));
    expect(onReviewCode).toHaveBeenCalledWith("src/a.ts");
  });

  it("clicking a line opens a comment box and submits the comment", () => {
    const onAddComment = vi.fn();
    render(<DiffView patch={PATCH} onAddComment={onAddComment} />);
    const cells = screen.getAllByTestId("diff-line-right");
    // click the first added line (right side, new line number present)
    fireEvent.click(cells[1]);
    const input = screen.getByTestId("diff-comment-input");
    fireEvent.change(input, { target: { value: "needs a guard" } });
    fireEvent.click(screen.getByTestId("diff-comment-submit"));
    expect(onAddComment).toHaveBeenCalledTimes(1);
    const [path, side, , text] = onAddComment.mock.calls[0];
    expect(path).toBe("src/a.ts");
    expect(side).toBe("new");
    expect(text).toBe("needs a guard");
  });

  it("submit is disabled until the comment has text", () => {
    render(<DiffView patch={PATCH} onAddComment={vi.fn()} />);
    fireEvent.click(screen.getAllByTestId("diff-line-right")[1]);
    const submit = screen.getByTestId(
      "diff-comment-submit",
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("diff-comment-input"), {
      target: { value: "x" },
    });
    expect(submit.disabled).toBe(false);
  });

  it("renders existing comments on their line", () => {
    // anchor a comment on the first added line (new line number 2)
    const anchor = anchorComment(fileA, "new", 2, "off-by-one risk", "c1");
    render(<DiffView patch={PATCH} comments={[anchor]} />);
    const rendered = screen.getAllByTestId("diff-comment");
    expect(
      rendered.some((n) => n.textContent?.includes("off-by-one risk")),
    ).toBe(true);
  });

  it("flags an orphaned comment with a warning marker", () => {
    const anchor = {
      ...anchorComment(fileA, "new", 2, "stale note", "c2"),
      orphaned: true,
    };
    render(<DiffView patch={PATCH} comments={[anchor]} />);
    const rendered = screen.getAllByTestId("diff-comment");
    const orphan = rendered.find((n) => n.textContent?.includes("stale note"));
    expect(orphan?.className).toContain("diff-comment-orphaned");
    expect(orphan?.textContent).toContain("⚠");
  });

  it("does not make lines clickable when onAddComment is absent", () => {
    render(<DiffView patch={PATCH} />);
    fireEvent.click(screen.getAllByTestId("diff-line-right")[1]);
    expect(screen.queryByTestId("diff-comment-input")).toBeNull();
  });
});
