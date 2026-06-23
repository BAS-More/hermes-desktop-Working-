import { useState } from "react";
import {
  parseUnifiedDiff,
  toSideBySide,
  fileBadge,
  totalBadge,
  type FileDiff,
} from "../../../../shared/diff-model";
import { ChevronRight, ExternalLink, FileText, Folder } from "../../assets/icons";

export interface DiffViewProps {
  /** A unified/git diff string. */
  patch: string;
  /** Open a file in the user's external editor (preload: open-file-in-editor). */
  onOpenExternal?: (path: string) => void;
  /** Reveal a file in Finder/Explorer (preload: reveal-in-folder). */
  onRevealInFolder?: (path: string) => void;
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
  t = (k) => k,
}: DiffViewProps): React.JSX.Element {
  const files = parseUnifiedDiff(patch);
  const [selected, setSelected] = useState(0);

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
              {rows.map((row, idx) => (
                <tr key={idx} className="diff-sbs-row">
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
                      (row.right ? " diff-" + row.right.kind : " diff-blank")
                    }
                  >
                    {row.right?.text ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default DiffView;
