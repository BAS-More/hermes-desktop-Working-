import { useCallback, useMemo, useRef, useState } from "react";
import {
  applyAgentEvent,
  initialAgentPanelState,
  type AgentPanelEvent,
  type AgentPanelState,
} from "../../../../../shared/agent-events";
import type { DashboardStreamEvent } from "../dashboardEventAdapter";

const PANEL_EVENT_TYPES = new Set([
  "todo.update",
  "task.update",
  "diff.update",
  "review.update",
  "plan.update",
  "usage.update",
]);

export interface UseAgentPanelResult {
  state: AgentPanelState;
  /** Pass as `onAgentPanelEvent` to useDashboardChatTransport. */
  onAgentPanelEvent: (event: DashboardStreamEvent) => void;
  reset: () => void;
}

/**
 * Owns the right-side panel's AgentPanelState by folding the agent event stream
 * (tapped from the chat transport) through the pure reducer. Only the six panel
 * event types touch state; everything else (chat deltas, tool calls, etc.) is
 * ignored so the panel never reacts to unrelated traffic.
 *
 * Kept separate from the chat reducer so the panel can't perturb chat rendering
 * or prompt caching — it's a passive consumer of the same stream.
 */
export function useAgentPanel(): UseAgentPanelResult {
  const [state, setState] = useState<AgentPanelState>(initialAgentPanelState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const onAgentPanelEvent = useCallback((event: DashboardStreamEvent): void => {
    if (!event || !PANEL_EVENT_TYPES.has(event.type)) return;
    setState((prev) => applyAgentEvent(prev, event as AgentPanelEvent));
  }, []);

  const reset = useCallback(() => setState(initialAgentPanelState()), []);

  return useMemo(
    () => ({ state, onAgentPanelEvent, reset }),
    [state, onAgentPanelEvent, reset],
  );
}
