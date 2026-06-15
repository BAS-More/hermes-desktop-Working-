import { memo } from "react";
import { ShieldCheck } from "lucide-react";
import { useI18n } from "../../components/useI18n";

interface FactoryToggleProps {
  /** Hidden in remote/SSH mode (govern status is local-only). */
  show: boolean;
  /** Whether the Factory panel is currently open. */
  active: boolean;
  /** Toggle the panel (and, when opening, enable factory mode). */
  onToggle: () => void;
}

/**
 * Toolbar chip that opens the in-chat Factory panel. Rendered next to the model
 * / reasoning pickers via Chat's `toolbarExtras`, sharing the `.chat-meta-chip`
 * style. Opening it also enables the orchestrator closed-loop ("factory mode");
 * the panel itself carries the explicit on/off switch.
 */
export const FactoryToggle = memo(function FactoryToggle({
  show,
  active,
  onToggle,
}: FactoryToggleProps): React.JSX.Element | null {
  const { t } = useI18n();
  if (!show) return null;

  return (
    <button
      className={`chat-meta-chip${active ? " chat-meta-chip--active" : ""}`}
      onClick={onToggle}
      title={active ? t("chat.factory.hide") : t("chat.factory.show")}
      aria-pressed={active}
      type="button"
    >
      <ShieldCheck size={13} />
      <span>{t("chat.factory.chip")}</span>
    </button>
  );
});
