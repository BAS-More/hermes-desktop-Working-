import { useState, useEffect, useCallback, useRef } from "react";
import { useI18n } from "../../components/useI18n";

// Mirror of the engine's `hermes kanban govern --json` document.
interface GovernProfileState {
  profile: string;
  level: string | null;
  protected_paths: string[];
  secret_scan: boolean;
  hybrid: boolean;
  model: string | null;
  governed: boolean;
}
interface GovernBuild {
  root_id: string;
  title: string | null;
  task_status: string | null;
  orchestrator: string | null;
  loop_state: string | null;
  verify_round: number;
  max_verify_rounds: number;
  acceptance: string[];
  last_verdict: string | null;
  last_summary: string | null;
  unmet: Array<Record<string, unknown>>;
  updated_at: string | null;
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
  builds?: GovernBuild[];
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
  // Engine-compatible model catalog (cc/ + ag/) for the per-agent picker.
  const [models, setModels] = useState<string[]>([]);

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

  // Fetch the model catalog once when the tab first becomes visible.
  useEffect(() => {
    if (!visible) return;
    void window.hermesAPI.kanbanGovernModels().then((res) => {
      if (res.success && res.data) setModels(res.data.models || []);
    });
  }, [visible]);

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

  // Change a profile's model. "__advanced__" prompts for a custom id; a cx/ id
  // is warned about here (the engine also hard-rejects it).
  const changeModel = useCallback(
    (profile: string, value: string, prev: string | null) => {
      let id = value;
      if (value === "__advanced__") {
        const typed = window.prompt(
          `Custom model id for ${profile} (cc/ or ag/ only — cx/ is rejected: it breaks tool calls):`,
          prev || "",
        );
        if (!typed) return;
        id = typed.trim();
      }
      if (id.toLowerCase().startsWith("cx/")) {
        setError(`'${id}' is a cx/ (OpenAI-shape) id — it breaks the adapter and will be rejected. Use cc/ or ag/.`);
        return;
      }
      const undo = prev && prev !== id
        ? () => void apply({ model: prev, profile }, { toast: `Reverted ${profile} model → ${prev}` })
        : undefined;
      void apply({ model: id, profile }, { toast: `${profile} model → ${id}`, undo });
    },
    [apply],
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
  // Orchestrator closed-loop: live builds + loop config.
  const loopBuilds = status!.builds ?? [];
  const loopOn = orch.orchestrator_loop === true || orch.orchestrator_loop === "true";

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
            <th>Profile</th><th>Level</th><th>Secrets</th><th>Hybrid</th><th>Model</th><th>Protected</th>
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
              <td>
                <select className="factory-select" value={p.model || ""} disabled={busy}
                  onChange={(e) => changeModel(p.profile, e.target.value, p.model)}>
                  {/* current value, even if not in the catalog, stays selectable */}
                  {p.model && !models.includes(p.model) && <option value={p.model}>{p.model}</option>}
                  {models.map((m) => <option key={m} value={m}>{m}</option>)}
                  <option value="__advanced__">＋ custom…</option>
                </select>
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

    const profileNames = g.profiles.map((p) => p.profile);
  const orchProfile = String(orch.orchestrator_profile ?? "");
  const defAssignee = String(orch.default_assignee ?? "");
  const autoDec = orch.auto_decompose === true || orch.auto_decompose === "true";
  const Orchestration = (
    <div className="settings-section" key="orch">
      <div className="settings-section-title">ORCHESTRATION</div>
      <p className="models-subtitle" style={{ marginTop: -4 }}>
        Which agent runs the build, who catches unrouted work, and how aggressively the board fans out.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: "10px 16px", alignItems: "center", maxWidth: 560 }}>
        <label className="factory-field-label">Orchestrator profile</label>
        <select className="factory-select" value={orchProfile} disabled={busy}
          onChange={(e) => void apply({ orchestratorProfile: e.target.value }, { toast: `Orchestrator → ${e.target.value}` })}>
          {!profileNames.includes(orchProfile) && orchProfile && <option value={orchProfile}>{orchProfile}</option>}
          {profileNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>

        <label className="factory-field-label">Default assignee</label>
        <select className="factory-select" value={defAssignee} disabled={busy}
          onChange={(e) => void apply({ defaultAssignee: e.target.value }, { toast: `Default assignee → ${e.target.value}` })}>
          {!profileNames.includes(defAssignee) && defAssignee && <option value={defAssignee}>{defAssignee}</option>}
          {profileNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>

        <label className="factory-field-label">Auto-decompose</label>
        <button className={"factory-toggle " + (autoDec ? "on" : "off")} disabled={busy} style={{ width: "fit-content" }}
          onClick={() => void apply({ autoDecompose: autoDec ? "off" : "on" }, { toast: `Auto-decompose ${autoDec ? "off" : "on"}` })}>
          {autoDec ? "on" : "off"}
        </button>

        <label className="factory-field-label">Auto-decompose per tick</label>
        <input type="number" min={1} className="factory-input" style={{ width: 100 }}
          defaultValue={Number(orch.auto_decompose_per_tick ?? 3)} disabled={busy}
          onBlur={(e) => {
            const v = parseInt(e.target.value, 10);
            if (v && v !== Number(orch.auto_decompose_per_tick))
              void apply({ autoDecomposePerTick: v }, { toast: `Per-tick → ${v}` });
          }} />

        <label className="factory-field-label">Max in-progress / profile</label>
        <input type="number" min={1} className="factory-input" style={{ width: 100 }}
          defaultValue={Number(orch.max_in_progress_per_profile ?? 1)} disabled={busy}
          onBlur={(e) => {
            const v = parseInt(e.target.value, 10);
            if (v && v !== Number(orch.max_in_progress_per_profile))
              void apply({ maxInProgress: v }, { toast: `Max in-progress → ${v}` });
          }} />

        <label className="factory-field-label" style={{ gridColumn: "1 / -1", borderTop: "1px solid #333", paddingTop: 10, marginTop: 4, fontWeight: 700 }}>
          Closed-loop oversight
        </label>
        <label className="factory-field-label">Orchestrator loop</label>
        <button className={"factory-toggle " + (loopOn ? "on" : "off")} disabled={busy} style={{ width: "fit-content" }}
          onClick={() => {
            if (loopOn) {
              void apply({ orchestratorLoop: "off" }, { toast: "Closed-loop OFF" });
            } else {
              askConfirm(
                "Enable the orchestrator closed-loop? When ON, a finished build is VERIFIED against its acceptance criteria; if it falls short the orchestrator commands corrective work and re-verifies (up to the round cap) before escalating to you. This changes how builds complete. In-flight builds are unaffected.",
                () => void apply({ orchestratorLoop: "on" }, { toast: "Closed-loop ON" }),
              );
            }
          }}>
          {loopOn ? "on" : "off"}
        </button>

        <label className="factory-field-label">Max verify rounds</label>
        <input type="number" min={1} max={10} className="factory-input" style={{ width: 100 }}
          defaultValue={Number(orch.max_verify_rounds ?? 3)} disabled={busy}
          onBlur={(e) => {
            const v = parseInt(e.target.value, 10);
            if (v && v !== Number(orch.max_verify_rounds ?? 3))
              void apply({ maxVerifyRounds: v }, { toast: `Max verify rounds → ${v}` });
          }} />
      </div>
      {/* Read-only lower-level knobs */}
      <table className="factory-table" style={{ marginTop: 12 }}>
        <tbody>
          {["failure_limit", "dispatch_in_gateway"].map((k) => (
            <tr key={k}>
              <td style={{ fontWeight: 600 }}>{k}</td>
              <td>{orch[k] === null || orch[k] === undefined ? "—" : String(orch[k])}</td>
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

  // ---- BUILDS: the orchestrator closed-loop oversight pane ----
  const loopStateMeta: Record<string, { label: string; color: string }> = {
    building: { label: "Building", color: "#61afef" },
    verifying: { label: "Verifying", color: "#e5c07b" },
    correcting: { label: "Correcting", color: "#d19a66" },
    done: { label: "Done", color: "#98c379" },
    parked: { label: "Escalated — needs you", color: "#e06c75" },
  };
  const Builds = (
    <div className="settings-section" key="builds">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="settings-section-title">BUILDS — orchestrator oversight</div>
        <span className={"factory-chip"} style={{ background: loopOn ? "#2c4a2c" : "#3a3a3a", color: loopOn ? "#98c379" : "#999" }}>
          closed-loop {loopOn ? "ON" : "OFF"}
        </span>
      </div>
      <p className="models-subtitle" style={{ marginTop: -2 }}>
        Each build the orchestrator is overseeing — its goal, the acceptance criteria it must meet,
        and where it is in the verify → correct → done loop.
      </p>
      {!loopOn && (
        <div className="factory-callout" style={{ margin: "8px 0", padding: "8px 12px", border: "1px solid #444", borderRadius: 6, fontSize: 12, color: "#aaa" }}>
          The closed-loop is off — builds fan out once and assemble without verification. Turn it on in
          <b> Orchestration → Closed-loop oversight</b> to have the orchestrator verify each build against its
          acceptance criteria and command corrections.
        </div>
      )}
      {loopBuilds.length === 0 ? (
        <div style={{ fontSize: 13, color: "#888", padding: "8px 0" }}>No tracked builds yet.</div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {loopBuilds.map((b) => {
            const meta = loopStateMeta[b.loop_state ?? ""] ?? { label: b.loop_state ?? "—", color: "#888" };
            const parked = b.loop_state === "parked";
            return (
              <div key={b.root_id} className="factory-build-card"
                style={{ border: `1px solid ${parked ? "#e06c75" : "#333"}`, borderRadius: 8, padding: "10px 12px",
                  background: parked ? "rgba(224,108,117,0.06)" : "transparent" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <button className="factory-linkbtn"
                    style={{ fontWeight: 600, fontSize: 13, textAlign: "left", background: "none", border: "none", color: "#61afef", cursor: "pointer", padding: 0 }}
                    title="Open this build's task in Kanban"
                    onClick={() => onNavigateToTask?.(b.root_id)}>
                    {b.title || b.root_id}
                  </button>
                  <span className="factory-chip" style={{ background: meta.color + "22", color: meta.color, whiteSpace: "nowrap" }}>
                    {meta.label}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 14, fontSize: 12, color: "#aaa", margin: "6px 0" }}>
                  <span>orchestrator: <b>{b.orchestrator || "—"}</b></span>
                  <span>verify round: <b>{b.verify_round}/{b.max_verify_rounds}</b></span>
                  {b.last_verdict && <span>last verdict: <b style={{ color: b.last_verdict === "PASS" ? "#98c379" : "#e06c75" }}>{b.last_verdict}</b></span>}
                </div>
                {b.acceptance.length > 0 && (
                  <details style={{ fontSize: 12, marginTop: 4 }}>
                    <summary style={{ cursor: "pointer", color: "#ccc" }}>Acceptance criteria ({b.acceptance.length})</summary>
                    <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "#bbb" }}>
                      {b.acceptance.map((c, i) => <li key={i}>{c}</li>)}
                    </ul>
                  </details>
                )}
                {parked && b.last_summary && (
                  <div style={{ fontSize: 12, color: "#e06c75", marginTop: 6 }}>
                    <b>Why escalated:</b> {b.last_summary}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const order: Record<LayoutMode, React.JSX.Element[]> = {
    control: [Governance, Builds, Budget, Orchestration, Activity],
    monitor: [Builds, Activity, Governance, Budget, Orchestration],
    classic: [Governance, Budget, Orchestration, Builds, Activity],
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
