import React, { useState } from "react";
import {
  parseUnifiedDiff,
  toSideBySide,
  fileBadge,
  totalBadge,
  type FileDiff,
} from "../../../../shared/diff-model";
import {
  commentsForLine,
  type CommentAnchor,
  type DiffSide,
} from "../../../../shared/review-anchor";
import { ChevronRight, ExternalLink, FileText, Folder } from "../../assets/icons";

export interface DiffViewProps {
  /** A unified/git diff string. */
  patch: string;
  /** Open a file in the user's external editor (preload: open-file-in-editor). */
  onOpenExternal?: (path: string) => void;
  /** Reveal a file in Finder/Explorer (preload: reveal-in-folder). */
  onRevealInFolder?: (path: string) => void;
  /** Existing inline review comments to render against the active file. */
  comments?: CommentAnchor[];
  /** Called when the user submits a new inline comment on a line. */
  onAddComment?: (path: string, side: DiffSide, lineNo: number, text: string) => void;
  /** Called when the user clicks "Review code" (agent self-review). */
  onReviewCode?: (path: string) => void;
  /** Optional translator; defaults to identity so the component is usable bare. */
  t?: (key: string) => string;
}

const STATUS_LABEL: Record<FileDiff["status"], string> = {
  modified: "diff.status.modified",
  added: "diff.status.added",
  deleted: "diff.status.deleted",
  renamed: "diff.status.renamed",
};

/**
 * Phase 1 diff cockpit v1 — file list + side-by-side viewer + "+N -M" badge.
 * A pure consumer of @shared/diff-model: it owns zero parsing logic.
 */
export function DiffView({
  patch,
  onOpenExternal,
  onRevealInFolder,
  comments = [],
  onAddComment,
  onReviewCode,
  t = (k) => k,
}: DiffViewProps): React.JSX.Element {
  const files = parseUnifiedDiff(patch);
  const [selected, setSelected] = useState(0);
  const [draft, setDraft] = useState<{ side: DiffSide; lineNo: number } | null>(
    null,
  );
  const [draftText, setDraftText] = useState("");

  if (files.length === 0) {
    return (
      <div className="diff-view diff-view-empty" data-testid="diff-empty">
        {t("diff.empty")}
      </div>
    );
  }

  const active = files[Math.min(selected, files.length - 1)];
  const rows = active.hunks.flatMap((h) => toSideBySide(h));

  return (
    <div className="diff-view" data-testid="diff-view">
      <div className="diff-toolbar">
        <span
          className="diff-total-badge"
          data-testid="diff-total-badge"
          aria-label={t("diff.totalChanges")}
        >
          {totalBadge(files)}
        </span>
      </div>

      <div className="diff-body">
        <ul className="diff-file-list" role="listbox" aria-label={t("diff.files")}>
          {files.map((f, i) => (
            <li key={`${f.path}:${i}`}>
              <button
                type="button"
                role="option"
                aria-selected={i === selected}
                className={
                  "diff-file-row" + (i === selected ? " diff-file-row-active" : "")
                }
                data-testid="diff-file-row"
                onClick={() => setSelected(i)}
              >
                <FileText className="diff-file-icon" aria-hidden />
                <span className="diff-file-path" title={f.path}>
                  {f.path}
                </span>
                <span
                  className={"diff-file-status diff-status-" + f.status}
                  data-testid="diff-file-status"
                >
                  {t(STATUS_LABEL[f.status])}
                </span>
                <span className="diff-file-badge" data-testid="diff-file-badge">
                  {fileBadge(f)}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="diff-pane" data-testid="diff-pane">
          <div className="diff-pane-header">
            <ChevronRight className="diff-pane-caret" aria-hidden />
            <span className="diff-pane-title" title={active.path}>
              {active.path}
            </span>
            <div className="diff-pane-actions">
              {onReviewCode && (
                <button
                  type="button"
                  className="diff-action-btn diff-review-btn"
                  data-testid="diff-review-code"
                  onClick={() => onReviewCode(active.path)}
                >
                  {t("diff.reviewCode")}
                </button>
              )}
              {onOpenExternal && (
                <button
                  type="button"
                  className="diff-action-btn"
                  data-testid="diff-open-external"
                  aria-label={t("diff.openInEditor")}
                  onClick={() => onOpenExternal(active.path)}
                >
                  <ExternalLink aria-hidden />
                </button>
              )}
              {onRevealInFolder && (
                <button
                  type="button"
                  className="diff-action-btn"
                  data-testid="diff-reveal"
                  aria-label={t("diff.revealInFolder")}
                  onClick={() => onRevealInFolder(active.path)}
                >
                  <Folder aria-hidden />
                </button>
              )}
            </div>
          </div>

          <table className="diff-sbs" data-testid="diff-sbs">
            <tbody>
              {rows.map((row, idx) => {
                const rightLine = row.right?.lineNo;
                const lineComments =
                  rightLine !== undefined
                    ? commentsForLine(comments, active.path, "new", rightLine)
                    : [];
                const isDrafting =
                  draft?.side === "new" && draft.lineNo === rightLine;
                return (
                  <React.Fragment key={idx}>
                    <tr className="diff-sbs-row">
                      <td
                        className={
                          "diff-sbs-gutter" +
                          (row.left ? " diff-" + row.left.kind : "")
                        }
                      >
                        {row.left?.lineNo ?? ""}
                      </td>
                      <td
                        className={
                          "diff-sbs-cell diff-sbs-left" +
                          (row.left ? " diff-" + row.left.kind : " diff-blank")
                        }
                      >
                        {row.left?.text ?? ""}
                      </td>
                      <td
                        className={
                          "diff-sbs-gutter" +
                          (row.right ? " diff-" + row.right.kind : "")
                        }
                      >
                        {row.right?.lineNo ?? ""}
                      </td>
                      <td
                        className={
                          "diff-sbs-cell diff-sbs-right" +
                          (row.right ? " diff-" + row.right.kind : " diff-blank") +
                          (onAddComment && rightLine !== undefined
                            ? " diff-commentable"
                            : "")
                        }
                        data-testid="diff-line-right"
                        onClick={
                          onAddComment && rightLine !== undefined
                            ? () => {
                                setDraft({ side: "new", lineNo: rightLine });
                                setDraftText("");
                              }
                            : undefined
                        }
                      >
                        {row.right?.text ?? ""}
                      </td>
                    </tr>
                    {lineComments.map((c) => (
                      <tr key={c.id} className="diff-comment-row">
                        <td />
                        <td colSpan={3}>
                          <div
                            className={
                              "diff-comment" + (c.orphaned ? " diff-comment-orphaned" : "")
                            }
                            data-testid="diff-comment"
                          >
                            {c.orphaned ? `⚠ ${c.comment}` : c.comment}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {isDrafting && (
                      <tr className="diff-comment-draft-row">
                        <td />
                        <td colSpan={3}>
                          <div className="diff-comment-draft">
                            <textarea
                              className="diff-comment-input"
                              data-testid="diff-comment-input"
                              value={draftText}
                              autoFocus
                              onChange={(e) => setDraftText(e.target.value)}
                              placeholder={t("diff.commentPlaceholder")}
                            />
                            <button
                              type="button"
                              className="diff-comment-submit"
                              data-testid="diff-comment-submit"
                              disabled={draftText.trim().length === 0}
                              onClick={() => {
                                if (rightLine === undefined) return;
                                onAddComment?.(
                                  active.path,
                                  "new",
                                  rightLine,
                                  draftText.trim(),
                                );
                                setDraft(null);
                                setDraftText("");
                              }}
                            >
                              {t("diff.commentSubmit")}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default DiffView;
