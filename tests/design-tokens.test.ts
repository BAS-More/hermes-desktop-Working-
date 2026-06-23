/**
 * Phase 6 contract test — design-token contrast (pure WCAG math + registry).
 * Encodes tests/specs/design-tokens.feature. Imports the not-yet-written
 * src/shared/design-tokens.ts (TDAD red).
 */
import { describe, it, expect } from "vitest";
import {
  DESIGN_TOKENS,
  relativeLuminance,
  contrastRatio,
  tokenContrastReport,
  missingTokens,
} from "../src/shared/design-tokens";

describe("WCAG contrast math", () => {
  it("black on white is 21:1", () => {
    expect(Math.round(contrastRatio("#000000", "#ffffff"))).toBe(21);
  });

  it("relative luminance of pure white is 1", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
  });

  it("relative luminance of pure black is 0", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
  });

  it("parses 3-digit hex like 6-digit hex", () => {
    expect(Math.round(contrastRatio("#fff", "#000"))).toBe(21);
    expect(relativeLuminance("#fff")).toBeCloseTo(
      relativeLuminance("#ffffff"),
      5,
    );
  });

  it("is symmetric", () => {
    expect(contrastRatio("#123456", "#abcdef")).toBeCloseTo(
      contrastRatio("#abcdef", "#123456"),
      6,
    );
  });
});

describe("design-token registry", () => {
  it("is non-empty", () => {
    expect(Object.keys(DESIGN_TOKENS).length).toBeGreaterThan(0);
  });

  it("every token defines a non-empty light and dark value", () => {
    for (const [name, tok] of Object.entries(DESIGN_TOKENS)) {
      expect(tok.light, `${name}.light`).toBeTruthy();
      expect(tok.dark, `${name}.dark`).toBeTruthy();
    }
  });
});

describe("missingTokens drift guard", () => {
  it("flags a CSS var with no registry entry and ignores known ones", () => {
    const known = "--" + Object.keys(DESIGN_TOKENS)[0];
    const missing = missingTokens([known, "--not-a-real-token"]);
    expect(missing).toContain("--not-a-real-token");
    expect(missing).not.toContain(known);
  });

  it("returns nothing when all vars are known", () => {
    const all = Object.keys(DESIGN_TOKENS).map((k) => "--" + k);
    expect(missingTokens(all)).toEqual([]);
  });
});

describe("tokenContrastReport", () => {
  const report = tokenContrastReport();

  it("returns a non-empty list with light + dark results per row", () => {
    expect(report.length).toBeGreaterThan(0);
    for (const row of report) {
      expect(row.light).toHaveProperty("ratio");
      expect(row.light).toHaveProperty("passesAA");
      expect(row.dark).toHaveProperty("ratio");
      expect(row.dark).toHaveProperty("passesAA");
      expect(typeof row.tokenFg).toBe("string");
      expect(typeof row.tokenBg).toBe("string");
    }
  });

  it("marks the primary-text pair as AA-passing in both themes", () => {
    const primary = report.find(
      (r) => r.tokenFg === "text-primary" && r.tokenBg === "bg-base",
    );
    expect(primary, "expected a text-primary/bg-base row").toBeTruthy();
    expect(primary!.light.passesAA).toBe(true);
    expect(primary!.dark.passesAA).toBe(true);
  });

  it("computes ratios consistent with contrastRatio for each theme", () => {
    for (const row of report) {
      const fg = DESIGN_TOKENS[row.tokenFg];
      const bg = DESIGN_TOKENS[row.tokenBg];
      if (!fg || !bg) continue;
      expect(row.light.ratio).toBeCloseTo(contrastRatio(fg.light, bg.light), 4);
      expect(row.dark.ratio).toBeCloseTo(contrastRatio(fg.dark, bg.dark), 4);
    }
  });
});
