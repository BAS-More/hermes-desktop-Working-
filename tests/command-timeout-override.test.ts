// Verifies resolveCommandTimeoutMs() (via helperExecOptions) reads the env var
// at CALL time, not module load — the plumbing the secrets-spawn flake fix
// depends on. The win32-skipped real-spawn tests rely on this override taking
// effect, so pin it directly and cross-platform.
import { describe, it, expect, afterEach } from "vitest";
import { helperExecOptions } from "../src/main/secrets/commandProvider";

describe("command timeout env override", () => {
  afterEach(() => {
    delete process.env.HERMES_SECRET_COMMAND_TIMEOUT_MS;
  });

  it("defaults to 3000ms when env unset", () => {
    delete process.env.HERMES_SECRET_COMMAND_TIMEOUT_MS;
    expect(helperExecOptions("K").timeout).toBe(3000);
  });

  it("honours HERMES_SECRET_COMMAND_TIMEOUT_MS at call time", () => {
    process.env.HERMES_SECRET_COMMAND_TIMEOUT_MS = String(20 * 1000 + 1234);
    expect(helperExecOptions("K").timeout).toBe(21234);
  });

  it("falls back to 3000 on a blank or non-numeric value", () => {
    process.env.HERMES_SECRET_COMMAND_TIMEOUT_MS = "   ";
    expect(helperExecOptions("K").timeout).toBe(3000);
    process.env.HERMES_SECRET_COMMAND_TIMEOUT_MS = "not-a-number";
    expect(helperExecOptions("K").timeout).toBe(3000);
  });

  it("falls back to 3000 on a zero or negative value", () => {
    process.env.HERMES_SECRET_COMMAND_TIMEOUT_MS = "0";
    expect(helperExecOptions("K").timeout).toBe(3000);
    process.env.HERMES_SECRET_COMMAND_TIMEOUT_MS = "-5000";
    expect(helperExecOptions("K").timeout).toBe(3000);
  });
});
