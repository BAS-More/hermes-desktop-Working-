/**
 * Phase 3 — pure right-panel layout state + todo-progress selector.
 *
 * The right side-panel and its always-visible to-do list are pure consumers of
 * AgentPanelState (@shared/agent-events). This module owns only the panel's own
 * UI state (which section is active, what's collapsed, is it visible) plus a
 * selector that derives todo progress for the always-visible header.
 *
 * Contract pinned by tests/panel-layout.test.ts + tests/specs/right-panel.feature.
 */
import type { AgentPanelState } from "./agent-events";

export type RightPanelSection =
  | "todo"
  | "tasks"
  | "plan"
  | "diff"
  | "review"
  | "usage";

export interface RightPanelState {
  visible: boolean;
  activeSection: RightPanelSection;
  collapsedSections: RightPanelSection[];
}

export function defaultRightPanelState(): RightPanelState {
  return { visible: true, activeSection: "todo", collapsedSections: [] };
}

export function togglePanel(state: RightPanelState): RightPanelState {
  return { ...state, visible: !state.visible };
}

export function setActiveSection(
  state: RightPanelState,
  section: RightPanelSection,
): RightPanelState {
  return { ...state, activeSection: section };
}

export function toggleSection(
  state: RightPanelState,
  section: RightPanelSection,
): RightPanelState {
  const collapsed = state.collapsedSections.includes(section);
  return {
    ...state,
    collapsedSections: collapsed
      ? state.collapsedSections.filter((s) => s !== section)
      : [...state.collapsedSections, section],
  };
}

export interface TodoProgress {
  done: number;
  total: number;
  pct: number;
}

/** Derive always-visible todo progress from the shared agent state. */
export function todoProgress(panel: AgentPanelState): TodoProgress {
  const items = panel.todo ?? [];
  const total = items.length;
  const done = items.filter((t) => t.status === "completed").length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return { done, total, pct };
}
