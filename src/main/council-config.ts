// LLM Council configuration store (per-profile, JSON-backed).
//
// The Council feature lets the user assemble a panel of models, each bound to a
// named "position" (Senior Architect, Risk Advisor, ...) with an editable,
// self-learning description. The running Hermes agent (Opus 4.8) acts as the
// orchestrator/chairman: it convenes the panel via PAL MCP (free models for the
// seats), gathers each position's opinion, then synthesizes.
//
// Storage: a dedicated `council-config.json` under the profile home. We do NOT
// touch config.yaml — that file is security-gated and agent-write-protected.
// The council roster is pure desktop-side UX state consumed by the agent through
// a convene prompt, so a sidecar JSON is the right home for it.
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { profilePaths, safeWriteFile } from "./utils";
import type {
  CouncilPosition,
  CouncilMember,
  CouncilConfig,
} from "../shared/council";

export type { CouncilPosition, CouncilMember, CouncilConfig };

// ---- Types -----------------------------------------------------------------

// Eight well-considered starter positions (Avi's set + "Second Opinion"),
// each with a real starter persona so 2d is never a blank box. These mirror
// the role-specialisation discipline of the upstream council but are fully
// user-editable here.
export const DEFAULT_POSITIONS: CouncilPosition[] = [
  {
    id: "best-practice",
    title: "Best-Practice Advisor",
    description:
      "You are the Best-Practice Advisor. Evaluate the question against established, widely-accepted industry best practices and conventions. Cite the principle behind each recommendation. Flag where the proposed approach diverges from the norm and whether that divergence is justified.",
    builtin: true,
    upvotes: 0,
    downvotes: 0,
  },
  {
    id: "second-opinion",
    title: "Second Opinion",
    description:
      "You are the Second Opinion. Independently answer the question without anchoring on any obvious or leading answer. Where you agree with the likely consensus, say why; where you differ, make the strongest case for the alternative. Surface at least one consideration others would miss.",
    builtin: true,
    upvotes: 0,
    downvotes: 0,
  },
  {
    id: "senior-architect",
    title: "Senior Architect",
    description:
      "You are the Senior Architect. Focus on system design, structure, separation of concerns, scalability, and long-term maintainability. Identify architectural risks and trade-offs. Prefer designs that are simple, composable, and reversible over clever ones.",
    builtin: true,
    upvotes: 0,
    downvotes: 0,
  },
  {
    id: "senior-uiux",
    title: "Senior UI/UX",
    description:
      "You are the Senior UI/UX advisor. Evaluate from the end-user's perspective: clarity, discoverability, accessibility (a11y), consistency, and friction. Call out confusing flows and propose concrete, user-friendly alternatives. Champion the user who is not in the room.",
    builtin: true,
    upvotes: 0,
    downvotes: 0,
  },
  {
    id: "senior-security",
    title: "Senior Security Advisor",
    description:
      "You are the Senior Security Advisor. Map the threat surface: authentication, authorization, data exposure, injection, secrets handling, and supply chain. Rate each material risk by likelihood x severity and call out anything irreversible or catastrophic. Recommend the cheapest mitigation that closes the real risk.",
    builtin: true,
    upvotes: 0,
    downvotes: 0,
  },
  {
    id: "senior-coder",
    title: "Senior Coder",
    description:
      "You are the Senior Coder. Focus on correctness, edge cases, readability, and idiomatic implementation. Point to the specific lines or functions that matter. Prefer the smallest change that fixes the root cause, and name the failure modes a fix must handle.",
    builtin: true,
    upvotes: 0,
    downvotes: 0,
  },
  {
    id: "cto",
    title: "CTO",
    description:
      "You are the CTO. Weigh the decision against technical strategy, team capability, build-vs-buy, delivery risk, and total cost of ownership. Be decisive: state what you would do and the single most important reason. Distinguish one-way-door decisions from reversible ones.",
    builtin: true,
    upvotes: 0,
    downvotes: 0,
  },
  {
    id: "coo",
    title: "COO",
    description:
      "You are the COO. Focus on execution, operations, process, timeline, and resourcing. Identify what could derail delivery and the operational cost of each option. Translate the technical choice into business impact and a concrete next step.",
    builtin: true,
    upvotes: 0,
    downvotes: 0,
  },
];

