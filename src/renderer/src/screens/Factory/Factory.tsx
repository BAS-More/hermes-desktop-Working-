import { useState, useEffect, useCallback } from "react";
import { useI18n } from "../../components/useI18n";

// Mirror of the engine's `hermes kanban govern --json` document.
interface GovernProfileState {
  profile: string;
  level: string | null;
  protected_paths: string[];
  secret_scan: boolean;
  hybrid: boolean;
  governed: boolean;
}
interface GovernStatus {
  schema: number;
  governance: {
    valid_levels: string[];
    default_level: string;
    level: string;
    level_uniform: boolean;
    secret_scan_patterns: number;
    profiles: GovernProfileState[];
  };
  budget: {
    kill_switch: { active: boolean; paths: string[]; present_at: string[] };
    dimensions: string[];
  };
  orchestration: Record<string, unknown>;
  activity: {
    recent_governance_blocks: Array<Record<string, unknown>>;
    recent_budget_events: Array<Record<string, unknown>>;
    recent_builds: Array<Record<string, unknown>>;
  };
}

interface FactoryProps {
  visible?: boolean;
}

const LEVELS = ["monitor", "warn", "gate", "strict"] as const;
const LEVEL_HELP: Record<string, string> = {
  monitor: "Record only — never blocks",
  warn: "Surface findings to the worker, never blocks",
  gate: "Block critical/high, warn on the rest",
  strict: "Block on ANY finding",
};

