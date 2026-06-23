/**
 * Test for useAgentPanel — folds the tapped agent event stream into
 * AgentPanelState and ignores non-panel events. TDAD: written against the hook.
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAgentPanel } from "./useAgentPanel";

describe("useAgentPanel", () => {
  it("starts with an empty panel state", () => {
    const { result } = renderHook(() => useAgentPanel());
    expect(result.current.state.todo).toEqual([]);
    expect(result.current.state.usage.contextPct).toBe(0);
  });

  it("folds a todo.update into state", () => {
    const { result } = renderHook(() => useAgentPanel());
    act(() => {
      result.current.onAgentPanelEvent({
        type: "todo.update",
        payload: {
          items: [
            { id: "t1", content: "a", status: "completed" },
            { id: "t2", content: "b", status: "pending" },
          ],
        },
      });
    });
    expect(result.current.state.todo).toHaveLength(2);
    expect(result.current.state.todo[0].status).toBe("completed");
  });

  it("folds usage.update", () => {
    const { result } = renderHook(() => useAgentPanel());
    act(() => {
      result.current.onAgentPanelEvent({
        type: "usage.update",
        payload: { contextPct: 55, planPct: 30 },
      });
    });
    expect(result.current.state.usage.contextPct).toBe(55);
    expect(result.current.state.usage.planPct).toBe(30);
  });

  it("ignores non-panel events (chat deltas, tool calls)", () => {
    const { result } = renderHook(() => useAgentPanel());
    const before = result.current.state;
    act(() => {
      result.current.onAgentPanelEvent({
        type: "message.delta",
        payload: { text: "hello" },
      });
      result.current.onAgentPanelEvent({
        type: "tool.start",
        payload: { name: "terminal" },
      });
    });
    expect(result.current.state).toBe(before);
  });

  it("reset returns to the empty state", () => {
    const { result } = renderHook(() => useAgentPanel());
    act(() => {
      result.current.onAgentPanelEvent({
        type: "todo.update",
        payload: { items: [{ id: "t1", content: "a", status: "pending" }] },
      });
    });
    expect(result.current.state.todo).toHaveLength(1);
    act(() => result.current.reset());
    expect(result.current.state.todo).toEqual([]);
  });
});
