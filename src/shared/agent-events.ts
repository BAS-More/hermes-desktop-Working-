/**
 * Phase 0 foundation — Agent → UI event schema + pure reducer.
 *
 * This is the single typed contract that every right-side-panel pane consumes:
 * the always-visible to-do list, the tasks/subagents pane, the plan pane, the
 * diff badge/viewer, the inline review pane, and the usage ring.
 *
 * It EXTENDS the existing `DashboardStreamEvent<T>` shape ({ type, payload,
 * session_id }) used by the dashboard chat stream, rather than inventing a
 * parallel pipeline. The Python agent core emits these events over the same
 * IPC/WebSocket channel the chat stream already uses; the renderer folds them
 * into one `AgentPanelState` with `applyAgentEvent`, a pure function.
 *
 * Design rules locked in by the contract test (tests/agent-events.test.ts) and
 * the spec (tests/specs/agent-events.feature):
 *  - `todo.update` carries a full snapshot of the list and REPLACES it
 *    wholesale (the agent's todo tool always sends the complete list), so the
 *    UI auto-ticks items the moment their status becomes "completed".
 *  - `usage.update` may carry a monotonic `seq`; an event whose seq is older
 *    than the last applied one is ignored (stale-guard) to avoid the ring
 *    flapping backwards under out-of-order delivery.
 *  - `diff.update` is keyed by file path; a later update for the same path
 *    replaces that file's counts. The badge totals all files as "+N -M".
 *  - Unknown event types are ignored (forward-compat) and malformed payloads
 *    never corrupt existing state. The reducer never mutates its input.
 */

// Mirrors src/renderer/src/screens/Chat/dashboardEventAdapter.ts so main,
// preload and renderer share one base event shape without a circular import.
export interface DashboardStreamEvent<T = unknown> {
  payload?: T;
  session_id?: string;
  type: string;
}

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
}

export interface TodoUpdatePayload {
  items: TodoItem[];
}

export type TaskState = "queued" | "running" | "failed" | "succeeded";

export interface TaskUpdatePayload {
  id: string;
  title: string;
  /** 0–100 */
  progress: number;
  state: TaskState;
}

export interface DiffUpdatePayload {
  path: string;
  added: number;
  removed: number;
}

export interface ReviewUpdatePayload {
  path: string;
  line: number;
  comment: string;
}

export interface PlanUpdatePayload {
  steps: string[];
}

export interface UsageUpdatePayload {
  /** 0–100 */
  contextPct: number;
  /** 0–100 */
  planPct: number;
  /** Optional monotonic sequence for stale-guarding out-of-order updates. */
  seq?: number;
}

/** The typed discriminated union the renderer reduces. */
export type AgentPanelEvent =
  | (DashboardStreamEvent<TodoUpdatePayload> & { type: "todo.update" })
  | (DashboardStreamEvent<TaskUpdatePayload> & { type: "task.update" })
  | (DashboardStreamEvent<DiffUpdatePayload> & { type: "diff.update" })
  | (DashboardStreamEvent<ReviewUpdatePayload> & { type: "review.update" })
  | (DashboardStreamEvent<PlanUpdatePayload> & { type: "plan.update" })
  | (DashboardStreamEvent<UsageUpdatePayload> & { type: "usage.update" });

/** The single state object every panel pane consumes. */
export interface AgentPanelState {
  todo: TodoItem[];
  tasks: TaskUpdatePayload[];
  diff: DiffUpdatePayload[];
  review: ReviewUpdatePayload[];
  plan: { steps: string[] };
  usage: { contextPct: number; planPct: number; seq: number };
}

export function initialAgentPanelState(): AgentPanelState {
  return {
    todo: [],
    tasks: [],
    diff: [],
    review: [],
    plan: { steps: [] },
    usage: { contextPct: 0, planPct: 0, seq: -1 },
  };
}

// ---- payload coercion helpers (untrusted-payload safe) --------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const TODO_STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);

