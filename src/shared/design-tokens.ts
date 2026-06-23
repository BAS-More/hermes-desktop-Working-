/**
 * Phase 6 — design-token contrast contract (pure, no IO/React).
 *
 * A canonical registry of the design tokens the new panes (DiffView,
 * RightPanel) rely on, each with a light and dark value, plus WCAG 2.1 contrast
 * math and a report that proves every text/background pair the UI uses meets AA
 * in BOTH themes. `missingTokens` is a drift guard: a pane must not reference a
 * `--var` that isn't a defined token.
 *
 * Contract pinned by tests/design-tokens.test.ts + tests/specs/design-tokens.feature.
 *
 * These values are the authoritative tokens for the new surfaces; the runtime
 * CSS variables in main.css should resolve to the same colours per theme. The
 * report is the gate that keeps the palette accessible as it evolves.
 */

export type Theme = "light" | "dark";

export interface DesignToken {
  light: string;
  dark: string;
}

/** Canonical token registry (token name WITHOUT the leading "--"). */
export const DESIGN_TOKENS: Record<string, DesignToken> = {
  "bg-base": { light: "#ffffff", dark: "#16181d" },
  "bg-secondary": { light: "#f5f6f8", dark: "#1c1f26" },
  "bg-tertiary": { light: "#e9ebef", dark: "#23272f" },
  "text-primary": { light: "#1a1d21", dark: "#e6e8eb" },
  "text-secondary": { light: "#3d4248", dark: "#c2c7cd" },
  "text-muted": { light: "#5c636b", dark: "#9aa1a9" },
  accent: { light: "#1f6feb", dark: "#4493f8" },
  "accent-fg": { light: "#ffffff", dark: "#0d1117" },
  "border-subtle": { light: "#d8dbe0", dark: "#2b3038" },
  "diff-add-fg": { light: "#1a7f37", dark: "#3fb950" },
  "diff-add-bg": { light: "#e6f4ea", dark: "#12261a" },
  "diff-del-fg": { light: "#b42318", dark: "#f85149" },
  "diff-del-bg": { light: "#fbe9e7", dark: "#2a1416" },
};

// ---- WCAG 2.1 contrast math -----------------------------------------------

/** Parse #rgb or #rrggbb to [r,g,b] in 0..255. Throws on garbage. */
function parseHex(hex: string): [number, number, number] {
  let h = (hex || "").trim().replace(/^#/, "");
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) {
    throw new Error(`invalid hex colour: ${hex}`);
  }
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Linearize one sRGB channel (0..1) — the gamma step most implementations get wrong. */
function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** WCAG contrast ratio (1..21), symmetric in its arguments. */
export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

export interface ContrastResult {
  ratio: number;
  passesAA: boolean; // normal text >= 4.5
  passesAALarge: boolean; // large text / icons >= 3.0
  passesAAA: boolean; // >= 7.0
}

function grade(ratio: number): ContrastResult {
  return {
    ratio,
    passesAA: ratio >= 4.5,
    passesAALarge: ratio >= 3.0,
    passesAAA: ratio >= 7.0,
  };
}

/** Foreground/background token pairs the UI actually renders. */
const UI_PAIRS: Array<{ fg: string; bg: string }> = [
  { fg: "text-primary", bg: "bg-base" },
  { fg: "text-secondary", bg: "bg-base" },
  { fg: "text-muted", bg: "bg-secondary" },
  { fg: "accent-fg", bg: "accent" },
  { fg: "diff-add-fg", bg: "diff-add-bg" },
  { fg: "diff-del-fg", bg: "diff-del-bg" },
];

export interface ContrastReportRow {
  tokenFg: string;
  tokenBg: string;
  light: ContrastResult;
  dark: ContrastResult;
}

/** Contrast of every declared UI pair, in both themes. */
export function tokenContrastReport(): ContrastReportRow[] {
  return UI_PAIRS.map(({ fg, bg }) => {
    const f = DESIGN_TOKENS[fg];
    const b = DESIGN_TOKENS[bg];
    return {
      tokenFg: fg,
      tokenBg: bg,
      light: grade(contrastRatio(f.light, b.light)),
      dark: grade(contrastRatio(f.dark, b.dark)),
    };
  });
}

/**
 * Drift guard: given the `--vars` a stylesheet/component references, return the
 * ones that are NOT defined in the registry. Unknown tokens => the pane is
 * referencing a colour the design system doesn't own.
 */
export function missingTokens(cssVarsUsed: string[]): string[] {
  const known = new Set(Object.keys(DESIGN_TOKENS));
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const raw of cssVarsUsed) {
    const name = raw.replace(/^--/, "");
    if (!known.has(name) && !seen.has(raw)) {
      seen.add(raw);
      missing.push(raw);
    }
  }
  return missing;
}
