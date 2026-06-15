import {
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
  memo,
} from "react";
import {
  Plus,
  Search,
  X,
  ChatBubble,
  Trash,
  Pencil,
  Pause,
  Play,
  Check,
  Copy,
  Send,
  Circle,
} from "../../assets/icons";
import { useI18n } from "../../components/useI18n";
import { defaultColorForName } from "../../../../shared/profileColors";

type SessionStatus = "active" | "paused" | "complete";

interface SessionRow {
  id: string;
  profile: string;
  title: string | null;
  startedAt: number;
  source: string;
  messageCount: number;
  model: string;
  archived: boolean;
  pinned: boolean;
  status: SessionStatus;
  groupId: string | null;
}

interface SearchRow extends SessionRow {
  snippet: string;
}

interface SessionGroupInfo {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
  createdAt: number;
  profile: string;
}

interface SessionsProps {
  /** Resume now carries the profile so the right state.db / gateway is used. */
  onResumeSession: (sessionId: string, profile: string) => void;
  onNewChat: () => void;
  currentSessionId: string | null;
  visible: boolean;
}

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatFullDate(ts: number): string {
  const d = new Date(ts * 1000);
  return (
    d.toLocaleDateString([], { month: "short", day: "numeric" }) +
    ", " +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );
}

type DateGroup = "today" | "yesterday" | "thisWeek" | "earlier";

function getDateGroup(ts: number): DateGroup {
  const d = new Date(ts * 1000);
  const now = new Date();

  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (isToday) return "today";

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear();
  if (isYesterday) return "yesterday";

  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  if (d >= weekAgo) return "thisWeek";

  return "earlier";
}

function groupSessions(
  sessions: SessionRow[],
): Array<{ label: DateGroup; sessions: SessionRow[] }> {
  const groups = new Map<DateGroup, SessionRow[]>();
  for (const s of sessions) {
    const group = getDateGroup(s.startedAt);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(s);
  }
  const order: DateGroup[] = ["today", "yesterday", "thisWeek", "earlier"];
  return order
    .filter((label) => groups.has(label))
    .map((label) => ({ label, sessions: groups.get(label)! }));
}

