// Builds the "convene the LLM Council" instruction that the desktop submits
// through the normal chat pipeline. The running Hermes agent (Opus 4.8) reads
// this, calls PAL MCP once per seat (free models), then synthesizes as chairman.
//
// The desktop never calls PAL directly or holds any token — it just authors a
// precise instruction the agent fulfils with its existing MCP tools. This keeps
// the renderer thin and reuses 100% of the existing onSubmit contract.
import type { CouncilConfig } from "../../../../shared/council";

/**
 * Compose the convene prompt from the saved roster + the user's question.
 * Seats with a bound model become `mcp_pal_chat` calls carrying the position's
 * description as the stance; the agent then weighs and synthesizes.
 */
export function buildCouncilPrompt(
  cfg: CouncilConfig,
  question: string,
): string {
  // Resolve each filled seat: position title + persona + the model that holds it.
  const seats = cfg.members
    .filter((m) => m.positionId)
    .map((m) => {
      const pos = cfg.positions.find((p) => p.id === m.positionId);
      if (!pos) return null;
      return { title: pos.title, description: pos.description, model: m.model, free: m.free };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  const roster = seats
    .map(
      (s, i) =>
        `${i + 1}. **${s.title}** — model \`${s.model}\`${s.free ? " (free)" : " (paid)"}\n` +
        `   Persona: ${s.description}`,
    )
    .join("\n");

  const chairman = cfg.chairman || "opus-4.8";

  return [
    "# Convene the LLM Council",
    "",
    "Act as the **Chairman / orchestrator** of an LLM Council and produce a synthesized decision on the question below.",
    "",
    "## The question / topic",
    question.trim() || "(Use the most recent topic in this conversation.)",
    "",
    "## How to run the council (use the PAL MCP tools)",
    "For EACH seat below, call `mcp_pal_chat` with that seat's model and pass the seat persona as the system stance, asking the seat to answer the question from its specific vantage point. Run the seats, collect every opinion, then as Chairman synthesize.",
    "",
    "## The council roster",
    roster || "(No seats configured. Fall back to a sensible free-model panel and say so.)",
    "",
    `## Chairman / synthesis (you${chairman === "opus-4.8" ? " — Opus 4.8" : `: ${chairman}`})`,
    "After gathering the seats' opinions:",
    "1. **Fabrication check** — scan every cited fact/source; discard any that is invented or uncheckable, and say so.",
    "2. **Weigh by epistemic strength**, not by vote count — a single sound argument can outweigh the majority.",
    "3. Name the **leverage move** (the one insight/action that resolves the core disagreement) in one sentence.",
    "4. Name the **productive disagreement** in one sentence.",
    "5. End with a **clear, verb-initial recommended action**.",
    "",
    "## Output format",
    "Lead with **## Council Synthesis** (your decisive answer, ~300-450 words). Then a collapsed-friendly **## Seat opinions** section summarizing each seat in 2-3 sentences with its title and model. Be concise; depth goes in the reasoning, not the length.",
  ].join("\n");
}
