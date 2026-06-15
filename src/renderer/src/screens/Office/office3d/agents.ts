import { createAgentAvatarProfileFromSeed } from "./avatars/profile";
import type { OfficeAgent } from "./core/types";
import type { GovernStatus } from "../../Factory/types";

/**
 * A profile as surfaced by the desktop's `listProfiles` IPC. Only the fields
 * the office needs to render an agent are required here.
 */
export interface OfficeProfileInput {
  name: string;
  /**
   * Unique, stable identifier for the profile (the on-disk profile path from
   * `listProfiles`). Used as the agent's React key / lookup id so two profiles
   * sharing a display name don't collapse into one agent. Falls back to the
   * name when absent.
   */
  path?: string;
  model?: string;
  provider?: string;
  gatewayRunning?: boolean;
}

// Stable, pleasant accent colors keyed off the profile name so each agent keeps
// the same color between renders.
const AGENT_COLORS = [
  "#7090ff",
  "#34d399",
  "#f59e0b",
  "#f43f5e",
  "#8b5cf6",
  "#0891b2",
  "#db2777",
  "#22c55e",
];

function hashName(name: string): number {
  let hash = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Map a desktop profile to an office agent. Each profile becomes one 3D agent;
 * a running gateway reads as "working" (green), otherwise "idle" (amber).
 */
export function profileToOfficeAgent(profile: OfficeProfileInput): OfficeAgent {
  const seed = profile.name || "agent";
  const color = AGENT_COLORS[hashName(seed) % AGENT_COLORS.length];
  // Use profile name as the stable id — it is unique within the system and
  // is the valid identifier for gateway API calls.
  const id = profile.name;
  return {
    id,
    name: profile.name,
    subtitle: profile.model || profile.provider || null,
    status: profile.gatewayRunning ? "working" : "idle",
    color,
    item: "desk",
    avatarProfile: createAgentAvatarProfileFromSeed(seed),
    model: profile.model,
    provider: profile.provider,
    gatewayRunning: profile.gatewayRunning,
    position: "employee",
  };
}

export function profilesToOfficeAgents(
  profiles: OfficeProfileInput[],
): OfficeAgent[] {
  return profiles.map(profileToOfficeAgent);
}

/** Duration of the dancing beat (ms) when a tracked build finishes. */
export const CELEBRATE_DURATION_MS = 4000;

/**
 * Overlay factory build state onto the gateway-driven office agents.
 *
 * - For each tracked build, the orchestrator's bot is forced to `status:
 *   "working"` while the build is active (building/verifying/correcting) so
 *   factory work drives the bot even when that profile's gateway hasn't booted
 *   (the orchestrator runs across profile boundaries).
 * - When a build is in `loop_state === "parked"` (escalated to human review),
 *   the bot's status flips to `"error"` so the red dot makes stuck builds
 *   visible at a glance.
 * - `celebrations` maps a build `root_id` to a `celebrateUntil` deadline (ms).
 *   The orchestrator bot of any build present in that map is tagged with the
 *   deadline so the AgentsLayer plays the dancing animation until it passes.
 *
 * Fully PURE and idempotent — no clock read, no mutation. The caller decides
 * *when* a build's completion becomes a celebration (so the once-only logic
 * lives in a React effect, not here). Tested in `agents.test.ts`.
 */
export function enrichOfficeAgentsWithBuilds(
  agents: OfficeAgent[],
  status: GovernStatus | null,
  celebrations: Record<string, number> = {},
): OfficeAgent[] {
  const builds = status?.builds ?? [];
  if (builds.length === 0) return agents;

  // Index agents by id once so the per-build lookup is O(1).
  const byId = new Map<string, OfficeAgent>();
  for (const a of agents) byId.set(a.id, a);

  // Copy-on-write: only allocate a new agent object when something changes for
  // it, so untouched agents keep their referential identity (matters for React
  // keys + the AgentsLayer's "unchanged?" fast path).
  const patched = new Map<string, OfficeAgent>();

  for (const build of builds) {
    const profileId = build.orchestrator || "";
    if (!profileId) continue;
    const base = patched.get(profileId) ?? byId.get(profileId);
    if (!base) continue; // profile not present in the office (e.g. deleted)

    let next: OfficeAgent | null = null;
    const ensure = (): OfficeAgent => next ?? (next = { ...base });

    if (build.loop_state === "parked") {
      ensure().status = "error";
    } else if (
      build.loop_state === "building" ||
      build.loop_state === "verifying" ||
      build.loop_state === "correcting"
    ) {
      // Active factory work — drive the bot to its desk regardless of gateway.
      if (base.status !== "working") ensure().status = "working";
    }

    const deadline = build.root_id ? celebrations[build.root_id] : undefined;
    if (deadline) {
      ensure().celebrateUntil = deadline;
      // The dance reads better from a working pose than "idle in the rest
      // room", so nudge an idle bot to working for the celebration window.
      if (base.status === "idle") ensure().status = "working";
    }

    if (next) patched.set(profileId, next);
  }

  if (patched.size === 0) return agents;
  return agents.map((a) => patched.get(a.id) ?? a);
}
