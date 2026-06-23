/**
 * Live-wiring contract test — chat IPC events → AgentPanelEvents.
 * Encodes tests/specs/agent-panel-adapter.feature. Imports not-yet-written
 * src/renderer/src/screens/Layout/agentPanelAdapter.ts (TDAD red).
 */
import { describe, it, expect } from "vitest";
import {
  toolEventToAgentEvents,
  usageToAgentEvent,
  passThroughAgentEvent,
  foldChatEvents,
} from "../src/renderer/src/screens/Layout/agentPanelAdapter";
import {
  initialAgentPanelState,
  applyAgentEvent,
} from "../src/shared/agent-events";

describe("toolEventToAgentEvents", () => {
  it("maps a running tool to a running task", () => {
    const evs = toolEventToAgentEvents("c1", {
      callId: "c1",
      name: "terminal",
      status: "running",
    });
    const task = evs.find((e) => e.type === "task.update");
    expect(task).toBeTruthy();
    expect(
      (task as { payload: { id: string; title: string; state: string } })
        .payload,
    ).toMatchObject({ id: "c1", title: "terminal", state: "running" });
  });

  it("maps a completed tool to a succeeded task", () => {
    const evs = toolEventToAgentEvents("c1", {
      callId: "c1",
      name: "terminal",
      status: "completed",
    });
    expect((evs[0] as { payload: { state: string } }).payload.state).toBe(
      "succeeded",
    );
  });

  it("maps a failed tool to a failed task", () => {
    const evs = toolEventToAgentEvents("c1", {
      callId: "c1",
      name: "terminal",
      status: "failed",
    });
    expect((evs[0] as { payload: { state: string } }).payload.state).toBe(
      "failed",
    );
  });
});

describe("usageToAgentEvent", () => {
  it("converts total tokens to a context percentage", () => {
    const ev = usageToAgentEvent({ totalTokens: 32768 }, 131072);
    expect(ev.type).toBe("usage.update");
    expect((ev as { payload: { contextPct: number } }).payload.contextPct).toBe(
      25,
    );
  });

  it("clamps context percentage to 100", () => {
    const ev = usageToAgentEvent({ totalTokens: 500000 }, 131072);
    expect((ev as { payload: { contextPct: number } }).payload.contextPct).toBe(
      100,
    );
  });

  it("is 0 for zero tokens", () => {
    const ev = usageToAgentEvent({ totalTokens: 0 }, 131072);
    expect((ev as { payload: { contextPct: number } }).payload.contextPct).toBe(
      0,
    );
  });
});

describe("passThroughAgentEvent", () => {
  it("passes a native todo.update through unchanged", () => {
    const raw = {
      type: "todo.update",
      payload: { items: [{ id: "t1", content: "x", status: "pending" }] },
    };
    const ev = passThroughAgentEvent(raw);
    expect(ev).toEqual(raw);
  });

  it("returns null for an unrecognized raw event", () => {
    expect(passThroughAgentEvent({ type: "garbage" })).toBeNull();
    expect(passThroughAgentEvent(null)).toBeNull();
  });
});

describe("foldChatEvents", () => {
  it("folds a running then completed tool into one succeeded task", () => {
    let state = initialAgentPanelState();
    const evs = [
      ...toolEventToAgentEvents("c1", {
        callId: "c1",
        name: "terminal",
        status: "running",
      }),
      ...toolEventToAgentEvents("c1", {
        callId: "c1",
        name: "terminal",
        status: "completed",
      }),
    ];
    for (const e of evs) state = applyAgentEvent(state, e);
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].state).toBe("succeeded");
  });

  it("foldChatEvents helper reduces a batch onto a state", () => {
    const evs = toolEventToAgentEvents("c1", {
      callId: "c1",
      name: "web_search",
      status: "running",
    });
    const state = foldChatEvents(initialAgentPanelState(), evs);
    expect(state.tasks[0].title).toBe("web_search");
  });
});
