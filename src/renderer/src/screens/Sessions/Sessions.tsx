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
import { useFocusTrap } from "../shared/useFocusTrap";

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
        backgroundColor: color,
        color: "#fff",
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
  const [groupExpanded, setGroupExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Roving focus over the flat list of menu items.
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const close = useCallback((returnFocus = true): void => {
    setOpen(false);
    setGroupExpanded(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Build the flat, ordered list of menu actions. The "move to group" row and
  // its (inline-expanded) group options are part of the same flat sequence so
  // arrow-key roving is linear — no flyout to clip at the viewport edge.
  type Item = { key: string; label: React.ReactNode; run: () => void; danger?: boolean; expander?: boolean };
  const items: Item[] = [];
  items.push({
    key: "pin",
    label: session.pinned ? t("sessions.actions.unpin") : t("sessions.actions.pin"),
    run: onPinToggle,
  });
  items.push({
    key: "pause",
    label:
      session.status === "paused" ? (
        <>
          <Play size={13} /> {t("sessions.actions.resume")}
        </>
      ) : (
        <>
          <Pause size={13} /> {t("sessions.actions.pause")}
        </>
      ),
    run: onPauseResume,
  });
  if (session.status !== "complete") {
    items.push({
      key: "complete",
      label: (
        <>
          <Check size={13} /> {t("sessions.actions.markComplete")}
        </>
      ),
      run: onMarkComplete,
    });
  }
  items.push({
    key: "rename",
    label: (
      <>
        <Pencil size={13} /> {t("sessions.actions.rename")}
      </>
    ),
    run: onRename,
  });
  // The group expander toggles an inline section rather than navigating away.
  items.push({
    key: "move",
    label: (
      <>
        {t("sessions.actions.moveToGroup")}
        <span aria-hidden style={{ marginLeft: "auto" }}>
          {groupExpanded ? "▾" : "▸"}
        </span>
      </>
    ),
    run: () => setGroupExpanded((v) => !v),
    expander: true,
  });
  if (groupExpanded) {
    items.push({
      key: "grp-none",
      label: <span style={{ paddingLeft: 16 }}>{t("sessions.noGroup")}</span>,
      run: () => onMoveToGroup(null),
    });
    for (const g of groups) {
      items.push({
        key: `grp-${g.id}`,
        label: <span style={{ paddingLeft: 16 }}>{g.name}</span>,
        run: () => onMoveToGroup(g.id),
      });
    }
    items.push({
      key: "grp-new",
      label: <span style={{ paddingLeft: 16 }}>{t("sessions.newGroup")}</span>,
      run: onNewGroup,
    });
  }
  items.push({
    key: "copy",
    label: (
      <>
        <Copy size={13} /> {t("sessions.actions.copyLink")}
      </>
    ),
    run: onCopyLink,
  });
  items.push({
    key: "share",
    label: (
      <>
        <Send size={13} /> {t("sessions.actions.share")}
      </>
    ),
    run: onShare,
  });
  items.push({
    key: "archive",
    label: session.archived
      ? t("sessions.actions.unarchive")
      : t("sessions.actions.archive"),
    run: onArchiveToggle,
  });
  items.push({
    key: "delete",
    label: (
      <>
        <Trash size={13} /> {t("sessions.actions.delete")}
      </>
    ),
    run: onDelete,
    danger: true,
  });

  // Outside-click closes (without stealing focus back to the trigger).
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) close(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open, close]);

  // On open, move focus into the popover (first item). Clamp active index when
  // the list length changes (e.g. group section expands/collapses).
  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const el = itemRefs.current[Math.min(activeIndex, items.length - 1)];
    if (el) el.focus();
  }, [open, activeIndex, items.length]);

  const onMenuKeyDown = (e: React.KeyboardEvent): void => {
    e.stopPropagation();
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % items.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + items.length) % items.length);
        break;
      case "Home":
        e.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        e.preventDefault();
        setActiveIndex(items.length - 1);
        break;
      case "Escape":
        e.preventDefault();
        close();
        break;
      case "Tab":
        close(false);
        break;
      default:
        break;
    }
  };

  const activate = (item: Item) => (e: React.MouseEvent): void => {
    e.stopPropagation();
    item.run();
    // Expanders keep the menu open (the group section toggles in place);
    // everything else closes and returns focus to the trigger.
    if (!item.expander) close();
  };

  return (
    <div className="sessions-menu" ref={ref}>
      <button
        type="button"
        ref={triggerRef}
        className="sessions-card-menu-btn"
        title={t("sessions.actions.menu")}
        aria-label={t("sessions.actions.menu")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          // ArrowDown / Enter / Space open the menu and land on the first item.
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span aria-hidden>⋯</span>
      </button>
      {open && (
        <div
          className="sessions-menu-popover"
          role="menu"
          aria-label={t("sessions.actions.menu")}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item, i) => (
            <button
              key={item.key}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              role="menuitem"
              tabIndex={i === activeIndex ? 0 : -1}
              aria-expanded={item.expander ? groupExpanded : undefined}
              className={item.danger ? "sessions-menu-danger" : undefined}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={activate(item)}
            >
              {item.label}
            </button>
          ))}
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
  snippet,
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
  snippet?: React.ReactNode;
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

  // Card structure (a11y fix): the row is a plain <li> container — NOT a
  // role="button" — because it must hold other interactive elements
  // (menu, checkbox, rename input). The "open this session" affordance is a
  // dedicated <button> that wraps the title + time. In selection mode the
  // whole row reads as a checkbox label so a click anywhere toggles selection.
  const openLabel = session.title || "New conversation";
  return (
    <li
      className={`sessions-card ${isActive ? "sessions-card--active" : ""} ${
        selected ? "sessions-card--selected" : ""
      } ${session.pinned ? "sessions-card--pinned" : ""}`}
    >
      <div className="sessions-card-main">
        {selectionMode && (
          <label className="sessions-card-select">
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelected?.(session.id)}
              aria-label={`${selectTitle ?? "Select"}: ${openLabel}`}
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
            aria-label={openLabel}
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
          />
        ) : selectionMode ? (
          // Selection mode: clicking the title body toggles selection.
          <button
            type="button"
            className="sessions-card-open sessions-card-open--select"
            onClick={activate}
            aria-pressed={selected}
          >
            <span className="sessions-card-title">{openLabel}</span>
            <span className="sessions-card-time">
              {showFullDate
                ? formatFullDate(session.startedAt)
                : formatTime(session.startedAt)}
            </span>
          </button>
        ) : (
          // Normal mode: real button to open/resume the session.
          <button
            type="button"
            className="sessions-card-open"
            onClick={activate}
            aria-label={`Open ${openLabel}`}
          >
            <span className="sessions-card-title">{openLabel}</span>
            <span className="sessions-card-time">
              {showFullDate
                ? formatFullDate(session.startedAt)
                : formatTime(session.startedAt)}
            </span>
          </button>
        )}
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
      {snippet}
    </li>
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
  const [toast, setToast] = useState<{ msg: string; undo?: () => void } | null>(
    null,
  );
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
  // New-group modal. `target` is the session to drop into the new group after
  // creation, or "header" when created from the toolbar button (no session).
  const [newGroupCtx, setNewGroupCtx] = useState<
    { profile: string; target: SessionRow | "header" } | null
  >(null);
  const [newGroupName, setNewGroupName] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRequestId = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const newGroupModalRef = useRef<HTMLDivElement>(null);
  const newGroupInputRef = useRef<HTMLInputElement>(null);
  const deleteModalRef = useRef<HTMLDivElement>(null);
  const bulkDeleteModalRef = useRef<HTMLDivElement>(null);

  // Rename state
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const editingSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    editingSessionIdRef.current = editingSessionId;
  }, [editingSessionId]);

  const showToast = useCallback((msg: string, undo?: () => void): void => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, undo });
    // Longer dwell when an Undo is offered, so the user can actually catch it.
    toastTimer.current = setTimeout(() => setToast(null), undo ? 6000 : 4000);
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
      const prev = s.status;
      patchSession(s.id, { status: "complete" });
      void window.hermesAPI.setSessionStatus(s.profile, s.id, "complete");
      showToast(t("sessions.actions.markedComplete"), () => {
        patchSession(s.id, { status: prev });
        void window.hermesAPI.setSessionStatus(s.profile, s.id, prev);
      });
    },
    [patchSession, showToast, t],
  );

  const handleArchiveToggle = useCallback(
    (s: SessionRow): void => {
      const next = !s.archived;
      patchSession(s.id, { archived: next });
      void window.hermesAPI.setSessionArchived(s.profile, s.id, next);
      // Archiving removes the card from the default view — always offer Undo so
      // it never feels like a session "disappeared". Unarchiving is benign, no
      // toast needed.
      if (next) {
        showToast(t("sessions.actions.archived"), () => {
          patchSession(s.id, { archived: false });
          void window.hermesAPI.setSessionArchived(s.profile, s.id, false);
        });
      }
    },
    [patchSession, showToast, t],
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

  // Open the styled new-group modal. From a card's menu we remember the
  // session so it's dropped into the group on create; from the header button
  // there's no session (target "header") and we just create the group.
  const handleNewGroup = useCallback((s: SessionRow): void => {
    setNewGroupName("");
    setNewGroupCtx({ profile: s.profile, target: s });
  }, []);

  const handleNewGroupFromHeader = useCallback((): void => {
    // Header groups attach to the first profile present in the list (groups
    // are per-profile); fall back to "default" for an empty list.
    const profile = sessions[0]?.profile ?? "default";
    setNewGroupName("");
    setNewGroupCtx({ profile, target: "header" });
  }, [sessions]);

  const closeNewGroup = useCallback((): void => setNewGroupCtx(null), []);

  const submitNewGroup = useCallback((): void => {
    const ctx = newGroupCtx;
    const name = newGroupName.trim();
    if (!ctx || !name) return;
    void (async () => {
      const created = await window.hermesAPI.createSessionGroup(
        ctx.profile,
        name,
      );
      if (created) {
        await loadGroups();
        if (ctx.target !== "header") {
          patchSession(ctx.target.id, { groupId: created.id });
          void window.hermesAPI.moveSessionToGroup(
            ctx.profile,
            ctx.target.id,
            created.id,
          );
        }
        setFilterGroup(created.id);
      }
      setNewGroupCtx(null);
    })();
  }, [newGroupCtx, newGroupName, loadGroups, patchSession]);

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

  // Focus management for the three modals: trap Tab inside, Escape closes,
  // focus returns to the opener on close (WCAG 2.4.3 / 2.1.2).
  useFocusTrap(!!pendingDelete, deleteModalRef, cancelDelete);
  useFocusTrap(!!pendingBulkDelete, bulkDeleteModalRef, cancelBulkDelete);
  useFocusTrap(!!newGroupCtx, newGroupModalRef, closeNewGroup);

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

  const renderCard = (
    s: SessionRow,
    showFullDate: boolean,
    snippet?: React.ReactNode,
  ): React.JSX.Element => (
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
      snippet={snippet}
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
                aria-label={t("sessions.filterGroup")}
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
              className="btn btn-secondary"
              onClick={handleNewGroupFromHeader}
              disabled={loading}
            >
              <Plus size={14} />
              {t("sessions.newGroup")}
            </button>
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
              type="button"
              className="btn-ghost sessions-searchbar-clear"
              aria-label={t("sessions.clearSearch")}
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
            <div
              className="sessions-result-count"
              role="status"
              aria-live="polite"
            >
              {t("sessions.resultCount", { count: searchResults.length })}
            </div>
            {groupSessions(searchResults).map((group) => {
              const labelId = `sessions-search-grp-${group.label}`;
              return (
                <section
                  key={group.label}
                  className="sessions-group"
                  aria-labelledby={labelId}
                >
                  <h3 id={labelId} className="sessions-group-label">
                    {t(`sessions.${group.label}`)}
                  </h3>
                  <ul className="sessions-card-list" role="list">
                    {group.sessions.map((s) => {
                      const r = s as SearchRow;
                      const snippet = r.snippet ? (
                        <div className="sessions-result-snippet">
                          {r.title
                            ? highlightSnippet(r.snippet)
                            : cleanSearchSnippet(r.snippet)}
                        </div>
                      ) : undefined;
                      return renderCard(r, true, snippet);
                    })}
                  </ul>
                </section>
              );
            })}
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
            <section
              className="sessions-group"
              aria-labelledby="sessions-grp-pinned"
            >
              <h3 id="sessions-grp-pinned" className="sessions-group-label">
                {t("sessions.pinnedSection")}
              </h3>
              <ul className="sessions-card-list" role="list">
                {pinned.map((s) => renderCard(s, true))}
              </ul>
            </section>
          )}
          {grouped.map((group) => {
            const labelId = `sessions-grp-${group.label}`;
            return (
              <section
                key={group.label}
                className="sessions-group"
                aria-labelledby={labelId}
              >
                <h3 id={labelId} className="sessions-group-label">
                  {t(`sessions.${group.label}`)}
                </h3>
                <ul className="sessions-card-list" role="list">
                  {group.sessions.map((s) =>
                    renderCard(
                      s,
                      group.label === "thisWeek" || group.label === "earlier",
                    ),
                  )}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {pendingDelete && (
        <div
          className="sessions-confirm-overlay"
          onClick={cancelDelete}
          role="presentation"
        >
          <div
            ref={deleteModalRef}
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
            ref={bulkDeleteModalRef}
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

      {newGroupCtx && (
        <div
          className="sessions-confirm-overlay"
          onClick={closeNewGroup}
          role="presentation"
        >
          <div
            ref={newGroupModalRef}
            className="sessions-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sessions-newgroup-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sessions-confirm-header">
              <h3 id="sessions-newgroup-title">{t("sessions.newGroupTitle")}</h3>
              <button
                type="button"
                className="btn-ghost sessions-confirm-close"
                onClick={closeNewGroup}
                aria-label={t("sessions.deleteCancel")}
              >
                <X size={16} />
              </button>
            </div>
            <div className="sessions-confirm-body">
              <label
                htmlFor="sessions-newgroup-input"
                className="sessions-newgroup-label"
              >
                {t("sessions.newGroupPrompt")}
              </label>
              <input
                id="sessions-newgroup-input"
                ref={newGroupInputRef}
                className="sessions-newgroup-input"
                type="text"
                value={newGroupName}
                placeholder={t("sessions.newGroupPlaceholder")}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitNewGroup();
                  }
                }}
              />
            </div>
            <div className="sessions-confirm-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={closeNewGroup}
              >
                {t("sessions.deleteCancel")}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={submitNewGroup}
                disabled={!newGroupName.trim()}
              >
                {t("sessions.newGroupCreate")}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="sessions-toast" role="status" aria-live="polite">
          <span>{toast.msg}</span>
          {toast.undo && (
            <button
              type="button"
              className="sessions-toast-undo"
              onClick={() => {
                toast.undo?.();
                setToast(null);
              }}
            >
              {t("sessions.actions.undo")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default Sessions;
