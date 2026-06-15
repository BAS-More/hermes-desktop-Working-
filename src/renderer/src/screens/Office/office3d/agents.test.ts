import { describe, expect, it } from "vitest";
import {
  profileToOfficeAgent,
  enrichOfficeAgentsWithBuilds,
  CELEBRATE_DURATION_MS,
} from "./agents";
import type { OfficeAgent } from "./core/types";
import type { GovernStatus, GovernBuild } from "../../Factory/types";

function agent(id: string, status: OfficeAgent["status"] = "idle"): OfficeAgent {
  return profileToOfficeAgent({ name: id, gatewayRunning: status === "working" });
}

function build(partial: Partial<GovernBuild>): GovernBuild {
  return {
    root_id: "r1",
    title: "Build 1",
    task_status: "in_progress",
    orchestrator: "architect",
    loop_state: "building",
    verify_round: 0,
    max_verify_rounds: 3,
    acceptance: [],
    last_verdict: null,
    last_summary: null,
    unmet: [],
    updated_at: null,
    ...partial,
  };
}

function status(builds: GovernBuild[]): GovernStatus {
  return {
    schema: 1,
    governance: {
      valid_levels: [],
      default_level: "warn",
      level: "warn",
      level_uniform: true,
      secret_scan_patterns: 0,
      profiles: [],
    },
    budget: {
      kill_switch: { active: false, paths: [], present_at: [] },
      dimensions: [],
      default_max_iterations: null,
      default_wallclock_seconds: null,
      per_block_retry_cap: null,
    },
    orchestration: {},
    builds,
    activity: {
      recent_governance_blocks: [],
      recent_budget_events: [],
      recent_builds: [],
      change_log: [],
    },
  };
}

describe("enrichOfficeAgentsWithBuilds", () => {
  it("returns the same array reference when there are no builds", () => {
    const agents = [agent("architect"), agent("backend-engineer")];
    const out = enrichOfficeAgentsWithBuilds(agents, status([]), {});
    expect(out).toBe(agents);
  });

  it("returns the same reference when status is null", () => {
    const agents = [agent("architect")];
    expect(enrichOfficeAgentsWithBuilds(agents, null, {})).toBe(agents);
  });

  it("drives the orchestrator bot to working while a build is active", () => {
    const agents = [agent("architect", "idle"), agent("other", "idle")];
    const out = enrichOfficeAgentsWithBuilds(
      agents,
      status([build({ loop_state: "verifying", orchestrator: "architect" })]),
      {},
    );
    expect(out.find((a) => a.id === "architect")?.status).toBe("working");
    // Untouched agent keeps its identity.
    expect(out.find((a) => a.id === "other")).toBe(agents[1]);
  });

  it("flips a parked build's orchestrator bot to error", () => {
    const agents = [agent("architect", "working")];
    const out = enrichOfficeAgentsWithBuilds(
      agents,
      status([build({ loop_state: "parked", orchestrator: "architect" })]),
      {},
    );
    expect(out[0].status).toBe("error");
  });

  it("tags the bot with the celebrate deadline from the celebrations map", () => {
    const agents = [agent("architect", "idle")];
    const deadline = 1_000_000 + CELEBRATE_DURATION_MS;
    const out = enrichOfficeAgentsWithBuilds(
      agents,
      status([build({ loop_state: "done", root_id: "rX" })]),
      { rX: deadline },
    );
    expect(out[0].celebrateUntil).toBe(deadline);
    // A done celebration nudges an idle bot to working so the dance reads well.
    expect(out[0].status).toBe("working");
  });

  it("does not celebrate a done build that isn't in the celebrations map", () => {
    const agents = [agent("architect", "idle")];
    const out = enrichOfficeAgentsWithBuilds(
      agents,
      status([build({ loop_state: "done", root_id: "rX" })]),
      {},
    );
    expect(out[0].celebrateUntil).toBeUndefined();
  });

  it("ignores builds whose orchestrator isn't present in the office", () => {
    const agents = [agent("architect")];
    const out = enrichOfficeAgentsWithBuilds(
      agents,
      status([build({ orchestrator: "ghost-profile" })]),
      {},
    );
    expect(out).toBe(agents);
  });
});