function coerceTodoItem(value: unknown): TodoItem | null {
  if (!isRecord(value)) return null;
  const id = str(value.id);
  if (!id) return null;
  const status = str(value.status);
  return {
    id,
    content: str(value.content),
    status: (TODO_STATUSES.has(status) ? status : "pending") as TodoStatus,
  };
}

// ---- the reducer ----------------------------------------------------------

/**
 * Fold one agent event into the panel state. Pure: returns a new state object
 * and never mutates `state`. Unknown types and malformed payloads return the
 * input unchanged (referential identity preserved so consumers can `===`).
 */
export function applyAgentEvent(
  state: AgentPanelState,
  event: AgentPanelEvent,
): AgentPanelState {
  if (!event || typeof event.type !== "string") return state;
  const payload: unknown = event.payload;

  switch (event.type) {
    case "todo.update": {
      const raw = isRecord(payload) ? payload.items : undefined;
      if (!Array.isArray(raw)) {
        // Malformed: empty the list rather than corrupt it, but keep all other
        // slices intact. (Matches the "non-array items" robustness scenario.)
        return state.todo.length === 0 ? state : { ...state, todo: [] };
      }
      const items = raw
        .map(coerceTodoItem)
        .filter((x): x is TodoItem => x !== null);
      return { ...state, todo: items };
    }

    case "usage.update": {
      if (!isRecord(payload)) return state;
      const seq = num(payload.seq, state.usage.seq + 1);
      // Stale-guard: ignore an update whose seq is older than what we have.
      if (typeof payload.seq === "number" && seq < state.usage.seq) {
        return state;
      }
      return {
        ...state,
        usage: {
          contextPct: num(payload.contextPct, state.usage.contextPct),
          planPct: num(payload.planPct, state.usage.planPct),
          seq,
        },
      };
    }

    case "diff.update": {
      if (!isRecord(payload)) return state;
      const path = str(payload.path);
      if (!path) return state;
      const entry: DiffUpdatePayload = {
        path,
        added: num(payload.added),
        removed: num(payload.removed),
      };
      const next = state.diff.filter((d) => d.path !== path);
      next.push(entry);
      return { ...state, diff: next };
    }

    case "review.update": {
      if (!isRecord(payload)) return state;
      const path = str(payload.path);
      if (!path) return state;
      const entry: ReviewUpdatePayload = {
        path,
        line: num(payload.line),
        comment: str(payload.comment),
      };
      return { ...state, review: [...state.review, entry] };
    }

    case "plan.update": {
      if (!isRecord(payload)) return state;
      const steps = Array.isArray(payload.steps)
        ? payload.steps.map(str).filter((s) => s.length > 0)
        : state.plan.steps;
      return { ...state, plan: { steps } };
    }

    case "task.update": {
      if (!isRecord(payload)) return state;
      const id = str(payload.id);
      if (!id) return state;
      const entry: TaskUpdatePayload = {
        id,
        title: str(payload.title),
        progress: num(payload.progress),
        state: ((): TaskState => {
          const s = str(payload.state);
          return (
            ["queued", "running", "failed", "succeeded"].includes(s)
              ? s
              : "queued"
          ) as TaskState;
        })(),
      };
      const next = state.tasks.filter((t) => t.id !== id);
      next.push(entry);
      return { ...state, tasks: next };
    }

    default:
      // Forward-compat: ignore unknown event types without throwing.
      return state;
  }
}

// ---- selectors (used by panes; covered by the contract test) --------------

export function completedTodoCount(state: AgentPanelState): number {
  return state.todo.filter((t) => t.status === "completed").length;
}

/** Total "+N -M" badge across every changed file. */
export function diffBadge(state: AgentPanelState): string {
  const added = state.diff.reduce((sum, d) => sum + d.added, 0);
  const removed = state.diff.reduce((sum, d) => sum + d.removed, 0);
  return `+${added} -${removed}`;
}
