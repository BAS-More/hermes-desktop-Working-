/**
 * Phase 5 contract test — deep links, CI status, @mention (pure).
 * Encodes tests/specs/p5-models.feature. Imports not-yet-written
 * src/shared/p5-models.ts (TDAD red).
 */
import { describe, it, expect } from "vitest";
import {
  parseDeepLink,
  ciSummary,
  canAutoMerge,
  shouldAutoFix,
  parseMentionQuery,
  filterMentionCandidates,
  type CiCheck,
} from "../src/shared/p5-models";

describe("parseDeepLink", () => {
  it("parses cwd, repo and a decoded multi-line prompt", () => {
    const r = parseDeepLink(
      "hermes://open?cwd=/home/me/app&repo=acme/api&q=fix%20the%20deploy%0Acheck%20logs",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.action).toBe("open");
    expect(r.cwd).toBe("/home/me/app");
    expect(r.repo).toBe("acme/api");
    expect(r.prompt).toContain("deploy\ncheck");
  });

  it("rejects a non-hermes scheme", () => {
    expect(parseDeepLink("https://evil.example.com/open?q=x").ok).toBe(false);
  });

  it("rejects a UNC / network cwd", () => {
    expect(parseDeepLink("hermes://open?cwd=" + encodeURIComponent("\\\\server\\share")).ok).toBe(
      false,
    );
    expect(parseDeepLink("hermes://open?cwd=" + encodeURIComponent("//server/share")).ok).toBe(
      false,
    );
  });

  it("rejects a malformed repo", () => {
    expect(parseDeepLink("hermes://open?repo=not-a-repo").ok).toBe(false);
  });

  it("rejects a prompt longer than 5000 chars", () => {
    const big = "a".repeat(6000);
    expect(parseDeepLink("hermes://open?q=" + big).ok).toBe(false);
  });

  it("rejects empty / garbage input without throwing", () => {
    expect(parseDeepLink("").ok).toBe(false);
    expect(parseDeepLink("::::").ok).toBe(false);
    expect(parseDeepLink(undefined as unknown as string).ok).toBe(false);
  });
});

function check(
  status: CiCheck["status"],
  conclusion?: CiCheck["conclusion"],
): CiCheck {
  return { name: "t", status, conclusion };
}

describe("ciSummary", () => {
  it("all completed successes -> passing", () => {
    expect(
      ciSummary([check("completed", "success"), check("completed", "success")])
        .state,
    ).toBe("passing");
  });

  it("one failure -> failing", () => {
    expect(
      ciSummary([check("completed", "success"), check("completed", "failure")])
        .state,
    ).toBe("failing");
  });

  it("any incomplete -> pending", () => {
    expect(
      ciSummary([check("completed", "success"), check("in_progress")]).state,
    ).toBe("pending");
  });

  it("counts passed/failed/pending", () => {
    const s = ciSummary([
      check("completed", "success"),
      check("completed", "failure"),
      check("queued"),
    ]);
    expect([s.passed, s.failed, s.pending]).toEqual([1, 1, 1]);
  });
});

describe("auto-merge / auto-fix gates", () => {
  const passing = ciSummary([check("completed", "success")]);
  const failing = ciSummary([check("completed", "failure")]);

  it("auto-merge only when passing AND enabled", () => {
    expect(canAutoMerge(passing, { autoMergeEnabled: true })).toBe(true);
    expect(canAutoMerge(passing, { autoMergeEnabled: false })).toBe(false);
    expect(canAutoMerge(failing, { autoMergeEnabled: true })).toBe(false);
  });

  it("auto-fix only when failing AND enabled", () => {
    expect(shouldAutoFix(failing, { autoFixEnabled: true })).toBe(true);
    expect(shouldAutoFix(passing, { autoFixEnabled: true })).toBe(false);
    expect(shouldAutoFix(failing, { autoFixEnabled: false })).toBe(false);
  });
});

describe("parseMentionQuery", () => {
  it("is active mid @foo at the caret", () => {
    const text = "see @comp";
    const r = parseMentionQuery(text, text.length);
    expect(r.active).toBe(true);
    expect(r.query).toBe("comp");
    expect(r.start).toBe(4);
  });

  it("is not active after a space", () => {
    const text = "see @comp done";
    expect(parseMentionQuery(text, text.length).active).toBe(false);
  });

  it("handles a caret out of range without throwing", () => {
    expect(parseMentionQuery("hi", 999).active).toBe(false);
    expect(parseMentionQuery("", 0).active).toBe(false);
  });
});

describe("filterMentionCandidates", () => {
  it("ranks prefix matches before mid-path substring matches", () => {
    const files = [
      "components/Button.tsx",
      "src/MyComp.tsx",
      "x/comp.ts",
    ];
    const out = filterMentionCandidates(files, "comp", 8);
    // "x/comp.ts" basename starts with comp -> prefix; should rank above MyComp substring
    expect(out.indexOf("x/comp.ts")).toBeLessThan(out.indexOf("src/MyComp.tsx"));
  });

  it("is case-insensitive and respects the limit", () => {
    const files = Array.from({ length: 20 }, (_, i) => `comp${i}.ts`);
    const out = filterMentionCandidates(files, "COMP", 8);
    expect(out.length).toBe(8);
  });
});