// The recommended free-model panel, proven available on PAL. Members start
// unassigned; the user binds them to positions in the Council tab.
export const DEFAULT_MEMBERS: CouncilMember[] = [
  { id: "m-gptoss", model: "gpt-oss-120b", label: "GPT-OSS 120B", free: true, positionId: "senior-architect" },
  { id: "m-qwen", model: "qwen3-32b", label: "Qwen3 32B", free: true, positionId: "senior-coder" },
  { id: "m-flash", model: "gemini-2.5-flash", label: "Gemini 2.5 Flash", free: true, positionId: "second-opinion" },
  { id: "m-llama70", model: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", free: true, positionId: "senior-security" },
];

export const CHAIRMAN_DEFAULT = "opus-4.8";

function defaultConfig(): CouncilConfig {
  return {
    version: 1,
    chairman: CHAIRMAN_DEFAULT,
    members: DEFAULT_MEMBERS.map((m) => ({ ...m })),
    positions: DEFAULT_POSITIONS.map((p) => ({ ...p })),
  };
}

// ---- Storage ---------------------------------------------------------------

function councilFile(profile?: string): string {
  const { home } = profilePaths(profile);
  return join(home, "council-config.json");
}

/** Read the council config, seeding defaults on first run or on a corrupt file. */
export function getCouncilConfig(profile?: string): CouncilConfig {
  const file = councilFile(profile);
  if (!existsSync(file)) return defaultConfig();
  try {
    const raw = JSON.parse(readFileSync(file, "utf-8")) as Partial<CouncilConfig>;
    // Defensive merge: never trust the file to be complete.
    return {
      version: typeof raw.version === "number" ? raw.version : 1,
      chairman: raw.chairman || CHAIRMAN_DEFAULT,
      members: Array.isArray(raw.members) ? (raw.members as CouncilMember[]) : [],
      positions: Array.isArray(raw.positions)
        ? (raw.positions as CouncilPosition[])
        : DEFAULT_POSITIONS.map((p) => ({ ...p })),
    };
  } catch {
    // Corrupt JSON → fall back to defaults rather than throwing into the UI.
    return defaultConfig();
  }
}

export function saveCouncilConfig(cfg: CouncilConfig, profile?: string): void {
  safeWriteFile(councilFile(profile), JSON.stringify(cfg, null, 2) + "\n");
}

export function resetCouncilConfig(profile?: string): CouncilConfig {
  const cfg = defaultConfig();
  saveCouncilConfig(cfg, profile);
  return cfg;
}

// ---- Mutations (each returns the updated config) ---------------------------

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function addCouncilMember(
  member: { model: string; label?: string; free?: boolean; positionId?: string | null },
  profile?: string,
): CouncilConfig {
  const cfg = getCouncilConfig(profile);
  // De-dupe by model id — one enrolment per model.
  if (!cfg.members.some((m) => m.model === member.model)) {
    cfg.members.push({
      id: uid("m"),
      model: member.model,
      label: member.label || member.model,
      free: member.free ?? false,
      positionId: member.positionId ?? null,
    });
    saveCouncilConfig(cfg, profile);
  }
  return cfg;
}

export function removeCouncilMember(memberId: string, profile?: string): CouncilConfig {
  const cfg = getCouncilConfig(profile);
  cfg.members = cfg.members.filter((m) => m.id !== memberId);
  saveCouncilConfig(cfg, profile);
  return cfg;
}

export function assignMemberPosition(
  memberId: string,
  positionId: string | null,
  profile?: string,
): CouncilConfig {
  const cfg = getCouncilConfig(profile);
  const m = cfg.members.find((x) => x.id === memberId);
  if (m) {
    m.positionId = positionId;
    saveCouncilConfig(cfg, profile);
  }
  return cfg;
}

export function setChairman(model: string, profile?: string): CouncilConfig {
  const cfg = getCouncilConfig(profile);
  cfg.chairman = model || CHAIRMAN_DEFAULT;
  saveCouncilConfig(cfg, profile);
  return cfg;
}

export function upsertPosition(
  pos: { id?: string; title: string; description: string },
  profile?: string,
): CouncilConfig {
  const cfg = getCouncilConfig(profile);
  if (pos.id) {
    const existing = cfg.positions.find((p) => p.id === pos.id);
    if (existing) {
      existing.title = pos.title;
      existing.description = pos.description;
      // A manual edit clears any pending self-learning proposal.
      existing.proposedDescription = undefined;
    }
  } else {
    cfg.positions.push({
      id: uid("pos"),
      title: pos.title,
      description: pos.description,
      builtin: false,
      upvotes: 0,
      downvotes: 0,
    });
  }
  saveCouncilConfig(cfg, profile);
  return cfg;
}

export function deletePosition(positionId: string, profile?: string): CouncilConfig {
  const cfg = getCouncilConfig(profile);
  const pos = cfg.positions.find((p) => p.id === positionId);
  // Built-in seats are protected from deletion (still editable).
  if (pos && !pos.builtin) {
    cfg.positions = cfg.positions.filter((p) => p.id !== positionId);
    // Unbind any members that filled it.
    for (const m of cfg.members) if (m.positionId === positionId) m.positionId = null;
    saveCouncilConfig(cfg, profile);
  }
  return cfg;
}

/** Record a thumbs up/down against a position. Feeds the self-learning loop:
 *  the agent reads these tallies to propose a refined description. */
export function recordPositionFeedback(
  positionId: string,
  vote: "up" | "down",
  profile?: string,
): CouncilConfig {
  const cfg = getCouncilConfig(profile);
  const pos = cfg.positions.find((p) => p.id === positionId);
  if (pos) {
    if (vote === "up") pos.upvotes += 1;
    else pos.downvotes += 1;
    saveCouncilConfig(cfg, profile);
  }
  return cfg;
}

/** Stage an agent-proposed description refinement for the user to accept. */
export function proposePositionDescription(
  positionId: string,
  proposed: string,
  profile?: string,
): CouncilConfig {
  const cfg = getCouncilConfig(profile);
  const pos = cfg.positions.find((p) => p.id === positionId);
  if (pos) {
    pos.proposedDescription = proposed;
    saveCouncilConfig(cfg, profile);
  }
  return cfg;
}

/** Accept (or reject) a staged description refinement. */
export function resolveProposedDescription(
  positionId: string,
  accept: boolean,
  profile?: string,
): CouncilConfig {
  const cfg = getCouncilConfig(profile);
  const pos = cfg.positions.find((p) => p.id === positionId);
  if (pos && pos.proposedDescription) {
    if (accept) pos.description = pos.proposedDescription;
    pos.proposedDescription = undefined;
    // Reset the tally after a learning cycle so the next refinement is fresh.
    pos.upvotes = 0;
    pos.downvotes = 0;
    saveCouncilConfig(cfg, profile);
  }
  return cfg;
}
