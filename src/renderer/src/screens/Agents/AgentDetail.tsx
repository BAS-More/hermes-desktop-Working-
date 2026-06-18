import { useState } from "react";
import { Sparkles, Puzzle, Wrench, X } from "../../assets/icons";
import ProfileAvatar from "../../components/common/ProfileAvatar";
import { useI18n } from "../../components/useI18n";
import Soul from "../Soul/Soul";
import Skills from "../Skills/Skills";
import Tools from "../Tools/Tools";

export type AgentDetailTab = "persona" | "skills" | "tools";

interface AgentDetailProps {
  /** Profile/agent name whose persona, skills and tools are being edited. */
  profile: string;
  /** Display colour + avatar for the header (optional). */
  color?: string | null;
  avatar?: string | null;
  /** Tab to open on first mount. Defaults to "persona". */
  initialTab?: AgentDetailTab;
  /** Browse-skills affordance — jumps to the Discover → Skills tab. */
  onBrowseSkills?: () => void;
  onClose: () => void;
}

/**
 * Per-agent configuration panel. Composes the existing, profile-aware Soul
 * (persona), Skills and Tools screens into one tabbed overlay so a single
 * agent's persona, assigned skills and enabled toolsets all live in one
 * place — reachable from both the Agents list and the Office 3D bots.
 *
 * Every child already accepts a `profile` prop and reads/writes that
 * profile's own files (SOUL.md, skills/, config toolsets), so this is a
 * pure composition — no new backend wiring.
 */
function AgentDetail({
  profile,
  color,
  avatar,
  initialTab = "persona",
  onBrowseSkills,
  onClose,
}: AgentDetailProps): React.JSX.Element {
  const { t } = useI18n();
  const [tab, setTab] = useState<AgentDetailTab>(initialTab);

  const tabs: { id: AgentDetailTab; label: string; icon: typeof Sparkles }[] = [
    { id: "persona", label: t("soul.title"), icon: Sparkles },
    { id: "skills", label: t("skills.title"), icon: Puzzle },
    { id: "tools", label: t("tools.title"), icon: Wrench },
  ];

  return (
    <div
      className="agent-detail-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="agent-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("agents.configureFor", { name: profile })}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="agent-detail-header">
          <div className="agent-detail-identity">
            <ProfileAvatar name={profile} color={color} avatar={avatar} size={32} />
            <div>
              <div className="agent-detail-name">{profile}</div>
              <div className="agent-detail-sub">{t("agents.configure")}</div>
            </div>
          </div>
          <button
            type="button"
            className="agent-detail-close"
            onClick={onClose}
            aria-label={t("common.cancel")}
          >
            <X size={16} />
          </button>
        </div>

        <div className="agent-detail-tabs" role="tablist">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={`agent-detail-tab ${tab === id ? "active" : ""}`}
              onClick={() => setTab(id)}
            >
              <Icon size={14} />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="agent-detail-body">
          {tab === "persona" && <Soul profile={profile} />}
          {tab === "skills" && (
            <Skills profile={profile} embedded onBrowse={onBrowseSkills} />
          )}
          {tab === "tools" && (
            <Tools profile={profile} visible showPlatformToolsets onBrowseSkills={onBrowseSkills} />
          )}
        </div>
      </div>
    </div>
  );
}

export default AgentDetail;
