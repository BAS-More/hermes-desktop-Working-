import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useLayoutEffect,
  memo,
} from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../components/useI18n";
import { Circle, Spinner, Pencil, Copy, Trash, Pause, Play, Check, Send } from "../../assets/icons";

interface RecentSession {
  id: string;
  title: string;
  profile: string;
  pinned: boolean;
  archived: boolean;
  status: "active" | "paused" | "complete";
  groupId: string | null;
}

interface SessionGroupInfo {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
  createdAt: number;
  profile: string;
}

// ChatGPT-style recent list under the Sessions nav item.
export const RECENT_SESSIONS_LIMIT = 5;

// Re-sync cadence while the list is visible. Deliberately slower than the
// Sessions screen (30s) — the sidebar is always on screen, so this interval
// runs for the whole app lifetime when the section is expanded.
const RECENT_REFRESH_MS = 60_000;

// Minimum gap between event-driven refreshes (focus, session switch) so a
// burst of focus/blur events doesn't hammer state.db.
const REFRESH_THROTTLE_MS = 5_000;

function sameSessions(a: RecentSession[], b: RecentSession[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].id !== b[i].id ||
      a[i].title !== b[i].title ||
      a[i].profile !== b[i].profile ||
      a[i].pinned !== b[i].pinned ||
      a[i].archived !== b[i].archived ||
      a[i].status !== b[i].status ||
      a[i].groupId !== b[i].groupId
    )
      return false;
  }
  return true;
}

/**
 * Per-row overflow (⋮) action menu for a sidebar recent-session row. Mirrors
 * the Sessions-screen card menu (same IPC handlers, same i18n keys, same CSS
 * classes) but trimmed to the actions that make sense on a recent list:
 * Pin/Unpin, Rename, Move to group, Copy link, Archive/Unarchive, Delete.
 *
 * Pause/Resume and Mark-complete are intentionally omitted — the sidebar is a
 * navigation shortcut, not the lifecycle manager (that lives on the Sessions
 * screen). Fork is omitted because no fork/duplicate backend exists yet.
 */
const SidebarSessionMenu = memo(function SidebarSessionMenu({
  session,
  groups,
  onPinToggle,
  onPauseResume,
  onMarkComplete,
  onRename,
  onCopyLink,
  onShare,
  onMoveToGroup,
  onArchiveToggle,
  onDelete,
  onOpenWorktree,
}: {
  session: RecentSession;
  groups: SessionGroupInfo[];
  onPinToggle: () => void;
  onPauseResume: () => void;
  onMarkComplete: () => void;
  onRename: () => void;
  onCopyLink: () => void;
  onShare: () => void;
  onMoveToGroup: (groupId: string | null) => void;
  onArchiveToggle: () => void;
  onDelete: () => void;
  onOpenWorktree?: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [groupExpanded, setGroupExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  // Portal popover position (fixed coords) so it escapes the sidebar's
  // overflow:hidden clip. Recomputed each time the menu opens.
  const popoverRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null,
  );

  const close = useCallback((returnFocus = true): void => {
    setOpen(false);
    setGroupExpanded(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  type Item = {
    key: string;
    label: React.ReactNode;
    run: () => void;
    danger?: boolean;
    expander?: boolean;
  };
  const items: Item[] = [];
  items.push({
    key: "pin",
    label: session.pinned
      ? t("sessions.actions.unpin")
      : t("sessions.actions.pin"),
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
    for (const g of groups.filter((g) => g.profile === session.profile)) {
      items.push({
        key: `grp-${g.id}`,
        label: <span style={{ paddingLeft: 16 }}>{g.name}</span>,
        run: () => onMoveToGroup(g.id),
      });
    }
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
    key: "worktree",
    label: "🌿 Open in Worktree",
    run: onOpenWorktree ?? (() => {}),
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

  // Outside-click closes (without stealing focus back to the trigger). The
  // popover is portalled to document.body, so check both the trigger wrapper
  // and the popover element.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      close(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const el = itemRefs.current[Math.min(activeIndex, items.length - 1)];
    if (el) el.focus();
  }, [open, activeIndex, items.length]);

  // Compute the portal popover position from the trigger. Runs on open and
  // whenever the item count changes (group submenu expands/collapses) so the
  // menu stays anchored and flips above the trigger if it would overflow the
  // viewport bottom. Right-aligned to the trigger's right edge.
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const MENU_W = 200;
    const itemH = 27;
    const estH = items.length * itemH + 6;
    const margin = 8;
    let top = r.bottom + 4;
    // Flip above if it would run off the bottom.
    if (top + estH > window.innerHeight - margin) {
      top = Math.max(margin, r.top - 4 - estH);
    }
    let left = r.right - MENU_W;
    if (left < margin) left = margin;
    if (left + MENU_W > window.innerWidth - margin)
      left = window.innerWidth - margin - MENU_W;
    setCoords({ top, left });
  }, [open, items.length]);

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
    if (!item.expander) close();
  };

  return (
    <div className="sessions-menu sidebar-recent-session-menu" ref={ref}>
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
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span aria-hidden>⋮</span>
      </button>
      {open &&
        coords &&
        createPortal(
          <div
            ref={popoverRef}
            className="sessions-menu-popover sidebar-recent-session-popover"
            role="menu"
            aria-label={t("sessions.actions.menu")}
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
            }}
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
          </div>,
          document.body,
        )}
    </div>
  );
});

