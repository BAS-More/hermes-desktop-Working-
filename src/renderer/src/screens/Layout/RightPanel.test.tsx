/**
 * Phase 3 component test — RightPanel + always-visible auto-ticking todo.
 * Encodes the UI portion of tests/specs/right-panel.feature. Imports the
 * not-yet-written RightPanel (TDAD red).
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { RightPanel } from "./RightPanel";
import {
  applyAgentEvent,
  initialAgentPanelState,
  type AgentPanelState,
} from "../../../../shared/agent-events";

function withTodos(state: AgentPanelState): AgentPanelState {
  return applyAgentEvent(state, {
    type: "todo.update",
    payload: {
      items: [
        { id: "t1", content: "Recon", status: "in_progress" },
        { id: "t2", content: "Build", status: "pending" },
      ],
    },
  });
}

describe("RightPanel — always-visible todo", () => {
  it("renders a live-region list role for the checklist", () => {
    render(<RightPanel state={withTodos(initialAgentPanelState())} />);
    const list = screen.getByTestId("todo-checklist");
    expect(list.getAttribute("role")).toBe("list");
    expect(list.getAttribute("aria-live")).toBe("polite");
  });

  it("shows todo progress in the header (done/total)", () => {
    render(<RightPanel state={withTodos(initialAgentPanelState())} />);
    expect(screen.getByTestId("todo-progress").textContent).toContain("0/2");
  });

  it("auto-ticks an item when the agent marks it completed", () => {
    const base = withTodos(initialAgentPanelState());
    const { rerender } = render(<RightPanel state={base} />);
    const item1 = screen.getByTestId("todo-item-t1");
    expect(item1.getAttribute("aria-checked")).toBe("false");

    const next = applyAgentEvent(base, {
      type: "todo.update",
      payload: {
        items: [
          { id: "t1", content: "Recon", status: "completed" },
          { id: "t2", content: "Build", status: "pending" },
        ],
      },
    });
    rerender(<RightPanel state={next} />);
    expect(screen.getByTestId("todo-item-t1").getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByTestId("todo-progress").textContent).toContain("1/2");
  });

  it("keeps stable row identity across a full-list replace (no flicker)", () => {
    const base = withTodos(initialAgentPanelState());
    const { rerender } = render(<RightPanel state={base} />);
    const rowABefore = screen.getByTestId("todo-item-t1");
    const next = applyAgentEvent(base, {
      type: "todo.update",
      payload: { items: [{ id: "t1", content: "Recon", status: "completed" }] },
    });
    rerender(<RightPanel state={next} />);
    const rowAAfter = screen.getByTestId("todo-item-t1");
    // same DOM node reused (React keyed by id) → no flicker/remount
    expect(rowAAfter).toBe(rowABefore);
    expect(screen.queryByTestId("todo-item-t2")).toBeNull();
  });

  it("renders the usage ring with context and plan percentages", () => {
    let state = initialAgentPanelState();
    state = applyAgentEvent(state, {
      type: "usage.update",
      payload: { contextPct: 42, planPct: 17 },
    });
    render(<RightPanel state={state} initialSection="usage" />);
    const usage = screen.getByTestId("usage-ring");
    expect(within(usage).getByTestId("usage-context").textContent).toContain("42");
    expect(within(usage).getByTestId("usage-plan").textContent).toContain("17");
  });

  it("hides when not visible", () => {
    render(<RightPanel state={initialAgentPanelState()} visible={false} />);
    expect(screen.queryByTestId("right-panel")).toBeNull();
  });
});
