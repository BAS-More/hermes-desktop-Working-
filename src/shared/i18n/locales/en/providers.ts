export default {
  title: "Providers",
  subtitle: "Configure LLM providers, API keys, and credential pools",
  oauth: {
    sectionTitle: "Subscription / OAuth Plans",
    sectionHint:
      "Sign in with a provider subscription instead of an API key. Authorization happens in your browser.",
    signIn: "Sign in",
    addAccount: "Add account",
    accountsConnected_one: "{{count}} connected",
    accountsConnected_other: "{{count}} connected",
    rotationHint:
      "Hermes rotates between connected accounts automatically and skips any that are rate-limited. Add more accounts to raise your effective limit.",
    runningHint: "Follow the steps below to finish signing in.",
    successHint: "Signed in successfully. You can now select this provider.",
    failed: "Sign-in failed.",
    codexDesc: "Use your ChatGPT Codex plan",
    xaiDesc: "Use your xAI Grok subscription",
    qwenDesc: "Use your Qwen subscription",
    geminiDesc: "Use your Google AI Pro / Gemini plan",
    minimaxDesc: "Use your MiniMax subscription",
    nousDesc: "Sign in with your Nous Portal subscription",
    anthropicDesc:
      "Sign in with your Claude Pro/Max subscription. Authorize in the browser, then paste the code shown.",
  },
} as const;
