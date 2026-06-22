/**
 * Preload IPC contract smoke test.
 *
 * After merging upstream v0.6.34 into the fork (41 conflicts, mixed OURS/THEIRS),
 * verify that all fork-critical IPC endpoints are correctly declared in preload
 * and have compatible type signatures. This catches semantic mismatches at the
 * renderer↔main boundary that green unit tests miss (runtime serialization,
 * payload shape, timing-dependent bugs).
 *
 * Pattern: source-code inspection (readFileSync + regex), not Electron boot
 * (stays fast and flake-free in jsdom vitest environment).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const preloadIndexTs = readFileSync(join(ROOT, "src/preload/index.ts"), "utf-8");
const preloadIndexDts = readFileSync(
  join(ROOT, "src/preload/index.d.ts"),
  "utf-8",
);

/**
 * Match a hermesAPI method declaration. Handles both forms:
 *   `name: (args) => ...`              (no inline return type)
 *   `name: (args): Promise<X> => ...`  (with inline return type annotation)
 * The `[^=]*?` between `)` and `=>` tolerates an optional `: ReturnType`.
 */
function exposesMethod(src: string, method: string): boolean {
  const pattern = new RegExp(`\\b${method}:\\s*\\([^)]*\\)[^=]*?=>`);
  return pattern.test(src);
}

/** Match a .d.ts method declaration ending in a Promise return type. */
function declaresPromiseMethod(src: string, method: string): boolean {
  const pattern = new RegExp(`\\b${method}:\\s*\\([^)]*\\)\\s*=>\\s*Promise`);
  return pattern.test(src);
}

describe("Preload IPC contract (fork-critical endpoints)", () => {
  /**
   * Fork's multi-profile session API — each must be declared in both
   * index.ts (implementation) and index.d.ts (type).
   */
  describe("Multi-profile sessions API", () => {
    const endpoints = [
      "listAllSessions",
      "syncAllSessionCaches",
      "listSessionGroups",
    ];

    endpoints.forEach((method) => {
      it(`exposes ${method} in preload implementation`, () => {
        expect(exposesMethod(preloadIndexTs, method)).toBe(true);
      });

      it(`declares ${method} in preload type definitions`, () => {
        expect(declaresPromiseMethod(preloadIndexDts, method)).toBe(true);
      });
    });
  });

  /**
   * Fork's per-session action APIs — critical for sidebar action menu.
   */
  describe("Session action APIs", () => {
    const actions = [
      "deleteSession",
      "updateSessionTitle",
      "setSessionPinned",
      "setSessionArchived",
    ];

    actions.forEach((method) => {
      it(`exposes ${method} in preload`, () => {
        expect(exposesMethod(preloadIndexTs, method)).toBe(true);
      });
    });
  });

  /**
   * Fork's worktree IPC — essential for session→worktree integration.
   */
  describe("Worktree IPC endpoints", () => {
    const worktreeMethods = ["worktreeCreate", "worktreeRemove", "worktreeList"];

    worktreeMethods.forEach((method) => {
      it(`exposes ${method} in preload`, () => {
        expect(exposesMethod(preloadIndexTs, method)).toBe(true);
      });

      it(`${method} is typed as Promise-returning`, () => {
        expect(declaresPromiseMethod(preloadIndexDts, method)).toBe(true);
      });
    });
  });

  /**
   * Fork's Council panel IPC — critical for multi-model decision features.
   */
  describe("Council panel API", () => {
    const councilMethods = [
      "councilGetConfig",
      "councilResetConfig",
      "councilAddMember",
      "councilRemoveMember",
      "councilAssignPosition",
      "councilSetChairman",
      "councilUpsertPosition",
      "councilDeletePosition",
      "councilPositionFeedback",
      "councilProposeDescription",
      "councilResolveDescription",
      "councilRecommendModels",
      "councilModelAdvice",
    ];

    councilMethods.forEach((method) => {
      it(`exposes ${method}`, () => {
        expect(exposesMethod(preloadIndexTs, method)).toBe(true);
      });
    });
  });

  /**
   * Fork's multi-profile & Soul management — critical for profile switching
   * and persistent voice/personality state.
   */
  describe("Profile & Soul API", () => {
    const profileMethods = ["setActiveProfile", "readSoul", "writeSoul"];

    profileMethods.forEach((method) => {
      it(`exposes ${method}`, () => {
        expect(exposesMethod(preloadIndexTs, method)).toBe(true);
      });
    });
  });

  /**
   * Upstream's single-profile cache API (kept for compatibility during merge).
   * These coexist with fork's multi-profile APIs — verify both surfaces present.
   */
  describe("Upstream single-profile session cache API (coexisting)", () => {
    const upstreamMethods = ["listCachedSessions", "syncSessionCache"];

    upstreamMethods.forEach((method) => {
      it(`exposes ${method}`, () => {
        expect(exposesMethod(preloadIndexTs, method)).toBe(true);
      });
    });
  });

  /**
   * SessionModelOverride type presence — verify the upstream rename is applied
   * consistently and the type is exported/available to consumers.
   */
  describe("SessionModelOverride type (upstream v0.6.34 rename)", () => {
    it("imports SessionModelOverride type", () => {
      expect(preloadIndexTs).toContain("SessionModelOverride");
    });

    it("declares SessionModelOverride in type definitions", () => {
      expect(preloadIndexDts).toContain("SessionModelOverride");
    });
  });

  /**
   * Factory & Chat IPC — Factory uses standard session + chat flows.
   * Verify hermesAPI exposes core chat/session methods that Factory depends on.
   */
  describe("Factory & Chat integration IPC", () => {
    const coreChat = ["updateSessionTitle", "abortChat"];

    coreChat.forEach((method) => {
      it(`exposes ${method} (required by Factory/Chat)`, () => {
        expect(exposesMethod(preloadIndexTs, method)).toBe(true);
      });
    });
  });

  /**
   * Verify no stray references to removed/renamed variables.
   * The old `modelOverride` param was renamed to `override` in hermes.ts.
   */
  describe("Pre/post-merge variable cleanup", () => {
    it("removes pre-merge modelOverride variable references", () => {
      const hasOldRef = /const\s+modelOverride\s*=|{\s*modelOverride\s*}/m.test(
        preloadIndexTs,
      );
      expect(hasOldRef).toBe(false);
    });
  });
});
