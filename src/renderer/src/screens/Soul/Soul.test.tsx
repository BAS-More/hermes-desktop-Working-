import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import Soul from "./Soul";

// Mock i18n — return the key so we can assert wiring without locale lookups.
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (k: string) => k,
    locale: "en",
    setLocale: () => {},
  }),
}));

const readSoul = vi.fn();
const writeSoul = vi.fn();
const resetSoul = vi.fn();

beforeEach(() => {
  readSoul.mockReset().mockResolvedValue("You are a test agent.");
  writeSoul.mockReset().mockResolvedValue(true);
  resetSoul.mockReset().mockResolvedValue("DEFAULT PERSONA");
  // @ts-expect-error test shim
  global.window.hermesAPI = { readSoul, writeSoul, resetSoul };
  vi.useRealTimers();
});

describe("Soul (persona editor)", () => {
  it("loads the active profile's persona into the editor", async () => {
    render(<Soul profile="default" />);
    const ta = (await screen.findByPlaceholderText(
      "soul.placeholder",
    )) as HTMLTextAreaElement;
    expect(ta.value).toBe("You are a test agent.");
    expect(readSoul).toHaveBeenCalledWith("default");
  });

  it("reads per-agent: passes the given profile to readSoul", async () => {
    render(<Soul profile="architect" />);
    await screen.findByPlaceholderText("soul.placeholder");
    expect(readSoul).toHaveBeenCalledWith("architect");
  });

  it("auto-saves edits (debounced) via writeSoul with the profile", async () => {
    render(<Soul profile="builder" />);
    const ta = await screen.findByPlaceholderText("soul.placeholder");
    // Wait out the 300ms load-guard so edits are treated as user input.
    await new Promise((r) => setTimeout(r, 350));
    fireEvent.change(ta, { target: { value: "New persona text" } });
    await waitFor(
      () =>
        expect(writeSoul).toHaveBeenCalledWith("New persona text", "builder"),
      { timeout: 1500 },
    );
  });

  it("reset shows a confirm then calls resetSoul and loads the default", async () => {
    render(<Soul profile="default" />);
    await screen.findByPlaceholderText("soul.placeholder");
    fireEvent.click(screen.getByText("soul.reset"));
    // Confirm row appears
    const confirmBtns = screen.getAllByText("soul.reset");
    // The primary confirm button is the second "reset" label (header + confirm)
    await act(async () => {
      fireEvent.click(confirmBtns[confirmBtns.length - 1]);
    });
    await waitFor(() => expect(resetSoul).toHaveBeenCalledWith("default"));
    const ta = screen.getByPlaceholderText(
      "soul.placeholder",
    ) as HTMLTextAreaElement;
    expect(ta.value).toBe("DEFAULT PERSONA");
  });
});
