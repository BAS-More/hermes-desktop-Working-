// Council model advisor metadata — powers the "best model for the job" panel
// (item 2e). Provides, per model: a speed tier, an accuracy/quality tier, and
// a free/paid flag, plus a small recommender that ranks the pool for a task.
//
// HONESTY NOTE: accuracy and speed are presented as TIERS, never as fabricated
// percentages. The seed tiers below are a maintained heuristic; the live UI
// further annotates speed with MEASURED latency from real council runs when
// available, and the accuracy tier is nudged by the user's thumbs up/down
// we never invent a precise number we can't back.

import type {
  CouncilTier as Tier,
  CouncilSpeedTier as SpeedTier,
  CouncilModelAdvice as ModelAdvice,
  CouncilAdviceResult as AdviceResult,
} from "../shared/council";

export type { Tier, SpeedTier, ModelAdvice, AdviceResult };

// Seed catalog drawn from PAL's live roster (listmodels). Free = no per-token
// cost to the user (Groq free tier / Google free tier / open-weight). Paid =
// metered cloud (OpenAI, Anthropic, premium Gemini/Grok via OpenRouter).
export const MODEL_ADVICE: ModelAdvice[] = [
  // ---- Free panel models -------------------------------------------------
  {
    model: "gpt-oss-120b",
    label: "GPT-OSS 120B",
    free: true,
    accuracy: "strong",
    speed: "fast",
    contextK: 131,
    strength: "large open reasoning model; strong structured analysis and architecture",
  },
  {
    model: "qwen3-32b",
    label: "Qwen3 32B",
    free: true,
    accuracy: "strong",
    speed: "fast",
    contextK: 131,
    strength: "strong reasoning + coding for a free model",
  },
  {
    model: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    free: true,
    accuracy: "strong",
    speed: "blazing",
    contextK: 1000,
    strength: "very fast, huge 1M context, thinking mode — great quick second opinion",
  },
  {
    model: "llama-3.3-70b-versatile",
    label: "Llama 3.3 70B",
    free: true,
    accuracy: "strong",
    speed: "fast",
    contextK: 131,
    strength: "solid general-purpose critical analysis, Groq-fast",
  },
  {
    model: "llama-3.1-8b-instant",
    label: "Llama 3.1 8B Instant",
    free: true,
    accuracy: "fair",
    speed: "blazing",
    contextK: 131,
    strength: "near-instant lightweight takes; best for quick sanity checks",
  },
  {
    model: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    free: true,
    accuracy: "excellent",
    speed: "moderate",
    contextK: 1000,
    strength: "deep reasoning, 1M context — heavyweight free analysis",
  },
  // ---- Paid models (advisor surfaces these clearly badged) ---------------
  {
    model: "gemini-3-pro-preview",
    label: "Gemini 3 Pro",
    free: false,
    accuracy: "excellent",
    speed: "moderate",
    contextK: 1000,
    strength: "frontier reasoning + thinking, 1M context",
  },
  {
    model: "gpt-5.2",
    label: "GPT-5.2",
    free: false,
    accuracy: "excellent",
    speed: "moderate",
    contextK: 400,
    strength: "flagship reasoning with configurable thinking effort + vision",
  },
  {
    model: "gpt-5.1-codex",
    label: "GPT-5.1 Codex",
    free: false,
    accuracy: "excellent",
    speed: "moderate",
    contextK: 400,
    strength: "agentic coding specialization — best for deep code tasks",
  },
  {
    model: "x-ai/grok-4.1-fast",
    label: "Grok 4.1 Fast",
    free: false,
    accuracy: "strong",
    speed: "fast",
    contextK: 2000,
    strength: "huge 2M context, fast thinking",
  },
  {
    model: "anthropic/claude-opus-4.5",
    label: "Claude Opus 4.5",
    free: false,
    accuracy: "excellent",
    speed: "moderate",
    contextK: 200,
    strength: "top-tier synthesis & judgement — ideal chairman/orchestrator",
  },
];

// Task-kind → which strengths to favour. Used by the recommender to bias the
// ranking. Keys are deliberately broad and match the Council tab's task picker.
const TASK_BIAS: Record<string, { accuracy: number; speed: number; keywords: string[] }> = {
  architecture: { accuracy: 0.8, speed: 0.2, keywords: ["architecture", "reasoning", "design"] },
  coding: { accuracy: 0.7, speed: 0.3, keywords: ["coding", "code"] },
  security: { accuracy: 0.85, speed: 0.15, keywords: ["analysis", "reasoning"] },
  uiux: { accuracy: 0.6, speed: 0.4, keywords: ["reasoning", "context"] },
  "quick-check": { accuracy: 0.3, speed: 0.7, keywords: ["fast", "instant", "quick"] },
  research: { accuracy: 0.8, speed: 0.2, keywords: ["context", "reasoning"] },
  general: { accuracy: 0.6, speed: 0.4, keywords: ["general", "reasoning"] },
};

const ACCURACY_SCORE: Record<Tier, number> = {
  excellent: 1.0,
  strong: 0.75,
  fair: 0.5,
  basic: 0.25,
};
const SPEED_SCORE: Record<SpeedTier, number> = {
  blazing: 1.0,
  fast: 0.75,
  moderate: 0.5,
  slow: 0.25,
};

/**
 * Rank the model pool for a task kind. `preferFree` (default true) gently
 * boosts free models so the casual path stays $0; the user can flip it to see
 * paid frontier options. Returns the full ranked list (caller slices top-N).
 */
export function recommendModels(
  taskKind: string,
  opts: { preferFree?: boolean; pool?: ModelAdvice[] } = {},
): AdviceResult[] {
  const preferFree = opts.preferFree ?? true;
  const pool = opts.pool ?? MODEL_ADVICE;
  const bias = TASK_BIAS[taskKind] || TASK_BIAS.general;

  return pool
    .map((m) => {
      const acc = ACCURACY_SCORE[m.accuracy];
      const spd = SPEED_SCORE[m.speed];
      let score = acc * bias.accuracy + spd * bias.speed;
      // Keyword affinity: nudge models whose strength matches the task.
      const kwHit = bias.keywords.some((k) => m.strength.toLowerCase().includes(k));
      if (kwHit) score += 0.1;
      // Cost preference: small boost for free, small penalty for paid.
      if (preferFree) score += m.free ? 0.08 : -0.08;
      score = Math.max(0, Math.min(1, score));

      const cost = m.free ? "free" : "paid";
      const reason =
        `${m.label}: ${m.strength}. Accuracy ${m.accuracy}, speed ${m.speed}, ` +
        `${m.contextK >= 1000 ? `${m.contextK / 1000}M` : `${m.contextK}K`} context, ${cost}.`;
      return { ...m, score, reason };
    })
    .sort((a, b) => b.score - a.score);
}

/** Look up advice for a specific model id (exact, then loose contains match). */
export function adviceForModel(model: string): ModelAdvice | undefined {
  return (
    MODEL_ADVICE.find((m) => m.model === model) ||
    MODEL_ADVICE.find((m) => model.includes(m.model) || m.model.includes(model))
  );
}
