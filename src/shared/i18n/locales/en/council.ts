export default {
  tabTitle: "LLM Council",
  loading: "Loading council…",
  intro:
    "Assemble a panel of models, each in a named position, that debate a question — then the chairman (Opus 4.8, the running agent) synthesizes one answer. Convene it from the chat composer's Council button.",
  costChip: "{{free}} free · {{paid}} paid",
  // Chairman
  chairmanTitle: "Chairman / Orchestrator",
  chairmanHint:
    "The chairman runs the panel and synthesizes the final answer. Default is the running Hermes agent (Opus 4.8) — no extra cost.",
  chairmanDefault: "Opus 4.8 (running agent — recommended)",
  // Members
  membersTitle: "Panel Members",
  addMember: "Add Member",
  modelPlaceholder: "Model id, e.g. gpt-oss-120b",
  noMembers: "No members yet. Add models to fill the council seats.",
  position: "Position",
  unassigned: "— Unassigned (bench) —",
  free: "free",
  paid: "paid",
  memberAdded: "Added {{model}} to the council",
  // Positions
  positionsTitle: "Positions",
  positionsHint:
    "Each position is a persona handed to its model as a system prompt. Built-in positions can be edited but not deleted. Thumbs up/down trains a self-learning description refinement.",
  addPosition: "Add Position",
  editPosition: "Edit Position",
  builtin: "built-in",
  positionName: "Position name",
  positionNamePlaceholder: "e.g. Senior Database Advisor",
  positionDesc: "Description / persona",
  positionDescPlaceholder:
    "You are the … on an LLM Council. Your job is to …",
  positionDescHint:
    "This text is the system prompt the seat's model receives. Be specific about the vantage point and what to surface.",
  positionSaved: "Position saved",
  voteUp: "Helpful — reinforce this persona",
  voteDown: "Off — this persona needs work",
  learnHint: "Feedback trains a refined description the agent proposes.",
  proposedLabel: "Suggested refinement",
  accept: "Accept",
  reject: "Reject",
  // Advisor
  advisorTitle: "Model Advisor — best model for the job",
  advisorHint:
    "Rank the model pool for a task. Accuracy and speed are shown as tiers (refined by your feedback), never as fabricated percentages. Free models are preferred by default.",
  recommend: "Recommend",
  preferFree: "Prefer free",
  bestPick: "Best pick",
  accuracy: "Accuracy",
  accuracyTier: "Accuracy tier (learning — refined by feedback)",
  speedTier: "Speed tier (seed estimate; refined by measured runs)",
  addToCouncil: "Add to council",
  task: {
    architecture: "Architecture & design",
    coding: "Coding",
    security: "Security review",
    uiux: "UI / UX",
    "quick-check": "Quick sanity check",
    research: "Research & analysis",
    general: "General",
  },
  tier: {
    excellent: "Excellent",
    strong: "Strong",
    fair: "Fair",
    basic: "Basic",
  },
  speed: {
    blazing: "Blazing",
    fast: "Fast",
    moderate: "Moderate",
    slow: "Slow",
  },
  resetAll: "Reset council to defaults",
  resetDone: "Council reset to defaults",
};
