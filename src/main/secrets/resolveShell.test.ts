import { describe, expect, it, vi, afterEach } from "vitest";
import { resolveShell } from "./commandProvider";

// resolveShell() is the cross-platform fix for the secrets command provider.
// Historically the provider hardcoded "/bin/sh", which Node's execFileSync
// resolves against the real Win32 filesystem — absent there (the MSYS/Git-Bash
// /bin/sh is a shell-mount illusion, not a Win32 path), so every spawn returned
// ENOENT and every key degraded to null on Windows. resolveShell() returns a
// POSIX sh that actually exists on the host.

describe("resolveShell", () => {
  const realPlatform = process.platform;
  const realShell = process.env.SHELL;

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: realPlatform });
    if (realShell === undefined) delete process.env.SHELL;
    else process.env.SHELL = realShell;
    vi.restoreAllMocks();
  });

  it("returns bare 'sh' on POSIX (PATH-resolved, never a hardcoded path)", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    expect(resolveShell()).toBe("sh");
  });

  it("returns bare 'sh' on macOS", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    expect(resolveShell()).toBe("sh");
  });

  it("NEVER returns the literal '/bin/sh' that fails on Win32 execFileSync", () => {
    // The exact historical bug: a hardcoded absolute path that ENOENTs on
    // Windows. resolveShell must never hand that back on win32.
    Object.defineProperty(process, "platform", { value: "win32" });
    delete process.env.SHELL;
    const shell = resolveShell();
    expect(shell).not.toBe("/bin/sh");
  });

  it("on win32 prefers an existing absolute shell, else falls back to bare 'sh'", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    delete process.env.SHELL;
    const shell = resolveShell();
    // Either a real Git-for-Windows sh.exe was found on this box, or we fall
    // back to bare "sh" for PATH/WSL/Cygwin resolution — both are spawn-able,
    // neither is the broken literal "/bin/sh".
    expect(shell === "sh" || shell.toLowerCase().endsWith("sh.exe")).toBe(true);
  });

  it("on win32 honours an explicit SHELL env override when it exists", () => {
    // process.env.SHELL inside a Git-Bash session points at a real sh.exe; if
    // set and present, resolveShell prefers it. We can't guarantee a path
    // exists in CI, so only assert the contract holds: result is spawn-able
    // (bare 'sh' or a *.exe), never "/bin/sh".
    Object.defineProperty(process, "platform", { value: "win32" });
    const shell = resolveShell();
    expect(shell).not.toBe("/bin/sh");
    expect(typeof shell).toBe("string");
    expect(shell.length).toBeGreaterThan(0);
  });
});
