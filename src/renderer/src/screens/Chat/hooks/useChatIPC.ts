import { useEffect, useRef } from "react";
import type { ChatMessage, UsageState } from "../types";
import {
  dbItemsToChatMessages,
  reconcileStreamedWithDb,
  type DbHistoryItem,
} from "../sessionHistory";
import {
  liveToolEventFromProgress,
  upsertLiveToolEvent,
} from "../liveToolEvents";
import { upsertLiveReasoningChunk } from "../liveReasoningEvents";

interface UseChatIPCArgs {
  /** This conversation's run id. Events tagged with a different runId belong
   *  to another (background) session and are ignored. */
  runId: string;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setHermesSessionId: (id: string) => void;
  setToolProgress: (tool: string | null) => void;
  setIsLoading: (loading: boolean) => void;
  setUsage: React.Dispatch<React.SetStateAction<UsageState | null>>;
}

/**
 * True when an incoming event belongs to this conversation. Multiple chats run
 * concurrently and share the same global IPC channels, so each listener must
 * drop events whose runId isn't ours — otherwise a background session's tokens
 * would leak into the foreground transcript.
 */
export function eventMatchesRun(eventRunId: string, ownRunId: string): boolean {
  return eventRunId === ownRunId;
}

/**
 * Registers all chat-related IPC listeners once and tears them down on unmount.
 *
 * Each listener writes through the provided setters; consumers should pass
 * stable `useState`/`useDispatch` setters (React guarantees identity).
 */