function highlightSnippet(snippet: string): React.JSX.Element {
  const parts = snippet.split(/(<<.*?>>)/g);
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith("<<") && part.endsWith(">>")) {
          return <mark key={i}>{part.slice(2, -2)}</mark>;
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

function cleanSearchSnippet(snippet: string, preserveMarkers = false): string {
  let text = snippet
    .replace(/\\r\\n|\\n|\\r|\r\n|\n|\r/g, " ")
    .replace(/^\s*(?:\.{3}|…)+\s*/, "")
    .replace(/\s*(?:\.{3}|…)+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!preserveMarkers) {
    text = text.replace(/<</g, "").replace(/>>/g, "");
  }
  return text;
}

function formatModel(model: string): string {
  const name = model.split("/").pop() || model;
  return name.split(":")[0];
}

// How often the Sessions tab re-syncs from state.db while it is open.
export const SESSIONS_REFRESH_MS = 30_000;

/** Small profile pill rendered on each card. */
function ProfileChip({ profile }: { profile: string }): React.JSX.Element {
  const color = defaultColorForName(profile);
  return (
    <span
      className="sessions-tag sessions-tag--profile"
      style={{
        borderColor: color,
        color,
      }}
      title={profile}
    >
      {profile}
    </span>
  );
}

function StatusDot({ status }: { status: SessionStatus }): React.JSX.Element | null {
  if (status === "active") return null;
  const color = status === "paused" ? "#e5c07b" : "#98c379";
  return (
    <Circle
      size={8}
      fill={color}
      style={{ color, flex: "0 0 auto" }}
      aria-hidden
    />
  );
}

/**
 * Per-card overflow action menu. Renders a `…` button that opens a popover
 * with the 10 session actions. Closes on outside-click / Escape.
 */
const SessionActionMenu = memo(function SessionActionMenu({
  session,
  groups,
  onPinToggle,
  onPauseResume,
  onMarkComplete,
  onRename,
  onCopyLink,
  onShare,
  onMoveToGroup,
  onNewGroup,
  onArchiveToggle,
  onDelete,
}: {
  session: SessionRow;
  groups: SessionGroupInfo[];
  onPinToggle: () => void;
  onPauseResume: () => void;
  onMarkComplete: () => void;
  onRename: () => void;
  onCopyLink: () => void;
  onShare: () => void;
  onMoveToGroup: (groupId: string | null) => void;
  onNewGroup: () => void;
  onArchiveToggle: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSubmenu(false);
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setOpen(false);
        setSubmenu(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const run = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(false);
    setSubmenu(false);
    fn();
  };

  return (
    <div className="sessions-menu" ref={ref}>
      <button
        type="button"
        className="sessions-card-menu-btn"
        title={t("sessions.actions.menu")}
        aria-label={t("sessions.actions.menu")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <span aria-hidden>⋯</span>
      </button>
      {open && (
        <div className="sessions-menu-popover" role="menu">
          <button role="menuitem" onClick={run(onPinToggle)}>
            {session.pinned
              ? t("sessions.actions.unpin")
              : t("sessions.actions.pin")}
          </button>
          <button role="menuitem" onClick={run(onPauseResume)}>
            {session.status === "paused" ? (
              <>
                <Play size={13} /> {t("sessions.actions.resume")}
              </>
            ) : (
              <>
                <Pause size={13} /> {t("sessions.actions.pause")}
              </>
            )}
          </button>
          {session.status !== "complete" && (
            <button role="menuitem" onClick={run(onMarkComplete)}>
              <Check size={13} /> {t("sessions.actions.markComplete")}
            </button>
          )}
          <button role="menuitem" onClick={run(onRename)}>
            <Pencil size={13} /> {t("sessions.actions.rename")}
          </button>
          <div className="sessions-menu-sub">
            <button
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={submenu}
              onClick={(e) => {
                e.stopPropagation();
                setSubmenu((v) => !v);
              }}
            >
              {t("sessions.actions.moveToGroup")} ▸
            </button>
            {submenu && (
              <div className="sessions-menu-popover sessions-menu-popover--sub">
                <button
                  role="menuitem"
                  onClick={run(() => onMoveToGroup(null))}
                >
                  {t("sessions.noGroup")}
                </button>
                {groups.map((g) => (
                  <button
                    key={g.id}
                    role="menuitem"
                    onClick={run(() => onMoveToGroup(g.id))}
                  >
                    {g.name}
                  </button>
                ))}
                <button role="menuitem" onClick={run(onNewGroup)}>
                  {t("sessions.newGroup")}
                </button>
              </div>
            )}
          </div>
          <button role="menuitem" onClick={run(onCopyLink)}>
            <Copy size={13} /> {t("sessions.actions.copyLink")}
          </button>
          <button role="menuitem" onClick={run(onShare)}>
            <Send size={13} /> {t("sessions.actions.share")}
          </button>
          <button role="menuitem" onClick={run(onArchiveToggle)}>
            {session.archived
              ? t("sessions.actions.unarchive")
              : t("sessions.actions.archive")}
          </button>
          <button
            role="menuitem"
            className="sessions-menu-danger"
            onClick={run(onDelete)}
          >
            <Trash size={13} /> {t("sessions.actions.delete")}
          </button>
        </div>
      )}
    </div>
  );
});

// Memoized session card
const SessionCard = memo(function SessionCard({
  session,
  groups,
  isActive,
  showFullDate,
  onClick,
  onDelete,
  onRename,
  isRenaming = false,
  renameValue = "",
  onRenameChange,
  onRenameConfirm,
  onRenameCancel,
  renameInputRef,
  selectionMode = false,
  selected = false,
  onToggleSelected,
  selectTitle,
  onPinToggle,
  onPauseResume,
  onMarkComplete,
  onCopyLink,
  onShare,
  onMoveToGroup,
  onNewGroup,
  onArchiveToggle,
}: {
  session: SessionRow;
  groups: SessionGroupInfo[];
  isActive: boolean;
  showFullDate: boolean;
  onClick: () => void;
  onDelete: (session: SessionRow) => void;
  onRename: (session: SessionRow) => void;
  isRenaming?: boolean;
  renameValue?: string;
  onRenameChange?: (value: string) => void;
  onRenameConfirm?: () => void;
  onRenameCancel?: () => void;
  renameInputRef?: React.RefObject<HTMLInputElement | null>;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelected?: (id: string) => void;
  selectTitle?: string;
  onPinToggle: (session: SessionRow) => void;
  onPauseResume: (session: SessionRow) => void;
  onMarkComplete: (session: SessionRow) => void;
  onCopyLink: (session: SessionRow) => void;
  onShare: (session: SessionRow) => void;
  onMoveToGroup: (session: SessionRow, groupId: string | null) => void;
  onNewGroup: (session: SessionRow) => void;
  onArchiveToggle: (session: SessionRow) => void;
}) {
  const activate = (): void => {
    if (selectionMode) {
      onToggleSelected?.(session.id);
      return;
    }
    onClick();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={`sessions-card ${isActive ? "sessions-card--active" : ""} ${
        selected ? "sessions-card--selected" : ""
      } ${session.pinned ? "sessions-card--pinned" : ""}`}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      }}
    >
      <div className="sessions-card-main">
        {selectionMode && (
          <label
            className="sessions-card-select"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelected?.(session.id)}
              aria-label={selectTitle}
            />
          </label>
        )}
        <StatusDot status={session.status} />
        {isRenaming ? (
          <input
            ref={renameInputRef}
            className="sessions-card-rename-input"
            type="text"
            value={renameValue}
            onChange={(e) => onRenameChange?.(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                onRenameConfirm?.();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onRenameCancel?.();
              }
            }}
            onBlur={() => onRenameConfirm?.()}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="sessions-card-title">
            {session.title || "New conversation"}
          </span>
        )}
        <span className="sessions-card-time">
          {showFullDate
            ? formatFullDate(session.startedAt)
            : formatTime(session.startedAt)}
        </span>
      </div>
      <div className="sessions-card-tags">
        <ProfileChip profile={session.profile} />
        <span className="sessions-tag sessions-tag--source">
          {session.source}
        </span>
        <span className="sessions-tag">
          {session.messageCount} msg{session.messageCount !== 1 ? "s" : ""}
        </span>
        {session.model && (
          <span className="sessions-tag sessions-tag--model">
            {formatModel(session.model)}
          </span>
        )}
        {!selectionMode && !isRenaming && (
          <SessionActionMenu
            session={session}
            groups={groups}
            onPinToggle={() => onPinToggle(session)}
            onPauseResume={() => onPauseResume(session)}
            onMarkComplete={() => onMarkComplete(session)}
            onRename={() => onRename(session)}
            onCopyLink={() => onCopyLink(session)}
            onShare={() => onShare(session)}
            onMoveToGroup={(gid) => onMoveToGroup(session, gid)}
            onNewGroup={() => onNewGroup(session)}
            onArchiveToggle={() => onArchiveToggle(session)}
            onDelete={() => onDelete(session)}
          />
        )}
      </div>
    </div>
  );
});

