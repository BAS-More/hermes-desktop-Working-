import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// useI18n needs an I18nProvider; the sidebar only uses `t` for labels, so a
// pass-through mock keeps these tests focused on the action wiring.
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    setLocale: () => {},
  }),
}));

import SidebarRecentSessions from "./SidebarRecentSessions";

type AggSession = {
  id: string;
  profile: string;
  title: string | null;
  startedAt: number;
  source: string;
  messageCount: number;
  model: string;
  archived: boolean;
  pinned: boolean;
  status: "active" | "paused" | "complete";
  groupId: string | null;
};

function agg(partial: Partial<AggSession> & { id: string }): AggSession {
  return {
    profile: "default",
    title: null,
    startedAt: Math.floor(Date.now() / 1000),
    source: "cli",
    messageCount: 1,
    model: "gpt-5.5",
    archived: false,
    pinned: false,
    status: "active",
    groupId: null,
    ...partial,
  };
}

function installHermesAPI(
  initialSessions: AggSession[] = [],
  groups: Array<{
    id: string;
    name: string;
    color: string | null;
    sortOrder: number;
    createdAt: number;
    profile: string;
  }> = [],
): Record<string, ReturnType<typeof vi.fn>> {
  const api = {
    listAllSessions: vi.fn().mockResolvedValue(initialSessions),
    syncAllSessionCaches: vi.fn().mockResolvedValue(initialSessions),
    listSessionGroups: vi.fn().mockResolvedValue(groups),
    setSessionPinned: vi.fn().mockResolvedValue(undefined),
    setSessionArchived: vi.fn().mockResolvedValue(undefined),
    setSessionStatus: vi.fn().mockResolvedValue(undefined),
    moveSessionToGroup: vi.fn().mockResolvedValue(undefined),
    renameSession: vi.fn().mockResolvedValue(undefined),
    deleteSessionInProfile: vi.fn().mockResolvedValue(undefined),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  return api;
}

const baseProps = {
  open: true,
  activeProfile: "default",
  currentSessionId: null,
  loadingSessionIds: new Set<string>(),
  resumingSessionId: null,
  onSelect: (): void => {},
};

async function renderSidebar(
  sessions: AggSession[],
  api: Record<string, ReturnType<typeof vi.fn>>,
): Promise<void> {
  render(<SidebarRecentSessions {...baseProps} />);
  // Let the open-effect resolve (cache read + sync) so rows paint.
  await waitFor(() => {
    expect(api.syncAllSessionCaches).toHaveBeenCalled();
  });
  await waitFor(() => {
    expect(
      screen.getByText(sessions[0].title ?? "sessions.newConversation"),
    ).toBeTruthy();
  });
}

/** Open the ⋮ menu on the first row, then click the named item. */
async function clickRowMenuItem(name: string): Promise<void> {
  const menuBtn = screen.getAllByRole("button", {
    name: "sessions.actions.menu",
  })[0];
  await act(async () => {
    fireEvent.click(menuBtn);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("menuitem", { name }));
  });
}