function Factory({ visible }: FactoryProps = {}): React.JSX.Element {
  const { t } = useI18n();
  const [status, setStatus] = useState<GovernStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newGlob, setNewGlob] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.hermesAPI.kanbanGovernStatus();
      if (res.success && res.data) {
        setStatus(res.data as GovernStatus);
      } else if (res.unsupportedMode) {
        setError(
          "Factory governance requires a local Hermes install or SSH tunnel mode.",
        );
      } else {
        setError(res.error || "Failed to load governance status.");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  const apply = useCallback(
    async (change: Parameters<typeof window.hermesAPI.kanbanGovernSet>[0]) => {
      setBusy(true);
      try {
        const res = await window.hermesAPI.kanbanGovernSet(change);
        if (!res.success) setError(res.error || "Change failed.");
        await load();
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const toggleKill = useCallback(
    async (on: boolean) => {
      setBusy(true);
      try {
        await window.hermesAPI.kanbanGovernKillSwitch(on);
        await load();
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  if (loading && !status) {
    return (
      <div className="settings-container">
        <h1 className="settings-header">{t("navigation.factory")}</h1>
        <div className="loading-spinner" />
      </div>
    );
  }

  if (error && !status) {
    return (
      <div className="settings-container">
        <h1 className="settings-header">{t("navigation.factory")}</h1>
        <div className="settings-section">
          <p style={{ color: "var(--color-danger, #e06c75)" }}>{error}</p>
          <button className="btn btn-secondary btn-sm" onClick={() => void load()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const g = status?.governance;
  const ks = status?.budget.kill_switch;
  const blocks = status?.activity.recent_governance_blocks ?? [];
  const builds = status?.activity.recent_builds ?? [];
  const orch = status?.orchestration ?? {};

  return (
    <div className="settings-container">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h1 className="settings-header">{t("navigation.factory")}</h1>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => void load()}
          disabled={busy}
        >
          Refresh
        </button>
      </div>
      <p className="models-subtitle" style={{ marginTop: -8 }}>
        Governance, budget, orchestration, and live activity for the autonomous
        dev factory.
      </p>

      {/* ---------------- GOVERNANCE ---------------- */}
      <div className="settings-section">
        <div className="settings-section-title">GOVERNANCE</div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontWeight: 600, display: "block", marginBottom: 6 }}>
            Oversight level{" "}
            {g && !g.level_uniform && (
              <span style={{ color: "#e5c07b", fontWeight: 400 }}>
                (mixed across profiles)
              </span>
            )}
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {LEVELS.map((lvl) => (
              <button
                key={lvl}
                className={
                  "btn btn-sm " +
                  (g?.level === lvl ? "btn-primary" : "btn-secondary")
                }
                disabled={busy}
                title={LEVEL_HELP[lvl]}
                onClick={() => void apply({ level: lvl })}
              >
                {lvl}
              </button>
            ))}
          </div>
          <p className="models-subtitle" style={{ marginTop: 6 }}>
            {g ? LEVEL_HELP[g.level] : ""}
          </p>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontWeight: 600 }}>
            Secret scanning — {g?.secret_scan_patterns ?? 0} patterns + entropy
          </label>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button
              className="btn btn-sm btn-secondary"
              disabled={busy}
              onClick={() => void apply({ secretScan: "on" })}
            >
              Enable all
            </button>
            <button
              className="btn btn-sm btn-secondary"
              disabled={busy}
              onClick={() => void apply({ secretScan: "off" })}
            >
              Disable all
            </button>
          </div>
        </div>

        {/* Per-profile table */}
        <table className="factory-table">
          <thead>
            <tr>
              <th>Profile</th>
              <th>Level</th>
              <th>Secrets</th>
              <th>Hybrid</th>
              <th>Protected</th>
            </tr>
          </thead>
          <tbody>
            {(g?.profiles ?? []).map((p) => (
              <tr key={p.profile}>
                <td>{p.profile}</td>
                <td>{p.level ?? "—"}</td>
                <td>{p.secret_scan ? "on" : "off"}</td>
                <td>{p.hybrid ? "on" : "off"}</td>
                <td>{p.protected_paths.length}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Protected paths editor (factory-wide) */}
        <div style={{ marginTop: 16 }}>
          <label style={{ fontWeight: 600, display: "block", marginBottom: 6 }}>
            Protected paths (a write here needs an ACTIVE decision)
          </label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {(g?.profiles?.[0]?.protected_paths ?? []).map((glob) => (
              <span key={glob} className="factory-chip">
                {glob}
                <button
                  className="factory-chip-x"
                  disabled={busy}
                  onClick={() => void apply({ removeProtected: glob })}
                  title="Remove"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="factory-input"
              placeholder="e.g. **/*.pem"
              value={newGlob}
              onChange={(e) => setNewGlob(e.target.value)}
            />
            <button
              className="btn btn-sm btn-secondary"
              disabled={busy || !newGlob.trim()}
              onClick={() => {
                void apply({ addProtected: newGlob.trim() });
                setNewGlob("");
              }}
            >
              Add
            </button>
          </div>
        </div>
      </div>

      {/* ---------------- BUDGET ---------------- */}
      <div className="settings-section">
        <div className="settings-section-title">BUDGET</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontWeight: 600 }}>
            Kill-switch:{" "}
            <span style={{ color: ks?.active ? "#e06c75" : "#98c379" }}>
              {ks?.active ? "ACTIVE — factory halted" : "off"}
            </span>
          </span>
          <button
            className={"btn btn-sm " + (ks?.active ? "btn-secondary" : "btn-danger")}
            disabled={busy}
            onClick={() => void toggleKill(!ks?.active)}
          >
            {ks?.active ? "Resume factory" : "Halt factory"}
          </button>
        </div>
        <p className="models-subtitle" style={{ marginTop: 6 }}>
          Dimensions: {status?.budget.dimensions.join(", ")}. Per-build ceilings
          (wallclock / iterations) are set when a card is created.
        </p>
      </div>

      {/* ---------------- ORCHESTRATION ---------------- */}
      <div className="settings-section">
        <div className="settings-section-title">ORCHESTRATION</div>
        <table className="factory-table">
          <tbody>
            {Object.entries(orch).map(([k, v]) => (
              <tr key={k}>
                <td style={{ fontWeight: 600 }}>{k}</td>
                <td>{v === null || v === undefined ? "—" : String(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---------------- ACTIVITY ---------------- */}
      <div className="settings-section">
        <div className="settings-section-title">
          ACTIVITY — recent governance blocks
        </div>
        {blocks.length === 0 ? (
          <p className="models-subtitle">No governance blocks recorded yet.</p>
        ) : (
          <table className="factory-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Decision</th>
                <th>Code</th>
                <th>Path</th>
              </tr>
            </thead>
            <tbody>
              {blocks.slice(0, 30).map((b, i) => {
                const findings = (b.findings as Array<Record<string, unknown>>) || [];
                const f = findings[0] || {};
                const dec = String(b.decision ?? "?");
                return (
                  <tr key={i}>
                    <td>{String(b.ts ?? "").slice(0, 19)}</td>
                    <td>
                      <span
                        style={{
                          color: dec === "block" ? "#e06c75" : "#e5c07b",
                          fontWeight: 600,
                        }}
                      >
                        {dec}
                      </span>
                    </td>
                    <td>{String(f.code ?? "—")}</td>
                    <td
                      style={{
                        maxWidth: 320,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {String(f.path ?? "")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {builds.length > 0 && (
          <>
            <div className="settings-section-title" style={{ marginTop: 16 }}>
              Recent builds
            </div>
            <table className="factory-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Task</th>
                  <th>Outcome</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                {builds.slice(0, 15).map((b, i) => (
                  <tr key={i}>
                    <td>{String(b.ts ?? "").slice(0, 19)}</td>
                    <td>{String(b.task_id ?? b.root ?? "")}</td>
                    <td>{String(b.outcome ?? "")}</td>
                    <td
                      style={{
                        maxWidth: 360,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {String(b.summary ?? "")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

export default Factory;
