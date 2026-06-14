import { useState, useEffect, useCallback, useRef } from "react";
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
    default_max_iterations: number | null;
    default_wallclock_seconds: number | null;
    per_block_retry_cap: number | null;
  };
  orchestration: Record<string, unknown>;
  activity: {
    recent_governance_blocks: Array<Record<string, unknown>>;
    recent_budget_events: Array<Record<string, unknown>>;
    recent_builds: Array<Record<string, unknown>>;
    change_log: Array<Record<string, unknown>>;
  };
}

interface FactoryProps {
  visible?: boolean;
  onNavigateToTask?: (taskId: string) => void;
}

const LEVELS = ["monitor", "warn", "gate", "strict"] as const;
const LEVEL_HELP: Record<string, string> = {
  monitor: "Record only — never blocks",
  warn: "Surface findings to the worker, never blocks",
  gate: "Block critical/high, warn on the rest",
  strict: "Block on ANY finding",
};
type LayoutMode = "control" | "monitor" | "classic";
const LAYOUT_KEY = "hermes.factory.layout";
const REFRESH_MS = 15000;

function Factory({ visible, onNavigateToTask }: FactoryProps = {}): React.JSX.Element {
  const { t } = useI18n();
  const [status, setStatus] = useState<GovernStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newGlob, setNewGlob] = useState("");
  const [toast, setToast] = useState<{ msg: string; undo?: () => void } | null>(null);
  const [confirm, setConfirm] = useState<{ msg: string; onYes: () => void } | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [layout, setLayout] = useState<LayoutMode>(() => {
    try {
      return (localStorage.getItem(LAYOUT_KEY) as LayoutMode) || "control";
    } catch {
      return "control";
    }
  });
  // Activity filters
  const [fDecision, setFDecision] = useState<string>("all");
  const [fCode, setFCode] = useState<string>("all");
  const [fProfile, setFProfile] = useState<string>("all");

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await window.hermesAPI.kanbanGovernStatus();
      if (res.success && res.data) {
        setStatus(res.data as GovernStatus);
      } else if (res.unsupportedMode) {
        setError("Factory governance requires a local Hermes install or SSH tunnel mode.");
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

  // Auto-refresh while visible.
  useEffect(() => {
    if (!visible || !autoRefresh) return;
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [visible, autoRefresh, load]);

  const showToast = useCallback((msg: string, undo?: () => void) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, undo });
    toastTimer.current = setTimeout(() => setToast(null), 8000);
  }, []);

  const apply = useCallback(
    async (
      change: Parameters<typeof window.hermesAPI.kanbanGovernSet>[0],
      opts?: { toast?: string; undo?: () => void },
    ) => {
      setBusy(true);
      try {
        const res = await window.hermesAPI.kanbanGovernSet(change);
        if (!res.success) {
          setError(res.error || "Change failed.");
        } else if (opts?.toast) {
          showToast(opts.toast, opts.undo);
        }
        await load();
      } finally {
        setBusy(false);
      }
    },
    [load, showToast],
  );

  const toggleKill = useCallback(
    async (on: boolean) => {
      setBusy(true);
      try {
        await window.hermesAPI.kanbanGovernKillSwitch(on);
        showToast(on ? "Factory halted." : "Factory resumed.");
        await load();
      } finally {
        setBusy(false);
      }
    },
    [load, showToast],
  );

  const askConfirm = (msg: string, onYes: () => void) => setConfirm({ msg, onYes });

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
          <p style={{ color: "#e06c75" }}>{error}</p>
          <button className="btn btn-secondary btn-sm" onClick={() => void load()}>Retry</button>
        </div>
      </div>
    );
  }

  const g = status!.governance;
  const bud = status!.budget;
  const ks = bud.kill_switch;
  const orch = status!.orchestration ?? {};
  const allBlocks = status!.activity.recent_governance_blocks ?? [];
  const builds = status!.activity.recent_builds ?? [];
  const changeLog = status!.activity.change_log ?? [];

  // ---- filtered activity ----
  const blocks = allBlocks.filter((b) => {
    if (fDecision !== "all" && String(b.decision) !== fDecision) return false;
    const f = ((b.findings as Array<Record<string, unknown>>) || [])[0] || {};
    if (fCode !== "all" && String(f.code) !== fCode) return false;
    if (fProfile !== "all" && String(b.profile ?? "") !== fProfile) return false;
    return true;
  });
  const blocksToday = allBlocks.filter((b) =>
    String(b.ts ?? "").slice(0, 10) === new Date().toISOString().slice(0, 10),
  ).length;
  const hybridCount = g.profiles.filter((p) => p.hybrid).length;

  const setLayoutMode = (m: LayoutMode) => {
    setLayout(m);
    try { localStorage.setItem(LAYOUT_KEY, m); } catch { /* ignore */ }
  };

  // ===== SECTION RENDERERS =====
  const StatusStrip = (
    <div className="factory-strip">
      <div className={"factory-strip-item " + (g.level_uniform ? "" : "mixed")}>
        <span className="factory-strip-label">Oversight</span>
        <span className="factory-strip-value">{g.level_uniform ? g.level : "MIXED"}</span>
      </div>
      <div className="factory-strip-item">
        <span className="factory-strip-label">State</span>
        <span className="factory-strip-value" style={{ color: ks.active ? "#e06c75" : "#98c379" }}>
          {ks.active ? "HALTED" : "Running"}
        </span>
      </div>
      <div className="factory-strip-item">
        <span className="factory-strip-label">Secrets</span>
        <span className="factory-strip-value">{g.secret_scan_patterns} + entropy</span>
      </div>
      <div className="factory-strip-item">
        <span className="factory-strip-label">Hybrid</span>
        <span className="factory-strip-value">{hybridCount}/{g.profiles.length}</span>
      </div>
      <div className="factory-strip-item">
        <span className="factory-strip-label">Blocks today</span>
        <span className="factory-strip-value">{blocksToday}</span>
      </div>
    </div>
  );

  const Governance = (
    <div className="settings-section" key="gov">
      <div className="settings-section-title">GOVERNANCE</div>
      <p className="models-subtitle" style={{ marginTop: -4 }}>
        Governance <b>guides</b> the factory — it warns + logs and lets autonomous builds
        continue. Only a hardcoded secret or “Halt all agents” stops a worker.
      </p>

      <div style={{ marginBottom: 16 }}>
        <label className="factory-field-label">
          Oversight level (applies to all){" "}
          {!g.level_uniform && <span style={{ color: "#e5c07b" }}>· mixed across profiles</span>}
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
          {LEVELS.map((lvl) => (
            <button
              key={lvl}
              className={"btn btn-sm " + (g.level === lvl ? "btn-primary" : "btn-secondary")}
              disabled={busy}
              title={LEVEL_HELP[lvl]}
              onClick={() => {
                const prev = g.level;
                const undo = g.level_uniform && prev !== lvl
                  ? () => void apply({ level: prev as typeof LEVELS[number] }, { toast: `Reverted level → ${prev}` })
                  : undefined;
                const doIt = () => void apply({ level: lvl }, { toast: `Level → ${lvl} (all)`, undo });
                if (lvl === "monitor") askConfirm("Set ALL profiles to 'monitor'? Governance will record but never warn or block.", doIt);
                else doIt();
              }}
            >
              {lvl}
            </button>
          ))}
        </div>
        <p className="models-subtitle" style={{ marginTop: 6 }}>{LEVEL_HELP[g.level] || ""}</p>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label className="factory-field-label">Secret scanning — {g.secret_scan_patterns} patterns + entropy</label>
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <button className="btn btn-sm btn-secondary" disabled={busy}
            onClick={() => void apply({ secretScan: "on" }, { toast: "Secret scanning enabled (all)" })}>
            Enable all
          </button>
          <button className="btn btn-sm btn-secondary" disabled={busy}
            onClick={() => askConfirm(
              "Disable secret scanning on ALL profiles? Hardcoded credentials will no longer be caught.",
              () => void apply({ secretScan: "off" }, { toast: "Secret scanning disabled (all)" }),
            )}>
            Disable all
          </button>
        </div>
      </div>

      {/* Editable per-profile table */}
      <table className="factory-table">
        <thead>
          <tr>
            <th>Profile</th><th>Level</th><th>Secrets</th><th>Hybrid</th><th>Protected</th>
          </tr>
        </thead>
        <tbody>
          {g.profiles.map((p) => (
            <tr key={p.profile}>
              <td>{p.profile}</td>
              <td>
                <select className="factory-select" value={p.level || "warn"} disabled={busy}
                  onChange={(e) => {
                    const v = e.target.value as typeof LEVELS[number];
                    const prev = p.level as typeof LEVELS[number] | null;
                    const undo = prev && prev !== v
                      ? () => void apply({ level: prev, profile: p.profile }, { toast: `Reverted ${p.profile} → ${prev}` })
                      : undefined;
                    const doIt = () => void apply({ level: v, profile: p.profile }, { toast: `${p.profile} level → ${v}`, undo });
                    if (v === "monitor") askConfirm(`Set ${p.profile} to 'monitor' (never blocks)?`, doIt);
                    else doIt();
                  }}>
                  {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </td>
              <td>
                <button className={"factory-toggle " + (p.secret_scan ? "on" : "off")} disabled={busy}
                  onClick={() => {
                    if (p.secret_scan) askConfirm(`Disable secret scanning on ${p.profile}?`,
                      () => void apply({ secretScan: "off", profile: p.profile }, { toast: `${p.profile} secrets off` }));
                    else void apply({ secretScan: "on", profile: p.profile }, { toast: `${p.profile} secrets on` });
                  }}>
                  {p.secret_scan ? "on" : "off"}
                </button>
              </td>
              <td>
                <button className={"factory-toggle " + (p.hybrid ? "on" : "off")} disabled={busy}
                  onClick={() => void apply(
                    { hybrid: p.hybrid ? "off" : "on", profile: p.profile },
                    { toast: `${p.profile} hybrid ${p.hybrid ? "off" : "on"}` },
                  )}>
                  {p.hybrid ? "on" : "off"}
                </button>
              </td>
              <td>{p.protected_paths.length}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Protected paths editor */}
      <div style={{ marginTop: 16 }}>
        <label className="factory-field-label">Protected paths (a write here needs an ACTIVE decision)</label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0" }}>
          {(g.profiles[0]?.protected_paths ?? []).map((glob) => (
            <span key={glob} className="factory-chip">
              {glob}
              <button className="factory-chip-x" disabled={busy} title="Remove"
                onClick={() => askConfirm(`Remove protected path '${glob}'? Writes there will no longer require a decision.`,
                  () => void apply({ removeProtected: glob }, { toast: `Removed ${glob}` }))}>×</button>
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="factory-input" placeholder="e.g. **/*.pem" value={newGlob}
            onChange={(e) => setNewGlob(e.target.value)} />
          <button className="btn btn-sm btn-secondary" disabled={busy || !newGlob.trim()}
            onClick={() => { void apply({ addProtected: newGlob.trim() }, { toast: `Added ${newGlob.trim()}` }); setNewGlob(""); }}>
            Add
          </button>
        </div>
      </div>
    </div>
  );

  const Budget = (
    <div className="settings-section" key="bud">
      <div className="settings-section-title">BUDGET</div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <span style={{ fontWeight: 600 }}>
          State: <span style={{ color: ks.active ? "#e06c75" : "#98c379" }}>{ks.active ? "HALTED" : "Running"}</span>
        </span>
        <button className={"btn btn-sm " + (ks.active ? "btn-secondary" : "btn-danger")} disabled={busy}
          onClick={() => {
            if (ks.active) void toggleKill(false);
            else askConfirm("Halt ALL agents? This stops every spawn across the factory until you resume.",
              () => void toggleKill(true));
          }}>
          {ks.active ? "Resume factory" : "Halt all agents"}
        </button>
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <label className="factory-field-label" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Default max iterations (0 = unlimited)
          <input type="number" min={0} className="factory-input" style={{ width: 120 }}
            defaultValue={bud.default_max_iterations ?? 0} disabled={busy}
            onBlur={(e) => {
              const v = parseInt(e.target.value, 10) || 0;
              if (v !== (bud.default_max_iterations ?? 0))
                void apply({ defaultMaxIterations: v }, { toast: `Default iterations → ${v || "unlimited"}` });
            }} />
        </label>
        <label className="factory-field-label" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Default wall-clock seconds (0 = unlimited)
          <input type="number" min={0} className="factory-input" style={{ width: 140 }}
            defaultValue={bud.default_wallclock_seconds ?? 0} disabled={busy}
            onBlur={(e) => {
              const v = parseInt(e.target.value, 10) || 0;
              if (v !== (bud.default_wallclock_seconds ?? 0))
                void apply({ defaultWallclock: v }, { toast: `Default wall-clock → ${v || "unlimited"}s` });
            }} />
        </label>
      </div>
      <p className="models-subtitle" style={{ marginTop: 8 }}>
        New cards inherit these ceilings; the autonomous self-correct loop is also bounded by a
        per-block retry cap of {bud.per_block_retry_cap ?? "—"}. Unlimited iterations means the
        retry cap is the only backstop.
      </p>
    </div>
  );

  const Orchestration = (
    <div className="settings-section" key="orch">
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
  );

  const Activity = (
    <div className="settings-section" key="act">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="settings-section-title">ACTIVITY — governance blocks</div>
        <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          auto-refresh
        </label>
      </div>
      {/* Filters */}
      <div style={{ display: "flex", gap: 8, margin: "8px 0", flexWrap: "wrap" }}>
        <select className="factory-select" value={fDecision} onChange={(e) => setFDecision(e.target.value)}>
          <option value="all">all decisions</option><option value="block">block</option><option value="warn">warn</option>
        </select>
        <select className="factory-select" value={fCode} onChange={(e) => setFCode(e.target.value)}>
          <option value="all">all codes</option><option value="SEC-SECRETS">SEC-SECRETS</option><option value="GOV-PROTECTED">GOV-PROTECTED</option>
        </select>
        <select className="factory-select" value={fProfile} onChange={(e) => setFProfile(e.target.value)}>
          <option value="all">all profiles</option>
          {g.profiles.map((p) => <option key={p.profile} value={p.profile}>{p.profile}</option>)}
        </select>
      </div>
      {blocks.length === 0 ? (
        <p className="models-subtitle">No governance blocks match.</p>
      ) : (
        <table className="factory-table">
          <thead>
            <tr><th>When</th><th>Decision</th><th>Code</th><th>Profile</th><th>Path / message</th></tr>
          </thead>
          <tbody>
            {blocks.slice(0, 40).map((b, i) => {
              const f = ((b.findings as Array<Record<string, unknown>>) || [])[0] || {};
              const dec = String(b.decision ?? "?");
              const tid = String(b.task_id ?? "");
              return (
                <tr key={i} className={tid && onNavigateToTask ? "factory-row-click" : ""}
                  onClick={() => tid && onNavigateToTask?.(tid)}
                  title={tid ? `Open task ${tid}` : ""}>
                  <td>{String(b.ts ?? "").slice(0, 19)}</td>
                  <td><span style={{ color: dec === "block" ? "#e06c75" : "#e5c07b", fontWeight: 600 }}>{dec}</span></td>
                  <td>{String(f.code ?? "—")}</td>
                  <td>{String(b.profile ?? "—")}</td>
                  <td style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {String(f.message ?? f.path ?? "")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {builds.length > 0 && (
        <>
          <div className="settings-section-title" style={{ marginTop: 16 }}>Recent builds</div>
          <table className="factory-table">
            <thead><tr><th>When</th><th>Task</th><th>Outcome</th><th>Summary</th></tr></thead>
            <tbody>
              {builds.slice(0, 15).map((b, i) => (
                <tr key={i}><td>{String(b.ts ?? "").slice(0, 19)}</td><td>{String(b.task_id ?? b.root ?? "")}</td>
                  <td>{String(b.outcome ?? "")}</td>
                  <td style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{String(b.summary ?? "")}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {changeLog.length > 0 && (
        <>
          <div className="settings-section-title" style={{ marginTop: 16 }}>Settings change log</div>
          <table className="factory-table">
            <thead><tr><th>When</th><th>Action</th><th>Scope</th><th>Key</th><th>New value</th></tr></thead>
            <tbody>
              {changeLog.slice(0, 20).map((c, i) => (
                <tr key={i}><td>{String(c.ts ?? "").slice(0, 19)}</td><td>{String(c.action ?? "")}</td>
                  <td>{String(c.target ?? "")}</td><td>{String(c.key ?? "")}</td><td>{String(c.new ?? "")}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );

  const order: Record<LayoutMode, React.JSX.Element[]> = {
    control: [Governance, Budget, Orchestration, Activity],
    monitor: [Activity, Governance, Budget, Orchestration],
    classic: [Governance, Budget, Orchestration, Activity],
  };

  return (
    <div className="settings-container">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 className="settings-header">{t("navigation.factory")}</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select className="factory-select" value={layout} onChange={(e) => setLayoutMode(e.target.value as LayoutMode)}
            title="Section order">
            <option value="control">Layout: Control-first</option>
            <option value="monitor">Layout: Monitoring-first</option>
            <option value="classic">Layout: Classic</option>
          </select>
          <button className="btn btn-secondary btn-sm" onClick={() => void load()} disabled={busy}>Refresh</button>
        </div>
      </div>
      <p className="models-subtitle" style={{ marginTop: -8 }}>
        Governance, budget, orchestration, and live activity for the autonomous dev factory.
      </p>

      {StatusStrip}
      {order[layout]}

      {/* Confirm dialog */}
      {confirm && (
        <div className="factory-modal-backdrop" onClick={() => setConfirm(null)}>
          <div className="factory-modal" onClick={(e) => e.stopPropagation()}>
            <p>{confirm.msg}</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn btn-sm btn-secondary" onClick={() => setConfirm(null)}>Cancel</button>
              <button className="btn btn-sm btn-danger" onClick={() => { const fn = confirm.onYes; setConfirm(null); fn(); }}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {/* Undo toast */}
      {toast && (
        <div className="factory-toast">
          <span>{toast.msg}</span>
          {toast.undo && (
            <button className="factory-toast-undo" onClick={() => { const fn = toast.undo!; setToast(null); fn(); }}>Undo</button>
          )}
        </div>
      )}

      {error && status && (
        <div className="factory-toast" style={{ borderColor: "#e06c75" }}>
          <span style={{ color: "#e06c75" }}>{error}</span>
        </div>
      )}
    </div>
  );
}

export default Factory;
