/**
 * Phase 3 contract test — pure right-panel layout state + todo progress selector.
 * Encodes tests/specs/right-panel.feature (state portion). Imports the
 * not-yet-written src/shared/panel-layout.ts (TDAD red).
 */
import { describe, it, expect } from "vitest";
import {
  defaultRightPanelState,
  togglePanel,
  setActiveSection,
  toggleSection,
  todoProgress,
} from "../src/shared/panel-layout";
import {
  initialAgentPanelState,
  type AgentPanelState,
  type TodoItem,
} from "../src/shared/agent-events";

function panelWithTodos(items: TodoItem[]): AgentPanelState {
  return { ...initialAgentPanelState(), todo: items };
}

describe("panel-layout state", () => {
  it("defaults to visible with the todo section active", () => {
    const s = defaultRightPanelState();
    expect(s.visible).toBe(true);
    expect(s.activeSection).toBe("todo");
    expect(s.collapsedSections).toEqual([]);
  });

  it("toggles panel visibility", () => {
    const a = defaultRightPanelState();
    const b = togglePanel(a);
    expect(b.visible).toBe(false);
    expect(togglePanel(b).visible).toBe(true);
    // pure: original unchanged
    expect(a.visible).toBe(true);
  });

  it("sets the active section", () => {
    const s = setActiveSection(defaultRightPanelState(), "usage");
    expect(s.activeSection).toBe("usage");
  });

  it("collapses and expands a section", () => {
    const a = toggleSection(defaultRightPanelState(), "plan");
    expect(a.collapsedSections).toContain("plan");
    const b = toggleSection(a, "plan");
    expect(b.collapsedSections).not.toContain("plan");
  });
});

describe("todoProgress selector", () => {
  it("is 0/0 0% for an empty list", () => {
    expect(todoProgress(panelWithTodos([]))).toEqual({
      done: 0,
      total: 0,
      pct: 0,
    });
  });

  it("counts completed items as a percentage", () => {
    const items: TodoItem[] = [
      { id: "1", content: "a", status: "completed" },
      { id: "2", content: "b", status: "completed" },
      { id: "3", content: "c", status: "in_progress" },
      { id: "4", content: "d", status: "pending" },
      { id: "5", content: "e", status: "pending" },
    ];
    expect(todoProgress(panelWithTodos(items))).toEqual({
      done: 2,
      total: 5,
      pct: 40,
    });
  });

  it("is 100% when all items are completed", () => {
    const items: TodoItem[] = [
      { id: "1", content: "a", status: "completed" },
      { id: "2", content: "b", status: "completed" },
    ];
    expect(todoProgress(panelWithTodos(items)).pct).toBe(100);
  });
});