/**
 * Recent-sessions list rendered under the "Sessions" nav item in the sidebar
 * (like ChatGPT's sidebar chat list). Owns its own data so Layout re-renders
 * (view switches, update banners, …) never trigger fetches, and `memo` keeps
 * it off the render hot path entirely.
 *
 * Each row now carries a ⋮ overflow menu with the same actions as the full
 * Sessions screen (Pin, Rename, Move to group, Copy link, Archive, Delete),
 * wired to the same `window.hermesAPI.*` IPC handlers.
 *
 * Fetch strategy, cheapest first:
 *  - on open: instant read from the sessions.json cache (no DB), then one
 *    sync against state.db to pick up sessions created since the last sync
 *  - while open: refresh on window focus and on a slow interval, throttled
 *  - closed (collapsed section or icon-only sidebar): zero work, renders null
 */
const SidebarRecentSessions = memo(function SidebarRecentSessions({
  open,
  activeProfile,
  currentSessionId,
  loadingSessionIds,
  resumingSessionId,
  onSelect,
}: {
  open: boolean;
  /**
   * Active profile — recency reorders when it changes, so a switch forces a
   * reload. The list itself now aggregates across ALL profiles (so older
   * named-profile sessions are reachable from the sidebar too).
   */
  activeProfile: string;
  currentSessionId: string | null;
  /** Session ids of every run currently generating (multiple run at once). */
  loadingSessionIds: Set<string>;
  /** A session whose history is being fetched for resume (transient spinner). */
  resumingSessionId: string | null;
  onSelect: (sessionId: string, profile: string) => void;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const [sessions, setSessions] = useState<RecentSession[]>([]);
  const [groups, setGroups] = useState<SessionGroupInfo[]>([]);
  const lastRefreshRef = useRef(0);

  // Inline rename state (rename happens in-place on the row, like the
  // Sessions screen — no modal).
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Delete confirmation — a session delete is irreversible, so gate it behind
  // a small confirm popover anchored under the row.
  const [pendingDelete, setPendingDelete] = useState<RecentSession | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const deleteModalRef = useRef<HTMLDivElement>(null);

  const applySessions = useCallback(
    (
      list: Array<{
        id: string;
        title: string | null;
        profile?: string;
        pinned?: boolean;
        archived?: boolean;
        status?: "active" | "paused" | "complete";
        groupId?: string | null;
      }>,
    ): void => {
      const next = list
        .slice(0, RECENT_SESSIONS_LIMIT)
        .map((s) => ({
          id: s.id,
          title: s.title ?? "",
          profile: s.profile ?? "default",
          pinned: s.pinned ?? false,
          archived: s.archived ?? false,
          status: s.status ?? "active",
          groupId: s.groupId ?? null,
        }));
      setSessions((prev) => (sameSessions(prev, next) ? prev : next));
    },
    [],
  );

  const refresh = useCallback(
    async (force = false): Promise<void> => {
      const now = Date.now();
      if (!force && now - lastRefreshRef.current < REFRESH_THROTTLE_MS) return;
      lastRefreshRef.current = now;
      try {
        const synced = await window.hermesAPI.syncAllSessionCaches();
        applySessions(synced);
      } catch {
        // keep whatever we had — the list is best-effort UI sugar
      }
    },
    [applySessions],
  );

  // Load the session groups once when the section opens (needed for the
  // "Move to group" submenu). Cheap and rarely changes.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const g = await window.hermesAPI.listSessionGroups();
        if (!cancelled) setGroups(g);
      } catch {
        /* groups are optional UI sugar */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Initial load when the section opens: paint from the JSON cache
  // immediately (no DB access), then sync once for anything new.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const cached = await window.hermesAPI.listAllSessions(
          RECENT_SESSIONS_LIMIT,
        );
        if (!cancelled && cached.length > 0) applySessions(cached);
      } catch {
        /* ignore cache read errors */
      }
      lastRefreshRef.current = Date.now();
      try {
        const synced = await window.hermesAPI.syncAllSessionCaches();
        if (!cancelled) applySessions(synced);
      } catch {
        // cache read above already painted something
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, applySessions]);

  // While open: pick up background sessions (gateway, cron, other devices)
  // on focus and on a slow timer. No listeners or timers at all when closed.
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => void refresh(), RECENT_REFRESH_MS);
    const onFocus = (): void => {
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [open, refresh]);

  // Resuming/switching sessions reorders recency — refresh (throttled).
  useEffect(() => {
    if (open) void refresh();
  }, [open, currentSessionId, refresh]);

  // Switching agent points the list at a different profile's DB. Force a
  // reload immediately (bypassing the throttle) so the list isn't stale.
  const prevProfileRef = useRef(activeProfile);
  useEffect(() => {
    if (prevProfileRef.current === activeProfile) return;
    prevProfileRef.current = activeProfile;
    void refresh(true);
  }, [activeProfile, refresh]);

  // ── Action handlers (optimistic patch + IPC + reconcile) ────────────────
  const patch = useCallback(
    (id: string, fields: Partial<RecentSession>): void => {
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, ...fields } : s)),
      );
    },
    [],
  );

  const handlePinToggle = useCallback(
    (s: RecentSession): void => {
      const next = !s.pinned;
      patch(s.id, { pinned: next });
      void window.hermesAPI
        .setSessionPinned(s.profile, s.id, next)
        .then(() => refresh(true))
        .catch(() => patch(s.id, { pinned: s.pinned }));
    },
    [patch, refresh],
  );

  const handleArchiveToggle = useCallback(
    (s: RecentSession): void => {
      const next = !s.archived;
      patch(s.id, { archived: next });
      void window.hermesAPI
        .setSessionArchived(s.profile, s.id, next)
        .then(() => refresh(true))
        .catch(() => patch(s.id, { archived: s.archived }));
    },
    [patch, refresh],
  );

  const handlePauseResume = useCallback(
    (s: RecentSession): void => {
      const next: RecentSession["status"] =
        s.status === "paused" ? "active" : "paused";
      patch(s.id, { status: next });
      void window.hermesAPI
        .setSessionStatus(s.profile, s.id, next)
        .then(() => refresh(true))
        .catch(() => patch(s.id, { status: s.status }));
    },
    [patch, refresh],
  );

  const handleMarkComplete = useCallback(
    (s: RecentSession): void => {
      const prev = s.status;
      patch(s.id, { status: "complete" });
      void window.hermesAPI
        .setSessionStatus(s.profile, s.id, "complete")
        .then(() => refresh(true))
        .catch(() => patch(s.id, { status: prev }));
    },
    [patch, refresh],
  );

  const sessionLink = (s: RecentSession): string =>
    `hermes://session/${encodeURIComponent(s.profile)}/${encodeURIComponent(
      s.id,
    )}`;

  const handleShare = useCallback((s: RecentSession): void => {
    const link = sessionLink(s);
    const title = s.title || t("sessions.newConversation");
    const nav = navigator as Navigator & {
      share?: (data: {
        title?: string;
        text?: string;
        url?: string;
      }) => Promise<void>;
    };
    if (typeof nav.share === "function") {
      void nav.share({ title, text: title, url: link }).catch(() => {
        /* dismissed or unsupported — fall back to clipboard */
        void navigator.clipboard?.writeText(link).catch(() => {});
      });
    } else {
      void navigator.clipboard?.writeText(link).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  const handleMoveToGroup = useCallback(
    (s: RecentSession, groupId: string | null): void => {
      const prev = s.groupId;
      patch(s.id, { groupId });
      void window.hermesAPI
        .moveSessionToGroup(s.profile, s.id, groupId)
        .then(() => refresh(true))
        .catch(() => patch(s.id, { groupId: prev }));
    },
    [patch, refresh],
  );

  const handleCopyLink = useCallback((s: RecentSession): void => {
    const link = `hermes://session/${s.profile}/${s.id}`;
    void navigator.clipboard?.writeText(link).catch(() => {
      /* clipboard may be blocked; best-effort */
    });
  }, []);

  const handleOpenWorktree = useCallback((s: RecentSession): void => {
    // Ask the user for the repo path via a dialog, then create the worktree.
    // We use window.hermesAPI.getHermesHome() as a sensible default root.
    void (async () => {
      const home = await window.hermesAPI.getHermesHome(s.profile);
      const result = await window.hermesAPI.worktreeCreate(s.id, home);
      if (result.ok) {
        // Open the worktree directory in the OS file manager.
        void window.open(`file://${result.record.worktreePath}`);
      } else {
        // eslint-disable-next-line no-console
        console.error("[worktree] create failed:", result.error);
      }
    })();
  }, []);

  // Rename (inline)
  const startRename = useCallback((s: RecentSession): void => {
    setRenamingId(s.id);
    setRenameValue(s.title);
  }, []);
  const cancelRename = useCallback((): void => {
    setRenamingId(null);
    setRenameValue("");
  }, []);
  const confirmRename = useCallback(
    async (s: RecentSession): Promise<void> => {
      const title = renameValue.trim();
      if (!title || title === s.title) {
        cancelRename();
        return;
      }
      patch(s.id, { title });
      cancelRename();
      try {
        await window.hermesAPI.renameSession(s.profile, s.id, title);
        void refresh(true);
      } catch {
        void refresh(true);
      }
    },
    [renameValue, cancelRename, patch, refresh],
  );

  // Delete (confirm)
  const confirmDelete = useCallback(async (): Promise<void> => {
    const s = pendingDelete;
    if (!s) return;
    setDeleting(true);
    try {
      await window.hermesAPI.deleteSessionInProfile(s.profile, s.id);
      setSessions((prev) => prev.filter((x) => x.id !== s.id));
      void refresh(true);
    } catch {
      /* leave the row; user can retry */
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  }, [pendingDelete, refresh]);

  // Escape closes the delete confirm.
  useEffect(() => {
    if (!pendingDelete) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setPendingDelete(null);
    };
    document.addEventListener("keydown", onKey);
    const onClick = (e: MouseEvent): void => {
      if (
        deleteModalRef.current &&
        !deleteModalRef.current.contains(e.target as Node)
      )
        setPendingDelete(null);
    };
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [pendingDelete]);

  // Keep the wrapper mounted so the collapse/expand animates. Stay unmounted
  // only until the first sessions arrive, so a brand-new profile renders
  // nothing.
  if (sessions.length === 0) return null;

  const expanded = open;

  return (
    <div
      className={`sidebar-recent-sessions-wrap ${expanded ? "expanded" : ""}`}
      aria-hidden={!expanded}
    >
      <div className="sidebar-recent-sessions">
        {sessions.map((s) => {
          const title = s.title || t("sessions.newConversation");
          const loading =
            resumingSessionId === s.id || loadingSessionIds.has(s.id);
          const active = !loading && currentSessionId === s.id;
          const isRenaming = renamingId === s.id;
          return (
            <div
              key={s.id}
              className={`sidebar-recent-session-row ${active ? "active" : ""}`}
            >
              {isRenaming ? (
                <input
                  className="sidebar-recent-session-rename"
                  autoFocus
                  value={renameValue}
                  aria-label={t("sessions.rename")}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") void confirmRename(s);
                    else if (e.key === "Escape") cancelRename();
                  }}
                  onBlur={() => void confirmRename(s)}
                />
              ) : (
                <button
                  type="button"
                  className="sidebar-recent-session sidebar-recent-session-open"
                  onClick={() => onSelect(s.id, s.profile)}
                  title={title}
                  tabIndex={expanded ? 0 : -1}
                >
                  {loading ? (
                    <Spinner
                      className="sidebar-recent-session-dot sidebar-recent-session-dot--loading"
                      size={11}
                    />
                  ) : (
                    <Circle
                      className={`sidebar-recent-session-dot ${
                        active ? "sidebar-recent-session-dot--active" : ""
                      }`}
                      size={7}
                      fill={active ? "currentColor" : "none"}
                    />
                  )}
                  <span className="sidebar-recent-session-title">{title}</span>
                  {s.pinned && (
                    <span
                      className="sidebar-recent-session-pin"
                      aria-hidden
                      title={t("sessions.pinnedSection")}
                    >
                      ★
                    </span>
                  )}
                </button>
              )}

              {!isRenaming && expanded && (
                <SidebarSessionMenu
                  session={s}
                  groups={groups}
                  onPinToggle={() => handlePinToggle(s)}
                  onPauseResume={() => handlePauseResume(s)}
                  onMarkComplete={() => handleMarkComplete(s)}
                  onRename={() => startRename(s)}
                  onCopyLink={() => handleCopyLink(s)}
                  onShare={() => handleShare(s)}
                  onMoveToGroup={(gid) => handleMoveToGroup(s, gid)}
                  onArchiveToggle={() => handleArchiveToggle(s)}
                  onDelete={() => setPendingDelete(s)}
                  onOpenWorktree={() => handleOpenWorktree(s)}
                />
              )}

              {pendingDelete?.id === s.id && (
                <div
                  className="sidebar-recent-session-delete-confirm"
                  role="dialog"
                  aria-label={t("sessions.deleteConfirmTitle")}
                  ref={deleteModalRef}
                >
                  <p>{t("sessions.deleteConfirm")}</p>
                  <div className="sidebar-recent-session-delete-actions">
                    <button
                      type="button"
                      onClick={() => setPendingDelete(null)}
                      disabled={deleting}
                    >
                      {t("sessions.deleteCancel")}
                    </button>
                    <button
                      type="button"
                      className="sessions-menu-danger"
                      onClick={() => void confirmDelete()}
                      disabled={deleting}
                    >
                      {deleting
                        ? t("sessions.deleteDeleting")
                        : t("sessions.deleteConfirmAction")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

export default SidebarRecentSessions;