describe("Sidebar recent-session ⋮ actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    // @ts-expect-error cleanup test global
    delete window.hermesAPI;
  });

  it("renders a ⋮ menu trigger on each row", async () => {
    const sessions = [agg({ id: "s1", title: "First chat" })];
    const api = installHermesAPI(sessions);
    await renderSidebar(sessions, api);
    expect(
      screen.getAllByRole("button", { name: "sessions.actions.menu" }).length,
    ).toBe(1);
  });

  it("Pin fires setSessionPinned(profile,id,true)", async () => {
    const sessions = [agg({ id: "s1", title: "First chat", pinned: false })];
    const api = installHermesAPI(sessions);
    await renderSidebar(sessions, api);
    await clickRowMenuItem("sessions.actions.pin");
    expect(api.setSessionPinned).toHaveBeenCalledWith("default", "s1", true);
  });

  it("Unpin fires setSessionPinned(profile,id,false) for a pinned row", async () => {
    const sessions = [agg({ id: "s1", title: "First chat", pinned: true })];
    const api = installHermesAPI(sessions);
    await renderSidebar(sessions, api);
    await clickRowMenuItem("sessions.actions.unpin");
    expect(api.setSessionPinned).toHaveBeenCalledWith("default", "s1", false);
  });

  it("Archive fires setSessionArchived(profile,id,true)", async () => {
    const sessions = [agg({ id: "s1", title: "First chat" })];
    const api = installHermesAPI(sessions);
    await renderSidebar(sessions, api);
    await clickRowMenuItem("sessions.actions.archive");
    expect(api.setSessionArchived).toHaveBeenCalledWith("default", "s1", true);
  });

  it("Rename → type → Enter fires renameSession with the new title", async () => {
    const sessions = [agg({ id: "s1", title: "Old title" })];
    const api = installHermesAPI(sessions);
    await renderSidebar(sessions, api);
    await clickRowMenuItem("sessions.actions.rename");
    const input = screen.getByLabelText("sessions.rename") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "New title" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(api.renameSession).toHaveBeenCalledWith(
      "default",
      "s1",
      "New title",
    );
  });

  it("Move to group → a group fires moveSessionToGroup(profile,id,groupId)", async () => {
    const sessions = [agg({ id: "s1", title: "First chat" })];
    const groups = [
      {
        id: "g1",
        name: "Migration",
        color: null,
        sortOrder: 0,
        createdAt: 0,
        profile: "default",
      },
    ];
    const api = installHermesAPI(sessions, groups);
    await renderSidebar(sessions, api);
    // open the menu, expand the group submenu, then click the group.
    const menuBtn = screen.getAllByRole("button", {
      name: "sessions.actions.menu",
    })[0];
    await act(async () => {
      fireEvent.click(menuBtn);
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("menuitem", { name: /sessions.actions.moveToGroup/ }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Migration" }));
    });
    expect(api.moveSessionToGroup).toHaveBeenCalledWith("default", "s1", "g1");
  });

  it("Pause fires setSessionStatus(profile,id,paused) for an active row", async () => {
    const sessions = [agg({ id: "s1", title: "First chat", status: "active" })];
    const api = installHermesAPI(sessions);
    await renderSidebar(sessions, api);
    await clickRowMenuItem("sessions.actions.pause");
    expect(api.setSessionStatus).toHaveBeenCalledWith("default", "s1", "paused");
  });

  it("Continue fires setSessionStatus(profile,id,active) for a paused row", async () => {
    const sessions = [agg({ id: "s1", title: "First chat", status: "paused" })];
    const api = installHermesAPI(sessions);
    await renderSidebar(sessions, api);
    await clickRowMenuItem("sessions.actions.resume");
    expect(api.setSessionStatus).toHaveBeenCalledWith("default", "s1", "active");
  });

  it("Mark complete fires setSessionStatus(profile,id,complete)", async () => {
    const sessions = [agg({ id: "s1", title: "First chat", status: "active" })];
    const api = installHermesAPI(sessions);
    await renderSidebar(sessions, api);
    await clickRowMenuItem("sessions.actions.markComplete");
    expect(api.setSessionStatus).toHaveBeenCalledWith(
      "default",
      "s1",
      "complete",
    );
  });

  it("Mark complete is hidden once a session is already complete", async () => {
    const sessions = [
      agg({ id: "s1", title: "First chat", status: "complete" }),
    ];
    const api = installHermesAPI(sessions);
    await renderSidebar(sessions, api);
    const menuBtn = screen.getAllByRole("button", {
      name: "sessions.actions.menu",
    })[0];
    await act(async () => {
      fireEvent.click(menuBtn);
    });
    expect(
      screen.queryByRole("menuitem", {
        name: "sessions.actions.markComplete",
      }),
    ).toBeNull();
  });

  it("Share copies the session link when navigator.share is unavailable", async () => {
    const sessions = [agg({ id: "s1", title: "First chat" })];
    const api = installHermesAPI(sessions);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    // Ensure share is absent so it falls back to clipboard.
    delete (navigator as unknown as { share?: unknown }).share;
    await renderSidebar(sessions, api);
    await clickRowMenuItem("sessions.actions.share");
    expect(writeText).toHaveBeenCalledWith(
      "hermes://session/default/s1",
    );
  });

  it("Delete requires confirmation, then fires deleteSessionInProfile", async () => {
    const sessions = [agg({ id: "s1", title: "First chat" })];
    const api = installHermesAPI(sessions);
    await renderSidebar(sessions, api);
    await clickRowMenuItem("sessions.actions.delete");
    // Not deleted yet — confirm dialog is showing.
    expect(api.deleteSessionInProfile).not.toHaveBeenCalled();
    const confirm = screen.getByRole("button", {
      name: "sessions.deleteConfirmAction",
    });
    await act(async () => {
      fireEvent.click(confirm);
    });
    await waitFor(() => {
      expect(api.deleteSessionInProfile).toHaveBeenCalledWith("default", "s1");
    });
  });

  it("Delete can be cancelled without calling the API", async () => {
    const sessions = [agg({ id: "s1", title: "First chat" })];
    const api = installHermesAPI(sessions);
    await renderSidebar(sessions, api);
    await clickRowMenuItem("sessions.actions.delete");
    const cancel = screen.getByRole("button", {
      name: "sessions.deleteCancel",
    });
    await act(async () => {
      fireEvent.click(cancel);
    });
    expect(api.deleteSessionInProfile).not.toHaveBeenCalled();
  });
});
