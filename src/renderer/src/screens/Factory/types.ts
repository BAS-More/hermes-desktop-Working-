// Mirror of the engine's `hermes kanban govern --json` document.
// Shared between the Factory tab (screens/Factory/Factory.tsx) and the in-chat
// Factory panel (screens/Chat/FactoryPanel.tsx + shared/useFactoryStatus.ts) so
// the shape has a single source of truth.

export interface GovernProfileState {
  profile: string;
  level: string | null;
  protected_paths: string[];
  secret_scan: boolean;
  hybrid: boolean;
  model: string | null;
  governed: boolean;
}

export interface GovernBuild {
  root_id: string;
  title: string | null;
  task_status: string | null;
  orchestrator: string | null;
  loop_state: string | null;
  verify_round: number;
  max_verify_rounds: number;
  acceptance: string[];
  last_verdict: string | null;
  last_summary: string | null;
  unmet: Array<Record<string, unknown>>;
  updated_at: string | null;
}

export interface GovernStatus {
  schema: number;
  governance: {
    valid_levels: string[];
    default_level: string;
    level: string;
    level_uniform: boolean;
    secret_scan_patterns: number;
    profiles: GovernProfileState[];
  };
  budget: {
    kill_switch: { active: boolean; paths: string[]; present_at: string[] };
    dimensions: string[];
    default_max_iterations: number | null;
    default_wallclock_seconds: number | null;
    per_block_retry_cap: number | null;
  };
  orchestration: Record<string, unknown>;
  builds?: GovernBuild[];
  activity: {
    recent_governance_blocks: Array<Record<string, unknown>>;
    recent_budget_events: Array<Record<string, unknown>>;
    recent_builds: Array<Record<string, unknown>>;
    change_log: Array<Record<string, unknown>>;
  };
}
