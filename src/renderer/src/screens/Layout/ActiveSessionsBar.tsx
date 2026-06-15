import { memo } from "react";
import { Spinner, X } from "../../assets/icons";
import { useI18n } from "../../components/useI18n";
import ProfileAvatar from "../../components/common/ProfileAvatar";
import { defaultColorForName } from "../../../../shared/profileColors";
import type { ChatRun } from "./chatRuns";

export interface ProfileAppearance {
  color?: string | null;
  avatar?: string | null;
}

/**
 * A slim, always-visible strip of the conversations currently open across all
 * profiles/agents. Lets the user jump between several sessions running at once
 * (background sessions / multi-agent) and watch each stream live. Hidden when
 * only a single, idle conversation exists — there's nothing to switch between.
 */
export const ActiveSessionsBar = memo(function ActiveSessionsBar({
  runs,
  activeRunId,
  onSelect,
  onClose,
  getAppearance,
}: {
  runs: ChatRun[];
  activeRunId: string;
  onSelect: (runId: string) => void;
  /** Close (and stop, if running) a conversation tab. */
  onClose: (runId: string) => void;
  /** Resolve a profile's avatar/colour for its chip. */
  getAppearance?: (profile: string) => ProfileAppearance;
}): React.JSX.Element | null {
  const { t } = useI18n();

  const anyLoading = runs.some((r) => r.loading);
  if (runs.length <= 1 && !anyLoading) return null;

  return (
    <div className="active-sessions-bar" role="tablist">
      {runs.map((run) => {
        const active = run.runId === activeRunId;
        const label = run.title || t("sessions.newConversation");
        const appearance = getAppearance?.(run.profile);
        const color = appearance?.color || defaultColorForName(run.profile);
        return (
          <div
            key={run.runId}
            role="tab"
            aria-selected={active}
            className={`active-session-chip ${active ? "active" : ""} ${
              run.loading ? "loading" : ""
            }`}
            onClick={() => onSelect(run.runId)}
            title={`${run.profile} — ${label}`}
          >
            {run.loading ? (
              <span
                className="active-session-chip-avatar"
                style={{ background: color }}
                aria-label={run.profile}
              >
                <Spinner className="active-session-chip-spinner" size={12} />
              </span>
            ) : (
              <ProfileAvatar
                name={run.profile}
                color={appearance?.color}
                avatar={appearance?.avatar}
                size={18}
              />
            )}
            <span className="active-session-chip-title">{label}</span>
            <button
              type="button"
              className="active-session-chip-close"
              title={t("sessions.closeTab")}
              aria-label={t("sessions.closeTab")}
              onClick={(e) => {
                e.stopPropagation();
                onClose(run.runId);
              }}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
});
