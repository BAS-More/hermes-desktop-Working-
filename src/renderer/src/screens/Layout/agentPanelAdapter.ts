/**
 * Live wiring — adapt the EXISTING chat IPC event stream into the
 * AgentPanelEvents the right side-panel consumes.
 *
 * The renderer already receives `chat-tool-event` and `chat-usage` over IPC
 * (see preload onChatToolEvent / onChatUsage). Rather than invent a new channel,
 * we translate those into the typed AgentPanelEvent union (@shared/agent-events)
 * so tasks + the usage ring update live with NO Python-side change. Native
 * todo/diff/review/plan events (when the agent core emits them) pass straight
 * through via passThroughAgentEvent.
 *
 * The pure adapters are unit-tested (tests/agent-panel-adapter.test.ts); the
 * hook wires them to the preload subscriptions + React state.
 */
import { useEffect, useRef, useState } from "react";
import type { ChatToolEvent } from "../../../../shared/chat-stream";
import {
  applyAgentEvent,
  initialAgentPanelState,
  type AgentPanelEvent,
  type AgentPanelState,
} from "../../../../shared/agent-events";
import { contextWindowForModel } from "../Chat/contextWindows";

const KNOWN_AGENT_EVENT_TYPES = new Set([
  "todo.update",
  "task.update",
  "diff.update",
  "review.update",
  "plan.update",
  "usage.update",
]);

/** Map a chat tool event's status to a task lifecycle state. */
function toolState(
  status: ChatToolEvent["status"],
): "running" | "succeeded" | "failed" {
  if (status === "completed") return "succeeded";
  if (status === "failed") return "failed";
  return "running";
}

/** Translate a chat tool event into AgentPanelEvents (currently a task.update). */
export function toolEventToAgentEvents(
  _runId: string,
  event: ChatToolEvent,
): AgentPanelEvent[] {
  const id = event.callId || `${event.name}`;
  return [
    {
      type: "task.update",
      payload: {
        id,
        title: event.label || event.name || "tool",
        progress: event.status === "completed" ? 100 : 0,
        state: toolState(event.status),
      },
    },
  ];
}

interface UsageLike {
  totalTokens?: number;
}

/** Translate a chat usage event into a usage.update (context% vs the window). */
export function usageToAgentEvent(
  usage: UsageLike,
  contextWindow: number,
): AgentPanelEvent {
  const total = Math.max(0, usage.totalTokens ?? 0);
  const win = contextWindow > 0 ? contextWindow : 1;
  const pct = Math.min(100, Math.round((total / win) * 100));
  return { type: "usage.update", payload: { contextPct: pct, planPct: 0 } };
}

/** Pass a raw native agent event through iff it's a recognized panel event. */
export function passThroughAgentEvent(raw: unknown): AgentPanelEvent | null {
  if (
    raw &&
    typeof raw === "object" &&
    "type" in raw &&
    typeof (raw as { type: unknown }).type === "string" &&
    KNOWN_AGENT_EVENT_TYPES.has((raw as { type: string }).type)
  ) {
    return raw as AgentPanelEvent;
  }
  return null;
}

/** Reduce a batch of agent events onto a state (pure helper for tests + hook). */
export function foldChatEvents(
  state: AgentPanelState,
  events: AgentPanelEvent[],
): AgentPanelState {
  return events.reduce((s, e) => applyAgentEvent(s, e), state);
}

/**
 * React hook: subscribe to the live chat IPC stream and fold it into one
 * AgentPanelState for the right side-panel. Resets on each new session.
 */
export function useAgentPanelState(model?: string | null): AgentPanelState {
  const [state, setState] = useState<AgentPanelState>(initialAgentPanelState);
  const contextWindow = useRef(contextWindowForModel(model));
  contextWindow.current = contextWindowForModel(model);

  useEffect(() => {
    const api = window.hermesAPI;
    if (!api) return;
    const unsubs: Array<() => void> = [];

    if (typeof api.onChatToolEvent === "function") {
      unsubs.push(
        api.onChatToolEvent((runId: string, toolEvent: ChatToolEvent) => {
          const evs = toolEventToAgentEvents(runId, toolEvent);
          setState((s) => foldChatEvents(s, evs));
        }),
      );
    }
    if (typeof api.onChatUsage === "function") {
      unsubs.push(
        api.onChatUsage((_runId: string, usage: UsageLike) => {
          setState((s) =>
            applyAgentEvent(s, usageToAgentEvent(usage, contextWindow.current)),
          );
        }),
      );
    }
    // New session → clear the panel.
    if (typeof api.onChatSessionStarted === "function") {
      unsubs.push(
        api.onChatSessionStarted(() => setState(initialAgentPanelState())),
      );
    }

    return () => {
      for (const u of unsubs) {
        try {
          u();
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  return state;
}
