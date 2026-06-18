import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import {
  Plus,
  Trash,
  Pencil,
  X,
  Check,
  Crown,
  AdvisorIcon,
  Gauge,
  ThumbsUp,
  ThumbsDown,
  Sparkles,
} from "../../assets/icons";
import { useI18n } from "../../components/useI18n";
import type {
  CouncilConfig,
  CouncilModelAdvice,
  CouncilAdviceResult,
} from "../../../../shared/council";

interface CouncilTabProps {
  visible?: boolean;
  profile?: string;
}

const TASK_KINDS = [
  "architecture",
  "coding",
  "security",
  "uiux",
  "quick-check",
  "research",
  "general",
] as const;

function tierClass(tier: string): string {
  return `council-tier council-tier-${tier}`;
}

export function CouncilTab({ visible, profile }: CouncilTabProps): React.JSX.Element {
  const { t } = useI18n();
  const [cfg, setCfg] = useState<CouncilConfig | null>(null);
  const [pool, setPool] = useState<CouncilModelAdvice[]>([]);

  // Add-member form
  const [showAddMember, setShowAddMember] = useState(false);
  const [newModel, setNewModel] = useState("");

  // Position editor modal
  const [editingPos, setEditingPos] = useState<{ id?: string; title: string; description: string } | null>(null);

  // Advisor
  const [advisorTask, setAdvisorTask] = useState<string>("general");
  const [advisorPreferFree, setAdvisorPreferFree] = useState(true);
  const [advice, setAdvice] = useState<CouncilAdviceResult[]>([]);

  const load = useCallback(async () => {
    const [config, modelPool] = await Promise.all([
      window.hermesAPI.councilGetConfig(profile),
      window.hermesAPI.councilModelAdvice(),
    ]);
    setCfg(config);
    setPool(modelPool);
  }, [profile]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  const runAdvisor = useCallback(async () => {
    const results = await window.hermesAPI.councilRecommendModels(
      advisorTask,
      advisorPreferFree,
    );
    setAdvice(results);
  }, [advisorTask, advisorPreferFree]);

  if (!cfg) {
    return <div className="council-loading">{t("council.loading")}</div>;
  }

  // ---- Members ----
  async function handleAddMember(): Promise<void> {
    const model = newModel.trim();
    if (!model) return;
    const known = pool.find((p) => p.model === model || p.label === model);
    const next = await window.hermesAPI.councilAddMember(
      { model, label: known?.label || model, free: known?.free ?? false },
      profile,
    );
    setCfg(next);
    setNewModel("");
    setShowAddMember(false);
    toast.success(t("council.memberAdded", { model: known?.label || model }));
  }

  async function handleRemoveMember(id: string): Promise<void> {
    setCfg(await window.hermesAPI.councilRemoveMember(id, profile));
  }

  async function handleAssign(memberId: string, positionId: string): Promise<void> {
    setCfg(
      await window.hermesAPI.councilAssignPosition(
        memberId,
        positionId || null,
        profile,
      ),
    );
  }

  async function handleSetChairman(model: string): Promise<void> {
    setCfg(await window.hermesAPI.councilSetChairman(model, profile));
  }

  // ---- Positions ----
  async function handleSavePosition(): Promise<void> {
    if (!editingPos || !editingPos.title.trim()) return;
    setCfg(
      await window.hermesAPI.councilUpsertPosition(
        {
          id: editingPos.id,
          title: editingPos.title.trim(),
          description: editingPos.description.trim(),
        },
        profile,
      ),
    );
    setEditingPos(null);
    toast.success(t("council.positionSaved"));
  }

  async function handleDeletePosition(id: string): Promise<void> {
    setCfg(await window.hermesAPI.councilDeletePosition(id, profile));
  }

  async function handleFeedback(id: string, vote: "up" | "down"): Promise<void> {
    setCfg(await window.hermesAPI.councilPositionFeedback(id, vote, profile));
  }

  async function handleResolveProposed(id: string, accept: boolean): Promise<void> {
    setCfg(await window.hermesAPI.councilResolveDescription(id, accept, profile));
  }

  async function handleReset(): Promise<void> {
    setCfg(await window.hermesAPI.councilResetConfig(profile));
    toast.success(t("council.resetDone"));
  }

  const freeCount = cfg.members.filter((m) => m.free).length;
  const paidCount = cfg.members.length - freeCount;

  return (
    <div className="council-tab">
      {/* Intro + cost honesty */}
      <div className="settings-field-hint council-intro">
        {t("council.intro")}
        <span className="council-cost-chip">
          {t("council.costChip", { free: freeCount, paid: paidCount })}
        </span>
      </div>

      {/* ── Chairman ── */}
      <div className="council-section">
        <div className="council-section-head">
          <Crown size={16} />
          <h3>{t("council.chairmanTitle")}</h3>
        </div>
        <div className="settings-field-hint">{t("council.chairmanHint")}</div>
        <select
          className="input council-chairman-select"
          value={cfg.chairman}
          onChange={(e) => void handleSetChairman(e.target.value)}
        >
          <option value="opus-4.8">
            {t("council.chairmanDefault")}
          </option>
          {pool.map((m) => (
            <option key={m.model} value={m.model}>
              {m.label} {m.free ? "(free)" : "(paid)"}
            </option>
          ))}
        </select>
      </div>

      {/* ── Panel members ── */}
      <div className="council-section">
        <div className="council-section-head">
          <h3>{t("council.membersTitle")}</h3>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setShowAddMember((v) => !v)}
          >
            <Plus size={14} /> {t("council.addMember")}
          </button>
        </div>

        {showAddMember && (
          <div className="council-add-member">
            <input
              className="input"
              list="council-model-pool"
              value={newModel}
              onChange={(e) => setNewModel(e.target.value)}
              placeholder={t("council.modelPlaceholder")}
              autoFocus
            />
            <datalist id="council-model-pool">
              {pool.map((m) => (
                <option key={m.model} value={m.model}>
                  {m.label} {m.free ? "(free)" : "(paid)"}
                </option>
              ))}
            </datalist>
            <button className="btn btn-primary btn-sm" onClick={() => void handleAddMember()}>
              <Check size={14} /> {t("common.add")}
            </button>
          </div>
        )}

        {cfg.members.length === 0 ? (
          <div className="council-empty">{t("council.noMembers")}</div>
        ) : (
          <div className="council-members-grid">
            {cfg.members.map((m) => (
              <div key={m.id} className="council-member-card">
                <div className="council-member-head">
                  <span className="council-member-name">{m.label}</span>
                  <span className={`council-badge ${m.free ? "council-badge-free" : "council-badge-paid"}`}>
                    {m.free ? t("council.free") : t("council.paid")}
                  </span>
                  <button
                    className="btn btn-ghost btn-sm council-member-remove"
                    onClick={() => void handleRemoveMember(m.id)}
                    title={t("common.remove")}
                    aria-label={t("common.remove")}
                  >
                    <Trash size={13} />
                  </button>
                </div>
                <label className="council-member-pos-label">
                  {t("council.position")}
                </label>
                <select
                  className="input council-member-pos-select"
                  value={m.positionId || ""}
                  onChange={(e) => void handleAssign(m.id, e.target.value)}
                >
                  <option value="">{t("council.unassigned")}</option>
                  {cfg.positions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Positions (with self-learning descriptions) ── */}
      <div className="council-section">
        <div className="council-section-head">
          <h3>{t("council.positionsTitle")}</h3>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setEditingPos({ title: "", description: "" })}
          >
            <Plus size={14} /> {t("council.addPosition")}
          </button>
        </div>
        <div className="settings-field-hint">{t("council.positionsHint")}</div>

        <div className="council-positions-list">
          {cfg.positions.map((p) => (
            <div key={p.id} className="council-position-card">
              <div className="council-position-head">
                <span className="council-position-title">{p.title}</span>
                {p.builtin && (
                  <span className="council-badge council-badge-builtin">
                    {t("council.builtin")}
                  </span>
                )}
                <div className="council-position-actions">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      setEditingPos({
                        id: p.id,
                        title: p.title,
                        description: p.description,
                      })
                    }
                    title={t("common.edit")}
                  >
                    <Pencil size={13} />
                  </button>
                  {!p.builtin && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => void handleDeletePosition(p.id)}
                      title={t("common.delete")}
                    >
                      <Trash size={13} />
                    </button>
                  )}
                </div>
              </div>
              <div className="council-position-desc">{p.description}</div>

              {/* Self-learning feedback row */}
              <div className="council-position-learn">
                <button
                  className="council-vote"
                  onClick={() => void handleFeedback(p.id, "up")}
                  title={t("council.voteUp")}
                >
                  <ThumbsUp size={13} /> {p.upvotes}
                </button>
                <button
                  className="council-vote"
                  onClick={() => void handleFeedback(p.id, "down")}
                  title={t("council.voteDown")}
                >
                  <ThumbsDown size={13} /> {p.downvotes}
                </button>
                <span className="council-learn-hint">{t("council.learnHint")}</span>
              </div>

              {/* Agent-proposed refinement awaiting accept/reject */}
              {p.proposedDescription && (
                <div className="council-proposed">
                  <div className="council-proposed-label">
                    <Sparkles size={13} /> {t("council.proposedLabel")}
                  </div>
                  <div className="council-proposed-text">{p.proposedDescription}</div>
                  <div className="council-proposed-actions">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => void handleResolveProposed(p.id, true)}
                    >
                      <Check size={13} /> {t("council.accept")}
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => void handleResolveProposed(p.id, false)}
                    >
                      <X size={13} /> {t("council.reject")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Advisor (item 2e) ── */}
      <div className="council-section">
        <div className="council-section-head">
          <AdvisorIcon size={16} />
          <h3>{t("council.advisorTitle")}</h3>
        </div>
        <div className="settings-field-hint">{t("council.advisorHint")}</div>

        <div className="council-advisor-controls">
          <select
            className="input"
            value={advisorTask}
            onChange={(e) => setAdvisorTask(e.target.value)}
          >
            {TASK_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`council.task.${k}`)}
              </option>
            ))}
          </select>
          <label className="council-advisor-free">
            <input
              type="checkbox"
              checked={advisorPreferFree}
              onChange={(e) => setAdvisorPreferFree(e.target.checked)}
            />
            {t("council.preferFree")}
          </label>
          <button className="btn btn-primary btn-sm" onClick={() => void runAdvisor()}>
            <Sparkles size={14} /> {t("council.recommend")}
          </button>
        </div>

        {advice.length > 0 && (
          <div className="council-advice-list">
            {advice.slice(0, 6).map((a, i) => (
              <div key={a.model} className={`council-advice-card ${i === 0 ? "council-advice-top" : ""}`}>
                <div className="council-advice-head">
                  {i === 0 && <span className="council-advice-best">{t("council.bestPick")}</span>}
                  <span className="council-advice-name">{a.label}</span>
                  <span className={`council-badge ${a.free ? "council-badge-free" : "council-badge-paid"}`}>
                    {a.free ? t("council.free") : t("council.paid")}
                  </span>
                </div>
                <div className="council-advice-tiers">
                  <span className={tierClass(a.accuracy)} title={t("council.accuracyTier")}>
                    {t("council.accuracy")}: {t(`council.tier.${a.accuracy}`)}
                  </span>
                  <span className="council-speed" title={t("council.speedTier")}>
                    <Gauge size={12} /> {t(`council.speed.${a.speed}`)}
                  </span>
                  <span className="council-ctx">
                    {a.contextK >= 1000 ? `${a.contextK / 1000}M` : `${a.contextK}K`}
                  </span>
                </div>
                <div className="council-advice-reason">{a.strength}</div>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() =>
                    void window.hermesAPI
                      .councilAddMember(
                        { model: a.model, label: a.label, free: a.free },
                        profile,
                      )
                      .then(setCfg)
                  }
                >
                  <Plus size={13} /> {t("council.addToCouncil")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <button className="btn btn-ghost btn-sm council-reset" onClick={() => void handleReset()}>
        {t("council.resetAll")}
      </button>

      {/* ── Position editor modal ── */}
      {editingPos && (
        <div className="models-modal-overlay" onClick={() => setEditingPos(null)}>
          <div className="models-modal" onClick={(e) => e.stopPropagation()}>
            <div className="models-modal-header">
              <h2 className="models-modal-title">
                {editingPos.id ? t("council.editPosition") : t("council.addPosition")}
              </h2>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setEditingPos(null)}
                aria-label={t("common.close")}
              >
                <X size={18} />
              </button>
            </div>
            <div className="models-modal-body">
              <div className="models-modal-field">
                <label className="models-modal-label">{t("council.positionName")}</label>
                <input
                  className="input"
                  value={editingPos.title}
                  onChange={(e) => setEditingPos({ ...editingPos, title: e.target.value })}
                  placeholder={t("council.positionNamePlaceholder")}
                  autoFocus
                />
              </div>
              <div className="models-modal-field">
                <label className="models-modal-label">{t("council.positionDesc")}</label>
                <textarea
                  className="input council-desc-textarea"
                  value={editingPos.description}
                  onChange={(e) => setEditingPos({ ...editingPos, description: e.target.value })}
                  placeholder={t("council.positionDescPlaceholder")}
                  rows={6}
                />
                <div className="settings-field-hint">{t("council.positionDescHint")}</div>
              </div>
            </div>
            <div className="models-modal-footer">
              <button className="btn btn-secondary" onClick={() => setEditingPos(null)}>
                {t("common.cancel")}
              </button>
              <button className="btn btn-primary" onClick={() => void handleSavePosition()}>
                {t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
