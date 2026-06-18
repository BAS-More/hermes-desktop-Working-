// Shared LLM Council types — used by the main-process store
// (src/main/council-config.ts), the advisor (src/main/council-advisor.ts),
// the preload bridge (src/preload/index.ts + index.d.ts), and the renderer
// (screens/Models, screens/Chat). Type-only; no runtime code so importing it
// into the preload bundle stays side-effect-free.

export interface CouncilPosition {
  id: string;
  /** Display title, e.g. "Senior Security Advisor". */
  title: string;
  /** Persona / instruction used as the seat's system prompt when convening. */
  description: string;
  /** Built-in seats are protected from deletion (still editable). */
  builtin: boolean;
  /** Feedback tally driving the self-learning description refinement. */
  upvotes: number;
  downvotes: number;
  /** A pending description the agent proposed from feedback; user accepts/rejects. */
  proposedDescription?: string;
}

export interface CouncilMember {
  id: string;
  /** PAL model id, e.g. "gpt-oss-120b", "gemini-2.5-flash". */
  model: string;
  /** Human label shown in the UI; defaults to the model id. */
  label: string;
  /** Whether the model is free (panel) or paid. Drives the cost badge. */
  free: boolean;
  /** Position id this member fills (or null if unassigned / bench). */
  positionId: string | null;
}

export interface CouncilConfig {
  version: number;
  /** Chairman / orchestrator model id. Default "opus-4.8" = the running agent. */
  chairman: string;
  members: CouncilMember[];
  positions: CouncilPosition[];
}

export type CouncilTier = "excellent" | "strong" | "fair" | "basic";
export type CouncilSpeedTier = "blazing" | "fast" | "moderate" | "slow";

export interface CouncilModelAdvice {
  model: string;
  label: string;
  free: boolean;
  accuracy: CouncilTier;
  speed: CouncilSpeedTier;
  /** Rough context window (tokens) for display. */
  contextK: number;
  /** One-line "what it's good at" used in the reasoning blurb. */
  strength: string;
}

export interface CouncilAdviceResult extends CouncilModelAdvice {
  /** 0..1 fit score for the requested task. */
  score: number;
  /** Human-readable reasoning for why this model fits. */
  reason: string;
}
