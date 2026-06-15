import { useCallback, useEffect, useState } from "react";
import type { GovernStatus } from "../../Factory/types";

// Same cadence as the Factory tab so the in-chat panel and the full tab stay
// visually in sync.
const REFRESH_MS = 15000;

export interface UseFactoryStatusResult {
  status: GovernStatus | null;
  loading: boolean;
  error: string | null;
  unsupported: boolean;
  loopOn: boolean;
  /** Re-fetch the governance status immediately. */
  reload: () => Promise<void>;
  /** Flip the orchestrator closed-loop (kanban.orchestrator_loop). */
  setLoop: (on: boolean) => Promise<void>;
}

/**
 * Live read of the dev-factory governance status for the in-chat Factory panel.
 *
 * Mirrors the load/poll logic in screens/Factory/Factory.tsx but is scoped to a
 * single `active` flag so it only polls the engine while the panel is open.
 * `setLoop` is optimistic: it flips local `loopOn`, calls the govern IPC, then
 * reloads; on failure it reverts and surfaces the error.
 */
export function useFactoryStatus(active: boolean): UseFactoryStatusResult {
  const [status, setStatus] = useState<GovernStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  // Optimistic override for the loop state; null = derive from `status`.
  const [loopOverride, setLoopOverride] = useState<boolean | null>(null);

  const loopFromStatus = useCallback((s: GovernStatus | null): boolean => {
    const orch = (s?.orchestration ?? {}) as Record<string, unknown>;
    const v = orch.orchestrator_loop;
    return v === true || v === "true";
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const res = await window.hermesAPI.kanbanGovernStatus();
      if (res.success && res.data) {
        setStatus(res.data as GovernStatus);
        setUnsupported(false);
        // A successful refresh is the source of truth — drop any override.
        setLoopOverride(null);
      } else if (res.unsupportedMode) {
        setUnsupported(true);
      } else {
        setError(res.error || "Failed to load factory status.");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + poll, only while active.
  useEffect(() => {
    if (!active) return;
    setLoading(true);
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [active, load]);

  const setLoop = useCallback(
    async (on: boolean): Promise<void> => {
      const previous = loopFromStatus(status);
      setLoopOverride(on); // optimistic
      try {
        const res = await window.hermesAPI.kanbanGovernSet({
          orchestratorLoop: on ? "on" : "off",
        });
        if (!res.success) {
          if (res.unsupportedMode) setUnsupported(true);
          throw new Error(res.error || "Failed to change factory mode.");
        }
        await load();
      } catch (e) {
        setLoopOverride(previous); // revert
        setError((e as Error).message);
        throw e;
      }
    },
    [status, loopFromStatus, load],
  );

  const loopOn = loopOverride ?? loopFromStatus(status);

  return { status, loading, error, unsupported, loopOn, reload: load, setLoop };
}