function Sessions({
  onResumeSession,
  onNewChat,
  currentSessionId,
  visible,
}: SessionsProps): React.JSX.Element {
  const { t } = useI18n();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [groups, setGroups] = useState<SessionGroupInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchRow[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [filterGroup, setFilterGroup] = useState<string>("all");
  const [toast, setToast] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SessionRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [pendingBulkDelete, setPendingBulkDelete] = useState<
    SessionRow[] | null
  >(null);
  const [deletingBulk, setDeletingBulk] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRequestId = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Rename state
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const editingSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    editingSessionIdRef.current = editingSessionId;
  }, [editingSessionId]);

  const showToast = useCallback((msg: string): void => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const sessionById = useCallback(
    (id: string): SessionRow | undefined => sessions.find((s) => s.id === id),
    [sessions],
  );

  const loadGroups = useCallback(async (): Promise<void> => {
    try {
      const g = await window.hermesAPI.listSessionGroups();
      setGroups(g);
    } catch {
      /* groups are optional sugar */
    }
  }, []);

  const refreshSessions = useCallback(async (): Promise<void> => {
    const synced = await window.hermesAPI.syncAllSessionCaches();
    setSessions(synced as SessionRow[]);
  }, []);

  const loadSessions = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const cached = await window.hermesAPI.listAllSessions(200);
      if (cached.length > 0) setSessions(cached as SessionRow[]);
      const synced = await window.hermesAPI.syncAllSessionCaches();
      setSessions(synced as SessionRow[]);
      await loadGroups();
    } catch (error) {
      console.error("Failed to load sessions", error);
    } finally {
      setLoading(false);
    }
  }, [loadGroups]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // ---- per-session mutations (optimistic, then refresh) ----
  const patchSession = useCallback(
    (id: string, patch: Partial<SessionRow>): void => {
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      );
    },
    [],
  );

  const handlePinToggle = useCallback(
    (s: SessionRow): void => {
      patchSession(s.id, { pinned: !s.pinned });
      void window.hermesAPI.setSessionPinned(s.profile, s.id, !s.pinned);
    },
    [patchSession],
  );

  const handlePauseResume = useCallback(
    (s: SessionRow): void => {
      const next: SessionStatus = s.status === "paused" ? "active" : "paused";
      patchSession(s.id, { status: next });
      void window.hermesAPI.setSessionStatus(s.profile, s.id, next);
    },
    [patchSession],
  );

  const handleMarkComplete = useCallback(
    (s: SessionRow): void => {
      patchSession(s.id, { status: "complete" });
      void window.hermesAPI.setSessionStatus(s.profile, s.id, "complete");
    },
    [patchSession],
  );

  const handleArchiveToggle = useCallback(
    (s: SessionRow): void => {
      patchSession(s.id, { archived: !s.archived });
      void window.hermesAPI.setSessionArchived(s.profile, s.id, !s.archived);
    },
    [patchSession],
  );

  const sessionLink = (s: SessionRow): string =>
    `hermes://session/${encodeURIComponent(s.profile)}/${encodeURIComponent(
      s.id,
    )}`;

  const handleCopyLink = useCallback(
    (s: SessionRow): void => {
      void navigator.clipboard
        ?.writeText(sessionLink(s))
        .then(() => showToast(t("sessions.actions.linkCopied")))
        .catch(() => {
          /* clipboard may be unavailable */
        });
    },
    [showToast, t],
  );

  const handleShare = useCallback(
    (s: SessionRow): void => {
      const link = sessionLink(s);
      const title = s.title || t("sessions.newConversation");
      const nav = navigator as Navigator & {
        share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
      };
      if (typeof nav.share === "function") {
        void nav.share({ title, text: title, url: link }).catch(() => {
          /* user dismissed or unsupported — fall back below */
        });
      } else {
        handleCopyLink(s);
      }
    },
    [handleCopyLink, t],
  );

  const handleMoveToGroup = useCallback(
    (s: SessionRow, groupId: string | null): void => {
      patchSession(s.id, { groupId });
      void window.hermesAPI.moveSessionToGroup(s.profile, s.id, groupId);
    },
    [patchSession],
  );

  const handleNewGroup = useCallback(
    (s: SessionRow): void => {
      const name = window.prompt(t("sessions.newGroupPrompt"));
      if (!name || !name.trim()) return;
      void (async () => {
        const created = await window.hermesAPI.createSessionGroup(
          s.profile,
          name.trim(),
        );
        if (created) {
          await loadGroups();
          patchSession(s.id, { groupId: created.id });
          void window.hermesAPI.moveSessionToGroup(
            s.profile,
            s.id,
            created.id,
          );
        }
      })();
    },
    [t, loadGroups, patchSession],
  );

  // ---- rename ----
  const startRename = useCallback((s: SessionRow): void => {
    setEditingSessionId(s.id);
    setEditingTitle(s.title || "");
    setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 0);
  }, []);

  const cancelRename = useCallback((): void => {
    setEditingSessionId(null);
    setEditingTitle("");
  }, []);

  const confirmRename = useCallback(
    async (sessionId: string, newTitle: string): Promise<void> => {
      const trimmed = newTitle.trim();
      if (!trimmed) {
        cancelRename();
        return;
      }
      const target = sessionById(sessionId);
      patchSession(sessionId, { title: trimmed });
      setSearchResults((prev) =>
        prev.map((r) => (r.id === sessionId ? { ...r, title: trimmed } : r)),
      );
      if (target) {
        try {
          await window.hermesAPI.renameSession(
            target.profile,
            sessionId,
            trimmed,
          );
        } catch (err) {
          console.error("Failed to rename session", sessionId, err);
        }
      }
      if (editingSessionIdRef.current === sessionId) {
        setEditingSessionId(null);
        setEditingTitle("");
      }
    },
    [cancelRename, sessionById, patchSession],
  );

  // ---- delete ----
  const handleDelete = useCallback((s: SessionRow): void => {
    setPendingDelete(s);
  }, []);

  const cancelDelete = useCallback((): void => {
    if (deleting) return;
    setPendingDelete(null);
  }, [deleting]);

  const confirmDelete = useCallback(
    async (s: SessionRow): Promise<void> => {
      setDeleting(true);
      setSessions((prev) => prev.filter((x) => x.id !== s.id));
      setSearchResults((prev) => prev.filter((x) => x.id !== s.id));
      try {
        await window.hermesAPI.deleteSessionInProfile(s.profile, s.id);
      } catch (err) {
        console.error("Failed to delete session", s.id, err);
      } finally {
        await refreshSessions();
        setDeleting(false);
        setPendingDelete(null);
      }
    },
    [refreshSessions],
  );

  // ---- selection / bulk delete ----
  const toggleSelectionMode = useCallback((): void => {
    setIsSelectionMode((active) => {
      if (active) setSelectedSessionIds(new Set());
      return !active;
    });
  }, []);

  const toggleSessionSelected = useCallback((sessionId: string): void => {
    setSelectedSessionIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }, []);

  const cancelBulkDelete = useCallback((): void => {
    if (deletingBulk) return;
    setPendingBulkDelete(null);
  }, [deletingBulk]);

  const confirmBulkDelete = useCallback(
    async (rows: SessionRow[]): Promise<void> => {
      const byProfile: Record<string, string[]> = {};
      for (const r of rows) {
        (byProfile[r.profile] ??= []).push(r.id);
      }
      const idSet = new Set(rows.map((r) => r.id));
      setDeletingBulk(true);
      setSessions((prev) => prev.filter((s) => !idSet.has(s.id)));
      setSearchResults((prev) => prev.filter((r) => !idSet.has(r.id)));
      try {
        await window.hermesAPI.deleteSessionsByProfile(byProfile);
      } catch (err) {
        console.error("Failed to delete selected sessions", err);
      } finally {
        await refreshSessions();
        setDeletingBulk(false);
        setPendingBulkDelete(null);
        setSelectedSessionIds(new Set());
        setIsSelectionMode(false);
      }
    },
    [refreshSessions],
  );

  // Refresh when becoming visible.
  useEffect(() => {
    if (visible) loadSessions();
  }, [visible, loadSessions]);

  // Periodic re-sync while visible.
  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => {
      void refreshSessions();
    }, SESSIONS_REFRESH_MS);
    const onFocus = (): void => {
      void refreshSessions();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [visible, refreshSessions]);

  // Search (across all profiles).
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const query = searchQuery.trim();
    if (!query) {
      searchRequestId.current += 1;
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    const requestId = searchRequestId.current + 1;
    searchRequestId.current = requestId;
    setIsSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const results = await window.hermesAPI.searchAllSessions(query);
        if (searchRequestId.current !== requestId) return;
        setSearchResults(results as SearchRow[]);
      } finally {
        if (searchRequestId.current === requestId) setIsSearching(false);
      }
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [searchQuery]);

  const isShowingSearch = searchQuery.trim().length > 0;

  // ---- derive the visible (non-search) list ----
  const filtered = useMemo(() => {
    return sessions.filter((s) => {
      if (!showArchived && s.archived) return false;
      if (filterGroup === "all") return true;
      if (filterGroup === "none") return !s.groupId;
      return s.groupId === filterGroup;
    });
  }, [sessions, showArchived, filterGroup]);

  const pinned = useMemo(
    () =>
      filtered
        .filter((s) => s.pinned)
        .sort((a, b) => b.startedAt - a.startedAt),
    [filtered],
  );
  const unpinned = useMemo(
    () => filtered.filter((s) => !s.pinned),
    [filtered],
  );
  const grouped = groupSessions(unpinned);

  const visibleSessionIds = useMemo(() => {
    const ids = isShowingSearch
      ? searchResults.map((r) => r.id)
      : filtered.map((s) => s.id);
    return Array.from(new Set(ids));
  }, [isShowingSearch, searchResults, filtered]);
  const visibleSessionIdKey = visibleSessionIds.join(" ");
  const selectedCount = selectedSessionIds.size;
  const allVisibleSelected =
    visibleSessionIds.length > 0 &&
    visibleSessionIds.every((id) => selectedSessionIds.has(id));

  const toggleVisibleSelection = useCallback((): void => {
    setSelectedSessionIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const id of visibleSessionIds) next.delete(id);
      } else {
        for (const id of visibleSessionIds) next.add(id);
      }
      return next;
    });
  }, [allVisibleSelected, visibleSessionIds]);

  useEffect(() => {
    if (!isSelectionMode) return;
    const visibleIds = new Set(visibleSessionIds);
    setSelectedSessionIds((prev) => {
      const next = new Set(Array.from(prev).filter((id) => visibleIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSelectionMode, visibleSessionIdKey]);

  const selectedRows = useCallback(
    (): SessionRow[] =>
      sessions.filter((s) => selectedSessionIds.has(s.id)),
    [sessions, selectedSessionIds],
  );

  const cardActionProps = {
    groups,
    onDelete: handleDelete,
    onRename: startRename,
    onPinToggle: handlePinToggle,
    onPauseResume: handlePauseResume,
    onMarkComplete: handleMarkComplete,
    onCopyLink: handleCopyLink,
    onShare: handleShare,
    onMoveToGroup: handleMoveToGroup,
    onNewGroup: handleNewGroup,
    onArchiveToggle: handleArchiveToggle,
    selectionMode: isSelectionMode,
    selectTitle: t("sessions.selectSession"),
    onToggleSelected: toggleSessionSelected,
    renameInputRef,
    onRenameChange: setEditingTitle,
    onRenameCancel: cancelRename,
  };

  const renderCard = (s: SessionRow, showFullDate: boolean): React.JSX.Element => (
    <SessionCard
      key={s.id}
      session={s}
      isActive={currentSessionId === s.id}
      showFullDate={showFullDate}
      onClick={() => onResumeSession(s.id, s.profile)}
      isRenaming={editingSessionId === s.id}
      renameValue={editingTitle}
      onRenameConfirm={() => confirmRename(s.id, editingTitle)}
      selected={selectedSessionIds.has(s.id)}
      {...cardActionProps}
    />
  );

  return (
    <div className="sessions-container">
      <div className="sessions-header">
        <div className="sessions-header-top">
          <h2 className="sessions-title">{t("sessions.title")}</h2>
          <div className="sessions-header-actions">
            <label className="sessions-archived-toggle">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              {t("sessions.showArchived")}
            </label>
            {groups.length > 0 && (
              <select
                className="sessions-group-filter"
                value={filterGroup}
                onChange={(e) => setFilterGroup(e.target.value)}
                title={t("sessions.filterGroup")}
              >
                <option value="all">{t("sessions.allGroups")}</option>
                <option value="none">{t("sessions.noGroup")}</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              className="btn btn-secondary sessions-select-mode"
              onClick={toggleSelectionMode}
              disabled={loading || visibleSessionIds.length === 0}
            >
              {isSelectionMode
                ? t("sessions.cancelSelect")
                : t("sessions.selectMode")}
            </button>
            <button className="btn btn-primary" onClick={onNewChat}>
              <Plus size={14} />
              {t("sessions.newChat")}
            </button>
          </div>
        </div>
        <div className="sessions-searchbar">
          <Search size={14} className="sessions-searchbar-icon" />
          <input
            ref={searchRef}
            className="sessions-searchbar-input"
            type="text"
            placeholder={t("sessions.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className="btn-ghost sessions-searchbar-clear"
              onClick={() => {
                setSearchQuery("");
                searchRef.current?.focus();
              }}
            >
              <X size={13} />
            </button>
          )}
        </div>
        {isSelectionMode && (
          <div className="sessions-selection-toolbar">
            <span className="sessions-selection-count">
              {t("sessions.selectedCount", { count: selectedCount })}
            </span>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={toggleVisibleSelection}
              disabled={visibleSessionIds.length === 0}
            >
              {allVisibleSelected
                ? t("sessions.clearVisible")
                : t("sessions.selectVisible")}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => setPendingBulkDelete(selectedRows())}
              disabled={selectedCount === 0}
            >
              {t("sessions.deleteSelected")}
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="sessions-loading">
          <div className="loading-spinner" />
        </div>
      ) : isShowingSearch ? (
        isSearching ? (
          <div className="sessions-loading">
            <div className="loading-spinner" />
          </div>
        ) : searchResults.length === 0 ? (
          <div className="sessions-empty">
            <Search size={32} className="sessions-empty-icon" />
            <p className="sessions-empty-text">{t("sessions.noResults")}</p>
            <p className="sessions-empty-hint">{t("sessions.noResultsHint")}</p>
          </div>
        ) : (
          <div className="sessions-list">
            {searchResults.map((r) => (
              <div key={r.id} className="sessions-search-row">
                {renderCard(r, true)}
                {r.title && r.snippet && (
                  <div className="sessions-result-snippet">
                    {highlightSnippet(r.snippet)}
                  </div>
                )}
                {!r.title && r.snippet && (
                  <div className="sessions-result-snippet">
                    {cleanSearchSnippet(r.snippet)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      ) : filtered.length === 0 ? (
        <div className="sessions-empty">
          <ChatBubble size={32} className="sessions-empty-icon" />
          <p className="sessions-empty-text">{t("sessions.empty")}</p>
          <p className="sessions-empty-hint">{t("sessions.emptyHint")}</p>
        </div>
      ) : (
        <div className="sessions-list">
          {pinned.length > 0 && (
            <div className="sessions-group">
              <div className="sessions-group-label">
                {t("sessions.pinnedSection")}
              </div>
              {pinned.map((s) => renderCard(s, true))}
            </div>
          )}
          {grouped.map((group) => (
            <div key={group.label} className="sessions-group">
              <div className="sessions-group-label">
                {t(`sessions.${group.label}`)}
              </div>
              {group.sessions.map((s) =>
                renderCard(
                  s,
                  group.label === "thisWeek" || group.label === "earlier",
                ),
              )}
            </div>
          ))}
        </div>
      )}

      {pendingDelete && (
        <div
          className="sessions-confirm-overlay"
          onClick={cancelDelete}
          role="presentation"
        >
          <div
            className="sessions-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sessions-delete-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sessions-confirm-header">
              <h3 id="sessions-delete-confirm-title">
                {t("sessions.deleteConfirmTitle")}
              </h3>
              <button
                type="button"
                className="btn-ghost sessions-confirm-close"
                onClick={cancelDelete}
                disabled={deleting}
                aria-label={t("sessions.deleteClose")}
              >
                <X size={16} />
              </button>
            </div>
            <div className="sessions-confirm-body">
              <p>{t("sessions.deleteConfirm")}</p>
            </div>
            <div className="sessions-confirm-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={cancelDelete}
                disabled={deleting}
              >
                {t("sessions.deleteCancel")}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void confirmDelete(pendingDelete)}
                disabled={deleting}
              >
                {deleting
                  ? t("sessions.deleteDeleting")
                  : t("sessions.deleteConfirmAction")}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingBulkDelete && (
        <div
          className="sessions-confirm-overlay"
          onClick={cancelBulkDelete}
          role="presentation"
        >
          <div
            className="sessions-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sessions-bulk-delete-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sessions-confirm-header">
              <h3 id="sessions-bulk-delete-confirm-title">
                {t("sessions.deleteSelectedConfirmTitle")}
              </h3>
              <button
                type="button"
                className="btn-ghost sessions-confirm-close"
                onClick={cancelBulkDelete}
                disabled={deletingBulk}
                aria-label={t("sessions.deleteSelectedClose")}
              >
                <X size={16} />
              </button>
            </div>
            <div className="sessions-confirm-body">
              <p>
                {t("sessions.deleteSelectedConfirm", {
                  count: pendingBulkDelete.length,
                })}
              </p>
            </div>
            <div className="sessions-confirm-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={cancelBulkDelete}
                disabled={deletingBulk}
              >
                {t("sessions.deleteCancel")}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void confirmBulkDelete(pendingBulkDelete)}
                disabled={deletingBulk}
              >
                {deletingBulk
                  ? t("sessions.deleteDeleting")
                  : t("sessions.deleteConfirmAction")}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="sessions-toast">{toast}</div>}
    </div>
  );
}

export default Sessions;
