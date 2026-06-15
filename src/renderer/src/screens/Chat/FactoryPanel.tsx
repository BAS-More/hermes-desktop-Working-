import { memo, useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import { useI18n } from "../../components/useI18n";
import type { GovernBuild, GovernStatus } from "../Factory/types";

interface FactoryPanelProps {
  status: GovernStatus | null;
  loading: boolean;
  error: string | null;
  unsupported: boolean;
  loopOn: boolean;
  setLoop: (on: boolean) => Promise<void>;
  /** Close the panel (leaves the loop state untouched). */
  onClose: () => void;
  /** Optional: focus a build's task in the Kanban tab. */
  onNavigateToTask?: (taskId: string) => void;
}

const LOOP_STATE_META: Record<string, { label: string; color: string }> = {
  building: { label: "Building", color: "#61afef" },
  verifying: { label: "Verifying", color: "#e5c07b" },
  correcting: { label: "Correcting", color: "#d19a66" },
  done: { label: "Done", color: "#98c379" },
  parked: { label: "Escalated — needs you", color: "#e06c75" },
};

function BuildCard({
  build,
  onNavigateToTask,
}: {
  build: GovernBuild;
  onNavigateToTask?: (taskId: string) => void;
}): React.JSX.Element {
  const meta = LOOP_STATE_META[build.loop_state ?? ""] ?? {
    label: build.loop_state ?? "—",
    color: "#888",
  };
  const parked = build.loop_state === "parked";
  return (
    <div
      className="factory-build-card factory-panel-build"
      style={{
        border: `1px solid ${parked ? "#e06c75" : "#333"}`,
        background: parked ? "rgba(224,108,117,0.06)" : "transparent",
      }}
    >
      <div className="factory-panel-build-head">
        {onNavigateToTask ? (
          <button
            className="factory-linkbtn"
            title="Open this build's task in Kanban"
            onClick={() => onNavigateToTask(build.root_id)}
          >
            {build.title || build.root_id}
          </button>
        ) : (
          <span className="factory-panel-build-title">
            {build.title || build.root_id}
          </span>
        )}
        <span
          className="factory-chip"
          style={{
            background: meta.color + "22",
            color: meta.color,
            whiteSpace: "nowrap",
          }}
        >
          {meta.label}
        </span>
      </div>
      <div className="factory-panel-build-meta">
        <span>
          round{" "}
          <b>
            {build.verify_round}/{build.max_verify_rounds}
          </b>
        </span>
        {build.last_verdict && (
          <span>
            verdict{" "}
            <b
              style={{
                color: build.last_verdict === "PASS" ? "#98c379" : "#e06c75",
              }}
            >
              {build.last_verdict}
            </b>
          </span>
        )}
      </div>
      {parked && build.last_summary && (
        <div className="factory-panel-build-escalation">
          <b>Why escalated:</b> {build.last_summary}
        </div>
      )}
    </div>
  );
}

/**
 * In-chat live view of the dev factory. Pure presentational — Chat owns the
 * single `useFactoryStatus` hook instance and passes its result down, so the
 * toolbar toggle (which enables the loop on open) and this panel share one
 * source of truth (no double polling).
 */
export const FactoryPanel = memo(function FactoryPanel({
  status,
  loading,
  error,
  unsupported,
  loopOn,
  setLoop,
  onClose,
  onNavigateToTask,
}: FactoryPanelProps): React.JSX.Element {
  const { t } = useI18n();
  const [loopBusy, setLoopBusy] = useState(false);

  const builds = status?.builds ?? [];

  async function toggleLoop(): Promise<void> {
    setLoopBusy(true);
    try {
      await setLoop(!loopOn);
    } catch {
      /* error surfaced via hook state */
    } finally {
      setLoopBusy(false);
    }
  }

  return (
    <div className="factory-panel">
      <div className="factory-panel-header">
        <div className="factory-panel-title">
          <ShieldCheck size={14} />
          <span>{t("chat.factory.panelTitle")}</span>
        </div>
        <button
          className="factory-panel-close"
          onClick={onClose}
          title={t("chat.factory.close")}
          aria-label={t("chat.factory.close")}
          type="button"
        >
          <X size={14} />
        </button>
      </div>

      {/* Factory mode switch — explicit control over the orchestrator loop. */}
      <div className="factory-panel-mode">
        <span className="factory-panel-mode-label">
          {t("chat.factory.mode")}
        </span>
        <button
          className={`factory-panel-switch ${loopOn ? "on" : "off"}`}
          onClick={() => void toggleLoop()}
          disabled={loopBusy || unsupported}
          role="switch"
          aria-checked={loopOn}
          type="button"
        >
          <span className="factory-panel-switch-knob" />
          <span className="factory-panel-switch-text">
            {loopOn ? t("chat.factory.on") : t("chat.factory.off")}
          </span>
        </button>
      </div>

      <div className="factory-panel-body">
        {unsupported ? (
          <div className="factory-panel-notice">
            {t("chat.factory.unsupported")}
          </div>
        ) : error ? (
          <div className="factory-panel-error" role="alert">
            {error}
          </div>
        ) : loading && !status ? (
          <div className="factory-panel-notice">
            {t("chat.factory.loading")}
          </div>
        ) : (
          <>
            <div className="factory-panel-section-title">
              {t("chat.factory.builds")}
            </div>
            {builds.length === 0 ? (
              <div className="factory-panel-notice">
                {t("chat.factory.noBuilds")}
              </div>
            ) : (
              <div className="factory-panel-builds">
                {builds.map((b) => (
                  <BuildCard
                    key={b.root_id}
                    build={b}
                    onNavigateToTask={onNavigateToTask}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
});
