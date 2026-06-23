/**
 * Phase 4 contract test — preview model (pure). Encodes
 * tests/specs/preview-model.feature. Imports not-yet-written
 * src/shared/preview-model.ts (TDAD red).
 */
import { describe, it, expect } from "vitest";
import {
  previewPartition,
  classifyPreviewTarget,
  initialPreviewState,
  applyVerifyEvent,
  type PreviewState,
} from "../src/shared/preview-model";

describe("previewPartition", () => {
  it("is stable for the same project + persist flag", () => {
    expect(previewPartition("/home/me/proj-a", true)).toBe(
      previewPartition("/home/me/proj-a", true),
    );
  });

  it("differs only by a persist: prefix, same trailing hash", () => {
    const p = previewPartition("/home/me/proj-a", true);
    const e = previewPartition("/home/me/proj-a", false);
    expect(p.startsWith("persist:")).toBe(true);
    expect(e.startsWith("persist:")).toBe(false);
    expect(p.replace(/^persist:/, "")).toBe(e);
  });

  it("gives different projects different partitions", () => {
    expect(previewPartition("/home/me/proj-a", false)).not.toBe(
      previewPartition("/home/me/proj-b", false),
    );
  });

  it("yields a stable non-empty partition for an empty path", () => {
    const a = previewPartition("", false);
    expect(a.length).toBeGreaterThan("hermes-preview-".length);
    expect(a).toBe(previewPartition("", false));
  });
});

describe("classifyPreviewTarget", () => {
  it.each([
    ["https://localhost:3000", "web"],
    ["http://127.0.0.1:8080", "web"],
    ["report.pdf", "pdf"],
    ["index.html", "html"],
    ["page.htm", "html"],
    ["photo.PNG", "image"],
    ["pic.jpeg", "image"],
    ["clip.mp4", "video"],
    ["movie.webm", "video"],
    ["data.bin", "unknown"],
    ["", "unknown"],
    ["noextension", "unknown"],
  ])("classifies %s as %s", (target, kind) => {
    expect(classifyPreviewTarget(target)).toBe(kind);
  });
});

describe("applyVerifyEvent", () => {
  const running: PreviewState = { status: "running", lastChecks: [] };

  it("verify.start sets running and clears checks", () => {
    const passed: PreviewState = {
      status: "passed",
      lastChecks: [{ kind: "dom", ok: true }],
    };
    const out = applyVerifyEvent(passed, { type: "verify.start" });
    expect(out.status).toBe("running");
    expect(out.lastChecks).toEqual([]);
  });

  it("verify.check appends a check", () => {
    const out = applyVerifyEvent(running, {
      type: "verify.check",
      payload: { kind: "screenshot", ok: true },
    });
    expect(out.lastChecks).toHaveLength(1);
  });

  it("a failed check makes the overall verify failed", () => {
    const out = applyVerifyEvent(running, {
      type: "verify.check",
      payload: { kind: "dom", ok: false, detail: "missing #app" },
    });
    expect(out.status).toBe("failed");
  });

  it("verify.done with all checks ok -> passed", () => {
    let s = applyVerifyEvent(initialPreviewState(), { type: "verify.start" });
    s = applyVerifyEvent(s, { type: "verify.check", payload: { kind: "dom", ok: true } });
    s = applyVerifyEvent(s, {
      type: "verify.check",
      payload: { kind: "click", ok: true },
    });
    s = applyVerifyEvent(s, { type: "verify.done" });
    expect(s.status).toBe("passed");
  });

  it("verify.done after a failed check stays failed", () => {
    let s = applyVerifyEvent(initialPreviewState(), { type: "verify.start" });
    s = applyVerifyEvent(s, {
      type: "verify.check",
      payload: { kind: "fill", ok: false },
    });
    s = applyVerifyEvent(s, { type: "verify.done" });
    expect(s.status).toBe("failed");
  });

  it("ignores unknown events", () => {
    const out = applyVerifyEvent(running, {
      type: "bogus",
    } as unknown as Parameters<typeof applyVerifyEvent>[1]);
    expect(out).toEqual(running);
  });
});
