import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AgentDetail from "./AgentDetail";

// i18n returns the key so we assert wiring without locale lookups.
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (k: string) => k, locale: "en", setLocale: () => {} }),
}));

// Stub the three composed screens so this test targets AgentDetail's own
// behaviour (tab switching, profile threading, close) — each child has its
// own tests.
vi.mock("../Soul/Soul", () => ({
  default: ({ profile }: { profile: string }) => (
    <div data-testid="soul">persona:{profile}</div>
  ),
}));
vi.mock("../Skills/Skills", () => ({
  default: ({ profile }: { profile: string }) => (
    <div data-testid="skills">skills:{profile}</div>
  ),
}));
vi.mock("../Tools/Tools", () => ({
  default: ({ profile }: { profile: string }) => (
    <div data-testid="tools">tools:{profile}</div>
  ),
}));
vi.mock("../../components/common/ProfileAvatar", () => ({
  default: () => <div data-testid="avatar" />,
}));

beforeEach(() => {
  // @ts-expect-error test shim
  global.window.hermesAPI = {};
});

describe("AgentDetail (per-agent persona/skills/tools)", () => {
  it("defaults to the persona tab, threading the profile to Soul", () => {
    render(<AgentDetail profile="architect" onClose={() => {}} />);
    expect(screen.getByTestId("soul")).toHaveTextContent("persona:architect");
    expect(screen.queryByTestId("skills")).toBeNull();
    expect(screen.queryByTestId("tools")).toBeNull();
  });

  it("switches to Skills and Tools, always threading the SAME profile", () => {
    render(<AgentDetail profile="data-analyst" onClose={() => {}} />);
    fireEvent.click(screen.getByText("skills.title"));
    expect(screen.getByTestId("skills")).toHaveTextContent(
      "skills:data-analyst",
    );
    fireEvent.click(screen.getByText("tools.title"));
    expect(screen.getByTestId("tools")).toHaveTextContent(
      "tools:data-analyst",
    );
  });

  it("honours initialTab so Office clickthrough can deep-link a tab", () => {
    render(
      <AgentDetail
        profile="code-reviewer"
        initialTab="tools"
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId("tools")).toHaveTextContent(
      "tools:code-reviewer",
    );
  });

  it("calls onClose from the close button", async () => {
    const onClose = vi.fn();
    render(<AgentDetail profile="x" onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("common.cancel"));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("closes on overlay backdrop click but NOT on inner modal click", () => {
    const onClose = vi.fn();
    const { container } = render(
      <AgentDetail profile="x" onClose={onClose} />,
    );
    // Inner dialog click — must NOT close.
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    // Backdrop overlay click — must close.
    const overlay = container.querySelector(".agent-detail-overlay");
    if (overlay) fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
