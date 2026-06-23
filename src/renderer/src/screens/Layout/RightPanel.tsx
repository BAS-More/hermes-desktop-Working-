import React, { useState } from "react";
import type { AgentPanelState } from "../../../../shared/agent-events";
import { diffBadge } from "../../../../shared/agent-events";
import {
  defaultRightPanelState,
  setActiveSection,
  todoProgress,
  type RightPanelSection,
} from "../../../../shared/panel-layout";
import { Check, Circle, Clock, Ban } from "../../assets/icons";

export interface RightPanelProps {
  /** The single source of truth — folded agent event stream. */
  state: AgentPanelState;
  /** Render hidden when false (panel toggle lives in the parent layout). */
  visible?: boolean;
  /** Initial active section. */
  initialSection?: RightPanelSection;
  t?: (key: string) => string;
}

const SECTIONS: RightPanelSection[] = [
  "todo",
  "tasks",
  "plan",
  "diff",
  "review",
  "usage",
];

function statusIcon(status: string): React.JSX.Element {
  if (status === "completed") return <Check className="todo-icon todo-done" aria-hidden />;
  if (status === "in_progress")
    return <Clock className="todo-icon todo-active" aria-hidden />;
  if (status === "cancelled")
    return <Ban className="todo-icon todo-cancelled" aria-hidden />;
  return <Circle className="todo-icon todo-pending" aria-hidden />;
}

/**
 * Phase 3 right side-panel. Tabs over the shared AgentPanelState: an
 * always-visible auto-ticking to-do list plus tasks, plan, diff, review and a
 * usage ring. Pure consumer — it never fetches or parses; it renders state.
 */
export function RightPanel({
  state,
  visible = true,
  initialSection = "todo",
  t = (k) => k,
}: RightPanelProps): React.JSX.Element | null {
  const [panel, setPanel] = useState(() => ({
    ...defaultRightPanelState(),
    activeSection: initialSection,
  }));

  if (!visible) return null;

  const progress = todoProgress(state);
  const active = panel.activeSection;

  return (
    <aside className="right-panel" data-testid="right-panel" aria-label={t("panel.title")}>
      <nav className="right-panel-tabs" role="tablist" aria-label={t("panel.sections")}>
        {SECTIONS.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={s === active}
            className={"right-panel-tab" + (s === active ? " right-panel-tab-active" : "")}
            data-testid={`panel-tab-${s}`}
            onClick={() => setPanel((p) => setActiveSection(p, s))}
          >
            {t(`panel.tab.${s}`)}
          </button>
        ))}
      </nav>

      <div className="right-panel-body" role="tabpanel">
        {active === "todo" && (
          <section className="panel-section panel-todo">
            <header className="panel-todo-header">
              <span data-testid="todo-progress" className="todo-progress">
                {progress.done}/{progress.total}
              </span>
              <div
                className="todo-progress-bar"
                role="progressbar"
                aria-valuenow={progress.pct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="todo-progress-fill"
                  style={{ width: `${progress.pct}%` }}
                />
              </div>
            </header>
            <ul
              className="todo-checklist"
              data-testid="todo-checklist"
              role="list"
              aria-live="polite"
            >
              {state.todo.map((item) => (
                <li
                  key={item.id}
                  data-testid={`todo-item-${item.id}`}
                  className={"todo-item todo-" + item.status}
                  role="listitem"
                  aria-checked={item.status === "completed"}
                >
                  {statusIcon(item.status)}
                  <span className="todo-text">{item.content}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {active === "tasks" && (
          <section className="panel-section" data-testid="panel-tasks">
            {state.tasks.length === 0 ? (
              <p className="panel-empty">{t("panel.noTasks")}</p>
            ) : (
              <ul className="task-list" role="list">
                {state.tasks.map((task) => (
                  <li key={task.id} className={"task-item task-" + task.state}>
                    <span className="task-title">{task.title}</span>
                    <span className="task-progress">{task.progress}%</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {active === "plan" && (
          <section className="panel-section" data-testid="panel-plan">
            {state.plan.steps.length === 0 ? (
              <p className="panel-empty">{t("panel.noPlan")}</p>
            ) : (
              <ol className="plan-steps" role="list">
                {state.plan.steps.map((step, i) => (
                  <li key={i} className="plan-step">
                    {step}
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}

        {active === "diff" && (
          <section className="panel-section" data-testid="panel-diff">
            <div className="panel-diff-badge">{diffBadge(state)}</div>
            <ul className="panel-diff-files" role="list">
              {state.diff.map((d) => (
                <li key={d.path} className="panel-diff-file">
                  <span className="panel-diff-path" title={d.path}>
                    {d.path}
                  </span>
                  <span className="panel-diff-counts">
                    +{d.added} -{d.removed}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {active === "review" && (
          <section className="panel-section" data-testid="panel-review">
            {state.review.length === 0 ? (
              <p className="panel-empty">{t("panel.noReview")}</p>
            ) : (
              <ul className="review-list" role="list">
                {state.review.map((r, i) => (
                  <li key={i} className="review-item">
                    <span className="review-loc">
                      {r.path}:{r.line}
                    </span>
                    <span className="review-comment">{r.comment}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {active === "usage" && (
          <section className="panel-section usage-ring" data-testid="usage-ring">
            <div className="usage-metric">
              <span className="usage-label">{t("panel.context")}</span>
              <span className="usage-value" data-testid="usage-context">
                {state.usage.contextPct}%
              </span>
            </div>
            <div className="usage-metric">
              <span className="usage-label">{t("panel.plan")}</span>
              <span className="usage-value" data-testid="usage-plan">
                {state.usage.planPct}%
              </span>
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}

export default RightPanel;
