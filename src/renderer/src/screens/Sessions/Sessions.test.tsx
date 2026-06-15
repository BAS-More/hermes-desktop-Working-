import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// useI18n needs an I18nProvider; the Sessions tab only uses `t` for labels,
// so a pass-through mock keeps these tests focused on the refresh behaviour.
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    setLocale: () => {},
  }),
}));

import Sessions, { SESSIONS_REFRESH_MS } from "./Sessions";

const baseProps = {
  onResumeSession: (): void => {},
  onNewChat: (): void => {},
  currentSessionId: null,
};

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

/** Build an aggregated-session row with sensible defaults. */
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
): Record<string, ReturnType<typeof vi.fn>> {
  const api = {
    listAllSessions: vi.fn().mockResolvedValue(initialSessions),
    syncAllSessionCaches: vi.fn().mockResolvedValue(initialSessions),
    searchAllSessions: vi.fn().mockResolvedValue([]),
    deleteSessionInProfile: vi.fn().mockResolvedValue(undefined),
    deleteSessionsByProfile: vi
      .fn()
      .mockResolvedValue({ requested: 0, deleted: 0 }),
    listSessionGroups: vi.fn().mockResolvedValue([]),
    setSessionPinned: vi.fn().mockResolvedValue(undefined),
    setSessionStatus: vi.fn().mockResolvedValue(undefined),
    setSessionArchived: vi.fn().mockResolvedValue(undefined),
    moveSessionToGroup: vi.fn().mockResolvedValue(undefined),
    renameSession: vi.fn().mockResolvedValue(undefined),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  return api;
}

function searchResult(
  title: string | null,
  snippet: string,
  sessionId?: string,
): AggSession & { snippet: string } {
  return {
    ...agg({
      id:
        sessionId ??
        (title ?? snippet)
          .replace(/<</g, "")
          .replace(/>>/g, "")
          .toLowerCase()
          .replace(/\s+/g, "-"),
      title,
      source: "desktop",
    }),
    snippet,
  };
}

/** Open the overflow (⋯) menu on the first card, then click the named item. */
async function clickCardMenuItem(name: string): Promise<void> {
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

describe("Sessions tab live refresh (#322)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-syncs from state.db on an interval while the tab is visible", async () => {
    const api = installHermesAPI();
    render(<Sessions {...baseProps} visible={true} />);
    await act(async () => {});

    const afterMount = api.syncAllSessionCaches.mock.calls.length;
    expect(afterMount).toBeGreaterThan(0);

    await act(async () => {
      vi.advanceTimersByTime(SESSIONS_REFRESH_MS);
    });
    expect(api.syncAllSessionCaches.mock.calls.length).toBe(afterMount + 1);

    await act(async () => {
      vi.advanceTimersByTime(SESSIONS_REFRESH_MS);
    });
    expect(api.syncAllSessionCaches.mock.calls.length).toBe(afterMount + 2);
  });

  it("runs no timer while the tab is hidden", async () => {
    const api = installHermesAPI();
    render(<Sessions {...baseProps} visible={false} />);
    await act(async () => {});

    const afterMount = api.syncAllSessionCaches.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(SESSIONS_REFRESH_MS * 5);
    });
    expect(api.syncAllSessionCaches.mock.calls.length).toBe(afterMount);
  });

  it("refreshes when the window regains focus", async () => {
    const api = installHermesAPI();
    render(<Sessions {...baseProps} visible={true} />);
    await act(async () => {});

    const afterMount = api.syncAllSessionCaches.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(api.syncAllSessionCaches.mock.calls.length).toBe(afterMount + 1);
  });

  it("renders sessions recovered by sync when the fast cache starts empty", async () => {
    vi.useRealTimers();
    const api = installHermesAPI();
    api.syncAllSessionCaches.mockResolvedValue([
      agg({
        id: "recovered-session",
        title: "Recovered older conversation",
        messageCount: 4,
      }),
    ]);

    render(<Sessions {...baseProps} visible={true} />);
    await act(async () => {});

    await waitFor(() => {
      expect(screen.getByText("Recovered older conversation")).toBeTruthy();
    });
    expect(screen.queryByText("sessions.empty")).toBeNull();
  });

  it("ignores stale search results from earlier keystrokes", async () => {
    const api = installHermesAPI();
    let resolveBroadSearch:
      | ((value: Array<AggSession & { snippet: string }>) => void)
      | undefined;
    api.searchAllSessions.mockImplementation((query: string) => {
      if (query === "h") {
        return new Promise((resolve) => {
          resolveBroadSearch = resolve;
        });
      }
      if (query === "hello") {
        return Promise.resolve([searchResult("Hello match", "<<hello>>")]);
      }
      return Promise.resolve([]);
    });

    render(<Sessions {...baseProps} visible={true} />);
    await act(async () => {});

    const search = screen.getByPlaceholderText("sessions.searchPlaceholder");
    fireEvent.change(search, { target: { value: "h" } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    fireEvent.change(search, { target: { value: "hello" } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await act(async () => {});
    expect(screen.getByText("Hello match")).toBeTruthy();

    await act(async () => {
      resolveBroadSearch?.([searchResult("Broad h match", "<<hermes>>")]);
    });

    expect(screen.getByText("Hello match")).toBeTruthy();
    expect(screen.queryByText("Broad h match")).toBeNull();
  });

  it("uses matched text as the visible title for untitled search results", async () => {
    vi.useRealTimers();
    const api = installHermesAPI();
    api.searchAllSessions.mockResolvedValue([
      searchResult(
        null,
        "<<Live PR499>> smoke test. Reply exactly: OK",
        "session-722999",
      ),
    ]);

    render(<Sessions {...baseProps} visible={true} />);
    await act(async () => {});

    const search = screen.getByPlaceholderText("sessions.searchPlaceholder");
    fireEvent.change(search, { target: { value: "Live PR499" } });

    await waitFor(() => {
      expect(screen.getByText(/smoke test\. Reply exactly: OK/)).toBeTruthy();
    });
  });
});

describe("Sessions tab — delete affordance (#408)", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("calls deleteSessionInProfile when delete is chosen + confirmed", async () => {
    const api = installHermesAPI([
      agg({ id: "sess-abc-123", profile: "architect", title: "First chat" }),
    ]);

    render(<Sessions {...baseProps} visible={true} />);
    await act(async () => {});

    await clickCardMenuItem("sessions.actions.delete");

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "sessions.deleteConfirm",
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "sessions.deleteConfirmAction" }),
      );
    });

    expect(api.deleteSessionInProfile).toHaveBeenCalledWith(
      "architect",
      "sess-abc-123",
    );
  });

  it("does NOT call delete when the confirm is cancelled", async () => {
    const api = installHermesAPI([
      agg({ id: "sess-abc-123", title: "First chat" }),
    ]);

    render(<Sessions {...baseProps} visible={true} />);
    await act(async () => {});

    await clickCardMenuItem("sessions.actions.delete");

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "sessions.deleteCancel" }),
      );
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.deleteSessionInProfile).not.toHaveBeenCalled();
  });

  it("opening the menu does not resume the session", async () => {
    installHermesAPI([agg({ id: "sess-abc-123", title: "First chat" })]);
    const onResume = vi.fn();

    render(
      <Sessions {...baseProps} onResumeSession={onResume} visible={true} />,
    );
    await act(async () => {});

    await clickCardMenuItem("sessions.actions.delete");

    expect(onResume).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("Sessions tab — bulk delete selection (#490)", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("deletes the selected sessions after confirmation, grouped by profile", async () => {
    const api = installHermesAPI([
      agg({ id: "sess-one", profile: "architect", title: "First chat" }),
      agg({ id: "sess-two", profile: "architect", title: "Second chat" }),
      agg({ id: "sess-three", profile: "default", title: "Third chat" }),
    ]);

    render(<Sessions {...baseProps} visible={true} />);
    await act(async () => {});

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "sessions.selectMode" }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByText("First chat"));
      fireEvent.click(screen.getByText("Second chat"));
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "sessions.deleteSelected" }),
      );
    });

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "sessions.deleteSelectedConfirm",
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "sessions.deleteConfirmAction" }),
      );
    });

    await waitFor(() => {
      expect(api.deleteSessionsByProfile).toHaveBeenCalledWith({
        architect: ["sess-one", "sess-two"],
      });
    });
  });

  it("does not delete selected sessions when the bulk confirm is cancelled", async () => {
    const api = installHermesAPI([
      agg({ id: "sess-one", title: "First chat" }),
    ]);

    render(<Sessions {...baseProps} visible={true} />);
    await act(async () => {});

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "sessions.selectMode" }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByText("First chat"));
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "sessions.deleteSelected" }),
      );
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "sessions.deleteCancel" }),
      );
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.deleteSessionsByProfile).not.toHaveBeenCalled();
  });
});

describe("Sessions tab — multi-profile aggregation", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("resumes with the session's own profile, not the active one", async () => {
    installHermesAPI([
      agg({ id: "s-arch", profile: "architect", title: "Arch chat" }),
    ]);
    const onResume = vi.fn();
    render(
      <Sessions {...baseProps} onResumeSession={onResume} visible={true} />,
    );
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByText("Arch chat"));
    });

    expect(onResume).toHaveBeenCalledWith("s-arch", "architect");
  });

  it("renders a profile chip on each card", async () => {
    installHermesAPI([
      agg({ id: "s1", profile: "backend-engineer", title: "BE chat" }),
    ]);
    render(<Sessions {...baseProps} visible={true} />);
    await act(async () => {});

    await waitFor(() => {
      expect(screen.getByText("backend-engineer")).toBeTruthy();
    });
  });

  it("pins a session via the overflow menu", async () => {
    const api = installHermesAPI([
      agg({ id: "s1", profile: "architect", title: "Pin me" }),
    ]);
    render(<Sessions {...baseProps} visible={true} />);
    await act(async () => {});

    await clickCardMenuItem("sessions.actions.pin");

    expect(api.setSessionPinned).toHaveBeenCalledWith("architect", "s1", true);
  });
});
