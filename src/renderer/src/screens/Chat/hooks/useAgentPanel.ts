import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyAgentEvent,
  initialAgentPanelState,
  type AgentPanelEvent,
  type AgentPanelState,
} from "../../../../../shared/agent-events";
import type { ChatToolEvent } from "../../../../../shared/chat-stream";
import type { DashboardStreamEvent } from "../dashboardEventAdapter";
import { contextWindowForModel } from "../contextWindows";
import {
  toolEventToAgentEvents,
  usageToAgentEvent,
  foldChatEvents,
} from "../../Layout/agentPanelAdapter";

const PANEL_EVENT_TYPES = new Set([
  "todo.update",
  "task.update",
  "diff.update",
  "review.update",
  "plan.update",
  "usage.update",
]);

interface UsageLike {
  totalTokens?: number;
}

export interface UseAgentPanelResult {
  state: AgentPanelState;
  /** Pass as `onAgentPanelEvent` to useDashboardChatTransport. */
  onAgentPanelEvent: (event: DashboardStreamEvent) => void;
  reset: () => void;
}

/**
 * Owns the right-side panel's AgentPanelState. Two complementary feeds, both
 * folded through the same pure reducer (@shared/agent-events):
 *
 *  1. The transport tap (`onAgentPanelEvent`) — NATIVE panel events the agent
 *     core emits (todo/diff/review/plan/usage/task.update). Until the core emits
 *     them this is dormant; no behavior change.
 *  2. The existing chat IPC stream (onChatToolEvent / onChatUsage) — translated
 *     into task.update + usage.update so the Tasks list and Usage ring light up
 *     LIVE today with NO Python-side change. Resets on a new session.
 *
 * Kept separate from the chat reducer so the panel can't perturb chat rendering
 * or prompt caching — it is a passive consumer of the same stream(s).
 */
export function useAgentPanel(model?: string | null): UseAgentPanelResult {
  const [state, setState] = useState<AgentPanelState>(initialAgentPanelState);
  const contextWindowRef = useRef(contextWindowForModel(model ?? undefined));
  contextWindowRef.current = contextWindowForModel(model ?? undefined);

  const onAgentPanelEvent = useCallback((event: DashboardStreamEvent): void => {
    if (!event || !PANEL_EVENT_TYPES.has(event.type)) return;
    setState((prev) => applyAgentEvent(prev, event as AgentPanelEvent));
  }, []);

  const reset = useCallback(() => setState(initialAgentPanelState()), []);

  // Live feed from the existing chat IPC events (no Python change needed).
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
            applyAgentEvent(
              s,
              usageToAgentEvent(usage, contextWindowRef.current),
            ),
          );
        }),
      );
    }
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

  return useMemo(
    () => ({ state, onAgentPanelEvent, reset }),
    [state, onAgentPanelEvent, reset],
  );
}