export function useChatIPC({
  runId,
  setMessages,
  setHermesSessionId,
  setToolProgress,
  setIsLoading,
  setUsage,
}: UseChatIPCArgs): void {
  const reasoningSegmentClosedRef = useRef(false);

  useEffect(() => {
    const cleanupChunk = window.hermesAPI.onChatChunk((eventRunId, chunk) => {
      if (!eventMatchesRun(eventRunId, runId)) return;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (
          last &&
          last.role === "agent" &&
          "content" in last &&
          typeof last.content === "string"
        ) {
          return [
            ...prev.slice(0, -1),
            { ...last, content: last.content + chunk },
          ];
        }
        // Skip empty initial chunks so we don't create an empty bubble
        if (!chunk || !chunk.trim()) return prev;
        return [
          ...prev,
          { id: `agent-${Date.now()}`, role: "agent", content: chunk },
        ];
      });
    });

    // Streaming reasoning / thinking bubbles for the current turn (#352).
    // Keep chunk order relative to tool rows. A new thought after a tool call
    // should become a new block there, not mutate the first thought block.
    const cleanupReasoning = window.hermesAPI.onChatReasoningChunk(
      (eventRunId, chunk) => {
        if (!eventMatchesRun(eventRunId, runId)) return;
        if (!chunk) return;
        const forceNewSegment = reasoningSegmentClosedRef.current;
        reasoningSegmentClosedRef.current = false;
        setMessages((prev) =>
          upsertLiveReasoningChunk(prev, chunk, Date.now(), forceNewSegment),
        );
      },
    );

    const cleanupDone = window.hermesAPI.onChatDone(
      async (eventRunId, sessionId) => {
        if (!eventMatchesRun(eventRunId, runId)) return;
        reasoningSegmentClosedRef.current = false;
        if (sessionId) setHermesSessionId(sessionId);
        setToolProgress(null);
        setIsLoading(false);
        // End-of-stream merge from state.db. The gateway doesn't forward
        // streaming reasoning_content / tool deltas over the OpenAI-compatible
        // SSE (NousResearch/hermes-agent#30449) — the agent writes them to
        // state.db at finalisation instead. Without this merge, the
        // reasoning / tool bubbles only materialise when something else
        // triggers a re-sync (window focus change, tab switch). Doing it
        // here makes them appear immediately on stream completion (#352).
        //
        // We *merge* (not replace) so that once #30449 lands and reasoning
        // does stream, the already-rendered streamed bubble keeps its
        // React identity instead of being re-mounted by a DB-id swap.
        // `reconcileStreamedWithDb` does the matching — see its doc block.
        if (!sessionId) return;
        try {
          const items = (await window.hermesAPI.getSessionMessages(
            sessionId,
          )) as DbHistoryItem[];
          const dbMessages = dbItemsToChatMessages(items);
          if (dbMessages.length === 0) return;
          setMessages((prev) => reconcileStreamedWithDb(prev, dbMessages));
        } catch {
          // Merge is a UX nicety — don't break the chat flow if it fails.
        }
      },
    );

    const cleanupError = window.hermesAPI.onChatError((eventRunId, error) => {
      if (!eventMatchesRun(eventRunId, runId)) return;
      reasoningSegmentClosedRef.current = false;
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "agent",
          content: `Error: ${error}`,
        },
      ]);
      setToolProgress(null);
      setIsLoading(false);
    });

    const cleanupClarify = window.hermesAPI.onClarifyRequest(
      (eventRunId, req) => {
        if (!eventMatchesRun(eventRunId, runId)) return;
        reasoningSegmentClosedRef.current = true;
        setToolProgress(null);
        // Keep the turn marked busy: the agent is blocked on the user's answer.
        setIsLoading(true);
        setMessages((prev) => {
          // Idempotent: ignore a duplicate request for an already-shown question.
          if (
            prev.some(
              (m) => m.kind === "clarify" && m.requestId === req.requestId,
            )
          ) {
            return prev;
          }
          return [
            ...prev,
            {
              id: `clarify-${req.requestId}`,
              kind: "clarify",
              role: "agent",
              requestId: req.requestId,
              question: req.question,
              choices: Array.isArray(req.choices) ? req.choices : [],
            },
          ];
        });
      },
    );

    const cleanupToolProgress = window.hermesAPI.onChatToolProgress(
      (eventRunId, tool) => {
        if (!eventMatchesRun(eventRunId, runId)) return;
        setToolProgress(null);
        if (!tool.trim()) return;
        reasoningSegmentClosedRef.current = true;
        setMessages((prev) =>
          upsertLiveToolEvent(prev, liveToolEventFromProgress(tool)),
        );
      },
    );

    const cleanupToolEvent = window.hermesAPI.onChatToolEvent(
      (eventRunId, toolEvent) => {
        if (!eventMatchesRun(eventRunId, runId)) return;
        setToolProgress(null);
        reasoningSegmentClosedRef.current = true;
        setMessages((prev) => upsertLiveToolEvent(prev, toolEvent));
      },
    );

    const cleanupUsage = window.hermesAPI.onChatUsage((eventRunId, u) => {
      if (!eventMatchesRun(eventRunId, runId)) return;
      setUsage((prev) => ({
        promptTokens: (prev?.promptTokens || 0) + u.promptTokens,
        completionTokens: (prev?.completionTokens || 0) + u.completionTokens,
        totalTokens: (prev?.totalTokens || 0) + u.totalTokens,
        cost: u.cost != null ? (prev?.cost || 0) + u.cost : prev?.cost,
        // Latest-turn values (overwrite, not sum) for the context gauge.
        contextTokens: u.promptTokens || prev?.contextTokens,
        cacheReadTokens: u.cacheReadTokens ?? prev?.cacheReadTokens,
        cacheWriteTokens: u.cacheWriteTokens ?? prev?.cacheWriteTokens,
      }));
    });

    return () => {
      cleanupChunk();
      cleanupReasoning();
      cleanupDone();
      cleanupError();
      cleanupClarify();
      cleanupToolProgress();
      cleanupToolEvent();
      cleanupUsage();
    };
  }, [
    runId,
    setMessages,
    setHermesSessionId,
    setToolProgress,
    setIsLoading,
    setUsage,
  ]);
}
