/**
 * Phase 0 contract test — Agent → UI event reducer.
 *
 * Encodes tests/specs/agent-events.feature. Written BEFORE the implementation
 * (TDAD red phase): it imports from "@shared/agent-events", which does not exist
 * yet, so the suite fails to resolve until the schema + reducer are built.
 *
 * The contract: every right-side-panel pane (always-visible todo, tasks, plan,
 * diff badge, review, usage ring) is a PURE CONSUMER of one AgentPanelState
 * produced by folding the agent's DashboardStreamEvent stream through
 * applyAgentEvent(). Panes never invent their own pipeline.
 */
import { describe, it, expect } from "vitest";
import {
  applyAgentEvent,
  initialAgentPanelState,
  completedTodoCount,
  diffBadge,
  type AgentPanelState,
  type AgentPanelEvent,
} from "@shared/agent-events";

function reduce(events: AgentPanelEvent[]): AgentPanelState {
  return events.reduce(
    (state, event) => applyAgentEvent(state, event),
    initialAgentPanelState(),
  );
}

describe("agent-events: always-visible to-do list", () => {
  it("a todo.update populates the checklist", () => {
    const state = reduce([
      {
        type: "todo.update",
        payload: {
          items: [
            { id: "t1", content: "Recon repo", status: "completed" },
            { id: "t2", content: "Write schema", status: "in_progress" },
            { id: "t3", content: "Run tests", status: "pending" },
          ],
        },
      },
    ]);
    expect(state.todo).toHaveLength(3);
    expect(state.todo.find((t) => t.id === "t1")?.status).toBe("completed");
    expect(state.todo.find((t) => t.id === "t2")?.status).toBe("in_progress");
  });

  it("a todo item flips to completed and the checkbox ticks", () => {
    const state = reduce([
      {
        type: "todo.update",
        payload: { items: [{ id: "t2", content: "x", status: "in_progress" }] },
      },
      {
        type: "todo.update",
        payload: { items: [{ id: "t2", content: "x", status: "completed" }] },
      },
    ]);
    expect(state.todo.find((t) => t.id === "t2")?.status).toBe("completed");
    expect(completedTodoCount(state)).toBe(1);
  });

  it("todo.update replaces the list wholesale (snapshot, not merge)", () => {
    const state = reduce([
      {
        type: "todo.update",
        payload: {
          items: [
            { id: "a", content: "a", status: "pending" },
            { id: "b", content: "b", status: "pending" },
            { id: "c", content: "c", status: "pending" },
          ],
        },
      },
      {
        type: "todo.update",
        payload: {
          items: [
            { id: "a", content: "a", status: "pending" },
            { id: "b", content: "b", status: "pending" },
          ],
        },
      },
    ]);
    expect(state.todo).toHaveLength(2);
    expect(state.todo.find((t) => t.id === "c")).toBeUndefined();
  });

  it("duplicate identical todo events are idempotent", () => {
    const evt: AgentPanelEvent = {
      type: "todo.update",
      payload: { items: [{ id: "t1", content: "x", status: "completed" }] },
    };
    const state = reduce([evt, evt]);
    expect(state.todo).toHaveLength(1);
    expect(completedTodoCount(state)).toBe(1);
  });
});

describe("agent-events: usage ring", () => {
  it("a usage.update refreshes context and plan percentages", () => {
    const state = reduce([
      { type: "usage.update", payload: { contextPct: 42, planPct: 17 } },
    ]);
    expect(state.usage.contextPct).toBe(42);
    expect(state.usage.planPct).toBe(17);
  });

  it("a stale usage.update with an older seq is ignored", () => {
    const state = reduce([
      { type: "usage.update", payload: { seq: 5, contextPct: 80, planPct: 0 } },
      { type: "usage.update", payload: { seq: 3, contextPct: 10, planPct: 0 } },
    ]);
    expect(state.usage.contextPct).toBe(80);
  });
});

describe("agent-events: diff badge", () => {
  it("records additions and deletions per file and totals the badge", () => {
    const state = reduce([
      {
        type: "diff.update",
        payload: { path: "src/app.ts", added: 12, removed: 1 },
      },
      {
        type: "diff.update",
        payload: { path: "src/util.ts", added: 3, removed: 2 },
      },
    ]);
    const appFile = state.diff.find((d) => d.path === "src/app.ts");
    expect(appFile).toEqual({ path: "src/app.ts", added: 12, removed: 1 });
    expect(diffBadge(state)).toBe("+15 -3");
  });

  it("a later diff.update for the same file replaces its counts", () => {
    const state = reduce([
      {
        type: "diff.update",
        payload: { path: "src/app.ts", added: 12, removed: 1 },
      },
      {
        type: "diff.update",
        payload: { path: "src/app.ts", added: 20, removed: 4 },
      },
    ]);
    expect(state.diff).toHaveLength(1);
    expect(diffBadge(state)).toBe("+20 -4");
  });
});

describe("agent-events: plan + review panes", () => {
  it("a plan.update sets the current plan steps", () => {
    const state = reduce([
      {
        type: "plan.update",
        payload: { steps: ["Explore", "Implement", "Verify"] },
      },
    ]);
    expect(state.plan.steps).toHaveLength(3);
  });

  it("a review.update appends an inline comment to a file line", () => {
    const state = reduce([
      {
        type: "review.update",
        payload: { path: "src/app.ts", line: 10, comment: "off-by-one" },
      },
    ]);
    const comments = state.review.filter(
      (c) => c.path === "src/app.ts" && c.line === 10,
    );
    expect(comments).toHaveLength(1);
    expect(comments[0].comment).toBe("off-by-one");
  });
});

describe("agent-events: robustness / forward-compat", () => {
  it("an unknown event type is ignored without throwing", () => {
    const before = reduce([
      { type: "usage.update", payload: { contextPct: 50, planPct: 25 } },
    ]);
    const after = applyAgentEvent(before, {
      type: "future.unknown.event",
      payload: { anything: true },
    } as unknown as AgentPanelEvent);
    expect(after).toEqual(before);
  });

  it("a malformed todo payload does not corrupt existing state", () => {
    const state = reduce([
      { type: "usage.update", payload: { contextPct: 50, planPct: 25 } },
      {
        type: "todo.update",
        payload: { items: "not-an-array" },
      } as unknown as AgentPanelEvent,
    ]);
    expect(state.usage.contextPct).toBe(50);
    expect(state.todo).toHaveLength(0);
  });

  it("the reducer is pure (does not mutate the input state)", () => {
    const start = initialAgentPanelState();
    const frozen = Object.freeze(start);
    expect(() =>
      applyAgentEvent(frozen, {
        type: "todo.update",
        payload: { items: [{ id: "t1", content: "x", status: "pending" }] },
      }),
    ).not.toThrow();
    expect(start.todo).toHaveLength(0);
  });
});
