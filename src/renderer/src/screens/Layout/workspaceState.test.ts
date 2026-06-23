import { afterEach, describe, expect, it } from "vitest";
import {
  saveWorkspace,
  loadWorkspace,
  clearWorkspace,
} from "./workspaceState";
import type { ChatRun } from "./chatRuns";

const WORKSPACE_KEY = "hermes.workspace.v1";

function run(partial: Partial<ChatRun> & { runId: string }): ChatRun {
  return {
    profile: "default",
    sessionId: null,
    loading: false,
    ...partial,
  };
}

describe("workspaceState", () => {
  afterEach(() => {
    clearWorkspace();
  });

  it("round-trips open tabs, active tab, and view", () => {
    const runs: ChatRun[] = [
      run({ runId: "r1", sessionId: "s1", profile: "default", title: "Hi" }),
      run({ runId: "r2", sessionId: "s2", profile: "work", title: "Work" }),
    ];
    saveWorkspace(runs, "r2", "sessions");
    const got = loadWorkspace();
    expect(got).not.toBeNull();
    expect(got!.tabs).toHaveLength(2);
    expect(got!.tabs[0]).toMatchObject({ sessionId: "s1", profile: "default" });
    expect(got!.activeSessionId).toBe("s2");
    expect(got!.view).toBe("sessions");
  });

  it("skips blank scratch runs (no sessionId)", () => {
    const runs: ChatRun[] = [
      run({ runId: "r1", sessionId: "s1", profile: "default" }),
      run({ runId: "r2", sessionId: null, profile: "default" }), // scratch
    ];
    saveWorkspace(runs, "r1", "chat");
    const got = loadWorkspace();
    expect(got!.tabs).toHaveLength(1);
    expect(got!.tabs[0].sessionId).toBe("s1");
  });

  it("records null activeSessionId when the active run has no session", () => {
    const runs: ChatRun[] = [
      run({ runId: "r1", sessionId: "s1", profile: "default" }),
      run({ runId: "r2", sessionId: null, profile: "default" }),
    ];
    saveWorkspace(runs, "r2", "chat"); // active run is the scratch one
    const got = loadWorkspace();
    expect(got!.activeSessionId).toBeNull();
  });

  it("returns null when nothing was saved", () => {
    expect(loadWorkspace()).toBeNull();
  });

  it("degrades to null on a corrupt blob (never throws)", () => {
    localStorage.setItem(WORKSPACE_KEY, "not valid json {{{");
    expect(loadWorkspace()).toBeNull();
  });

  it("ignores a forward-incompatible version", () => {
    localStorage.setItem(
      WORKSPACE_KEY,
      JSON.stringify({ version: 999, tabs: [{ sessionId: "s1", profile: "x" }] }),
    );
    expect(loadWorkspace()).toBeNull();
  });

  it("filters out malformed tab entries defensively", () => {
    localStorage.setItem(
      WORKSPACE_KEY,
      JSON.stringify({
        version: 1,
        savedAt: 1,
        tabs: [
          { sessionId: "ok", profile: "default" },
          { sessionId: 123, profile: "default" }, // bad sessionId type
          { profile: "default" }, // missing sessionId
          null,
        ],
        activeSessionId: "ok",
        view: "chat",
      }),
    );
    const got = loadWorkspace();
    expect(got!.tabs).toHaveLength(1);
    expect(got!.tabs[0].sessionId).toBe("ok");
  });

  it("caps the number of restored tabs", () => {
    const runs: ChatRun[] = Array.from({ length: 30 }, (_, i) =>
      run({ runId: `r${i}`, sessionId: `s${i}`, profile: "default" }),
    );
    saveWorkspace(runs, "r0", "chat");
    const got = loadWorkspace();
    expect(got!.tabs.length).toBeLessThanOrEqual(20);
  });

  it("clearWorkspace removes the persisted state", () => {
    saveWorkspace([run({ runId: "r1", sessionId: "s1" })], "r1", "chat");
    expect(loadWorkspace()).not.toBeNull();
    clearWorkspace();
    expect(loadWorkspace()).toBeNull();
  });
});
