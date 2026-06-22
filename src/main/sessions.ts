import Database from "better-sqlite3";
import { existsSync } from "fs";
import {
  stateDbPathForProfile,
  listAllStateDbPaths,
} from "./utils";
import type { Attachment } from "../shared/attachments";
import { isImageMime } from "../shared/attachments";
import { clearStagedAttachments } from "./attachment-staging";
import { removeSessionFromCache } from "./session-cache";
import { getDbConnection } from "./db";
import {
  attachmentFromLocalVisionImagePath,
  deletePromptImageAttachmentsForSession,
  extractLeadingVisionImageFallback,
  loadPromptImageAttachments,
  stripTrailingImagePlaceholders,
} from "./session-attachment-store";
import {
  deleteSessionContinuationForSession,
  loadSessionContinuationItems,
  loadSessionLocalErrors,
  mergeSessionLocalErrors,
} from "./session-continuation-store";
import { deleteSessionContextFolderForSession } from "./session-context-folder-store";
import { deleteSessionModelOverrideForSession } from "./session-model-override-store";

// Sentinel prefix used by hermes-agent's hermes_state.py to mark
// JSON-encoded multimodal content in the messages.content column.
// See agent source: hermes_state._CONTENT_JSON_PREFIX = "\x00json:".
const CONTENT_JSON_PREFIX = "\x00json:";

export interface SessionSummary {
  id: string;
  source: string;
  startedAt: number;
  endedAt: number | null;
  messageCount: number;
  model: string;
  title: string | null;
  preview: string;
}

export interface SessionMessage {
  id: number;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: number;
  attachments?: Attachment[];
}

/**
 * Renderer-facing union of timeline items reconstructed from the DB.
 *
 * `user` / `assistant` are visible message bubbles. `reasoning`,
 * `tool_call`, and `tool_result` are surfaced as collapsible sub-rows
 * — they exist in the agent's state DB but were dropped on read until
 * this change. We emit them inline at the position they originally
 * occurred so the resumed transcript matches the live conversation.
 */
export type HistoryItem =
  | {
      kind: "user";
      id: number;
      content: string;
      timestamp: number;
      attachments?: Attachment[];
    }
  | {
      kind: "assistant";
      id: number;
      content: string;
      timestamp: number;
      error?: string;
      attachments?: Attachment[];
    }
  | {
      kind: "reasoning";
      id: number;
      assistantId: number;
      text: string;
      timestamp: number;
    }
  | {
      kind: "tool_call";
      id: number;
      assistantId: number;
      callId: string;
      name: string;
      args: string; // pretty-printed JSON when possible, otherwise raw
      timestamp: number;
    }
  | {
      kind: "tool_result";
      id: number;
      callId: string;
      name: string;
      content: string;
      timestamp: number;
      attachments?: Attachment[];
    };

interface DecodedContent {
  text: string;
  attachments: Attachment[];
}

/**
 * Decode the agent's `messages.content` cell.  Plain strings are returned
 * verbatim; values with the agent's JSON-prefix sentinel are unpacked into
 * a text portion (concatenated `{type:"text"}` parts) plus an attachment
 * list (reconstituted from `{type:"image_url"}` parts).  Unknown or
 * malformed shapes fall through to the raw string.
 */
export function decodeContent(raw: string, messageId: number): DecodedContent {
  if (!raw || !raw.startsWith(CONTENT_JSON_PREFIX)) {
    return { text: raw || "", attachments: [] };
  }
  let parts: unknown;
  try {
    parts = JSON.parse(raw.slice(CONTENT_JSON_PREFIX.length));
  } catch {
    return { text: raw, attachments: [] };
  }
  if (!Array.isArray(parts)) {
    return { text: typeof parts === "string" ? parts : raw, attachments: [] };
  }

  const texts: string[] = [];
  const attachments: Attachment[] = [];
  let idx = 0;
  for (const p of parts) {
    if (typeof p === "string") {
      if (p) texts.push(p);
      continue;
    }
    if (!p || typeof p !== "object") continue;
    const type = String(
      (p as Record<string, unknown>).type || "",
    ).toLowerCase();
    if (type === "text" || type === "input_text" || type === "output_text") {
      const t = (p as Record<string, unknown>).text;
      if (typeof t === "string" && t) texts.push(t);
    } else if (type === "image_url" || type === "input_image") {
      const ref = (p as Record<string, unknown>).image_url;
      let url = "";
      if (typeof ref === "string") url = ref;
      else if (ref && typeof ref === "object") {
        const u = (ref as Record<string, unknown>).url;
        if (typeof u === "string") url = u;
      }
      if (!url || !url.startsWith("data:image/")) continue;
      const mime = url.slice("data:".length, url.indexOf(";"));
      attachments.push({
        id: `db-${messageId}-${idx++}`,
        kind: "image",
        name: `image.${guessExtension(mime)}`,
        mime: isImageMime(mime) ? mime : "image/png",
        size: 0,
        dataUrl: url,
      });
    }
  }
  return { text: texts.join("\n\n"), attachments };
}

function guessExtension(mime: string): string {
  switch (mime.toLowerCase()) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    default:
      return "bin";
  }
}

export interface SearchResult {
  sessionId: string;
  title: string | null;
  startedAt: number;
  lastActivity: number;
  source: string;
  messageCount: number;
  model: string;
  snippet: string;
}

export function dedupeSearchRowsBySession<T extends { session_id: string }>(
  rows: T[],
  limit: number,
): T[] {
  const uniqueRows: T[] = [];
  const seenSessionIds = new Set<string>();
  for (const row of rows) {
    if (seenSessionIds.has(row.session_id)) continue;
    seenSessionIds.add(row.session_id);
    uniqueRows.push(row);
    if (uniqueRows.length >= limit) break;
  }
  return uniqueRows;
}

function escapeLikePattern(query: string): string {
  return query.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function highlightTextMatch(text: string, query: string): string {
  if (!text) return "";

  const terms = [query.trim(), ...query.trim().split(/\s+/)]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const term of terms) {
    const index = text.toLocaleLowerCase().indexOf(term.toLocaleLowerCase());
    if (index >= 0) {
      return `${text.slice(0, index)}<<${text.slice(
        index,
        index + term.length,
      )}>>${text.slice(index + term.length)}`;
    }
  }

  return text;
}

function fallbackSessionTitle(sessionId: string): string {
  return `Sessions ${sessionId.slice(-6)}`;
}

function highlightSessionMatch(
  title: string | null,
  sessionId: string,
  query: string,
): string {
  const text = title || "";
  const highlightedTitle = highlightTextMatch(text, query);
  if (highlightedTitle && highlightedTitle.includes("<<")) {
    return highlightedTitle;
  }

  return highlightTextMatch(fallbackSessionTitle(sessionId), query);
}

function decodeSearchSnippet(
  raw: string | null,
  messageId: number,
  query: string,
): string {
  const decoded = decodeContent(raw || "", messageId).text;
  const visible = stripTrailingImagePlaceholders(
    extractLeadingVisionImageFallback(decoded).content,
  );
  return highlightTextMatch(visible || decoded || raw || "", query).slice(
    0,
    500,
  );
}

function getDb(readonly = true): Database.Database | null {
  return getDbConnection(readonly);
}

export function listSessions(limit = 30, offset = 0): SessionSummary[] {
  const db = getDb();
  if (!db) return [];

  // Simple query without correlated subquery — titles come from session cache
  const rows = db
    .prepare(
      `SELECT
        s.id,
        s.source,
        s.started_at,
        s.ended_at,
        s.message_count,
        s.model,
        s.title
      FROM sessions s
      ORDER BY s.started_at DESC
      LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as Array<{
    id: string;
    source: string;
    started_at: number;
    ended_at: number | null;
    message_count: number;
    model: string;
    title: string | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    messageCount: r.message_count,
    model: r.model || "",
    title: r.title,
    preview: "",
  }));
}

export function searchSessions(query: string, limit = 20): SearchResult[] {
  const db = getDb();
  if (!db) return [];

  try {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return [];

    const titleRows = db
      .prepare(
        `SELECT
          s.id as session_id,
          s.title,
          s.started_at,
          s.source,
          s.message_count,
          s.model
        FROM sessions s
        WHERE LOWER(COALESCE(s.title, '')) LIKE ? ESCAPE '\\'
          OR LOWER(s.id) LIKE ? ESCAPE '\\'
        ORDER BY s.started_at DESC
        LIMIT ?`,
      )
      .all(
        `%${escapeLikePattern(trimmedQuery.toLocaleLowerCase())}%`,
        `%${escapeLikePattern(trimmedQuery.toLocaleLowerCase())}%`,
        limit,
      ) as Array<{
      session_id: string;
      title: string | null;
      started_at: number;
      source: string;
      message_count: number;
      model: string;
    }>;

    const titleMatches = titleRows.map((r) => ({
      ...r,
      snippet: highlightSessionMatch(r.title, r.session_id, trimmedQuery),
    }));

    // Check if FTS table exists
    const tableCheck = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='messages_fts'",
      )
      .get() as { name: string } | undefined;

    // Sanitize query for FTS5: wrap each word with quotes for safety, add * for prefix
    const sanitized = trimmedQuery
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0)
      .map((w) => `"${w.replace(/"/g, "")}"*`)
      .join(" ");

    const ftsRows = tableCheck
      ? (db
          .prepare(
            `SELECT DISTINCT
              m.session_id,
              s.title,
              s.started_at,
              s.source,
              s.message_count,
              s.model,
              snippet(messages_fts, 0, '<<', '>>', '...', 40) as snippet
            FROM messages_fts
            JOIN messages m ON m.id = messages_fts.rowid
            JOIN sessions s ON s.id = m.session_id
            WHERE messages_fts MATCH ?
            ORDER BY rank
            LIMIT ?`,
          )
          .all(sanitized, Math.max(limit * 5, limit)) as Array<{
          session_id: string;
          title: string | null;
          started_at: number;
          source: string;
          message_count: number;
          model: string;
          snippet: string;
        }>)
      : [];

    const messageRows = db
      .prepare(
        `SELECT
          m.id as message_id,
          m.content,
          m.session_id,
          s.title,
          s.started_at,
          s.source,
          s.message_count,
          s.model
        FROM messages m
        JOIN sessions s ON s.id = m.session_id
        WHERE LOWER(COALESCE(m.content, '')) LIKE ? ESCAPE '\\'
        ORDER BY s.started_at DESC, m.timestamp ASC, m.id ASC
        LIMIT ?`,
      )
      .all(
        `%${escapeLikePattern(trimmedQuery.toLocaleLowerCase())}%`,
        Math.max(limit * 8, 50),
      ) as Array<{
      message_id: number;
      content: string | null;
      session_id: string;
      title: string | null;
      started_at: number;
      source: string;
      message_count: number;
      model: string;
    }>;

    const messageMatches = messageRows.map((r) => ({
      session_id: r.session_id,
      title: r.title,
      started_at: r.started_at,
      source: r.source,
      message_count: r.message_count,
      model: r.model,
      snippet: decodeSearchSnippet(r.content, r.message_id, trimmedQuery),
    }));

    const uniqueRows = dedupeSearchRowsBySession(
      [...titleMatches, ...ftsRows, ...messageMatches],
      limit,
    );
    return uniqueRows.map((r) => ({
      sessionId: r.session_id,
      title: r.title,
      startedAt: r.started_at,
      // No per-session last-activity column is selected by these queries, so
      // fall back to started_at — callers use lastActivity only for ordering/
      // display and the rows are already ordered by recency. Keeps the value a
      // real number (satisfies SearchResult) without a schema/query change.
      lastActivity: r.started_at,
      source: r.source,
      messageCount: r.message_count,
      model: r.model || "",
      snippet: r.snippet || "",
    }));
  } catch {
    return [];
  }
}

/**
 * Try hard to extract human-readable reasoning text from one of the three
 * provider-specific columns the agent stores it in. Returns "" when nothing
 * usable is present.
 *
 * Priority: `reasoning` (plain text from most providers) >
 *           `reasoning_content` (legacy mirror) >
 *           `reasoning_details` (Anthropic / OpenRouter signed-block JSON;
 *            we flatten its `text` fields when present, otherwise drop it).
 */
export function pickReasoning(row: {
  reasoning: string | null;
  reasoning_content: string | null;
  reasoning_details: string | null;
}): string {
  const direct = (row.reasoning || "").trim();
  if (direct) return direct;
  const legacy = (row.reasoning_content || "").trim();
  if (legacy) return legacy;
  const details = (row.reasoning_details || "").trim();
  if (!details) return "";
  try {
    const parsed = JSON.parse(details);
    if (typeof parsed === "string") return parsed;
    if (Array.isArray(parsed)) {
      const texts: string[] = [];
      for (const entry of parsed) {
        if (!entry || typeof entry !== "object") continue;
        const e = entry as Record<string, unknown>;
        if (typeof e.text === "string" && e.text) texts.push(e.text);
        else if (typeof e.thinking === "string" && e.thinking)
          texts.push(e.thinking);
      }
      if (texts.length) return texts.join("\n\n");
    }
  } catch {
    /* fall through */
  }
  return "";
}

/**
 * Parse the assistant row's `tool_calls` JSON. Each entry from the agent
 * looks like `{id, call_id, type:"function", function:{name, arguments}}`.
 * `arguments` is itself a JSON-encoded string the agent sent to the model.
 * We pretty-print it for display when it parses, leave it raw otherwise.
 *
 * Returns `[]` on any parse failure — the caller silently skips bad rows
 * so a malformed tool_calls cell never blocks history rendering.
 */
export function parseToolCalls(
  raw: string | null,
): Array<{ callId: string; name: string; args: string }> {
  if (!raw || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: Array<{ callId: string; name: string; args: string }> = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const fn = (e.function || {}) as Record<string, unknown>;
    const name = typeof fn.name === "string" ? fn.name : "";
    if (!name) continue;
    const callId =
      (typeof e.call_id === "string" && e.call_id) ||
      (typeof e.id === "string" && e.id) ||
      "";
    const rawArgs = typeof fn.arguments === "string" ? fn.arguments : "";
    let args = rawArgs;
    try {
      args = JSON.stringify(JSON.parse(rawArgs), null, 2);
    } catch {
      // arguments wasn't JSON — leave as-is
    }
    out.push({ callId, name, args });
  }
  return out;
}

/**
 * Row shape as returned by the widened SELECT inside getSessionMessages,
 * exported so the unit tests can build fixture rows without going through
 * sqlite (better-sqlite3 is an Electron-only native module).
 */
export interface RawMessageRow {
  id: number;
  role: string;
  content: string | null;
  timestamp: number;
  tool_call_id: string | null;
  tool_calls: string | null;
  tool_name: string | null;
  reasoning: string | null;
  reasoning_content: string | null;
  reasoning_details: string | null;
}

/**
 * Pure expansion of DB rows → renderer-facing HistoryItem list. Kept pure
 * (no I/O) so we can exercise the ordering and edge-case logic directly
 * without booting sqlite.
 */
export function expandRowsToHistory(rows: RawMessageRow[]): HistoryItem[] {
  const items: HistoryItem[] = [];
  for (const r of rows) {
    const decoded = decodeContent(r.content || "", r.id);

    if (r.role === "user") {
      if (!decoded.text && decoded.attachments.length === 0) continue;
      items.push({
        kind: "user",
        id: r.id,
        content: decoded.text,
        timestamp: r.timestamp,
        ...(decoded.attachments.length > 0
          ? { attachments: decoded.attachments }
          : {}),
      });
      continue;
    }

    if (r.role === "assistant") {
      const reasoningText = pickReasoning(r);
      if (reasoningText) {
        items.push({
          kind: "reasoning",
          id: r.id,
          assistantId: r.id,
          text: reasoningText,
          timestamp: r.timestamp,
        });
      }

      if (decoded.text || decoded.attachments.length > 0) {
        items.push({
          kind: "assistant",
          id: r.id,
          content: decoded.text,
          timestamp: r.timestamp,
          ...(decoded.attachments.length > 0
            ? { attachments: decoded.attachments }
            : {}),
        });
      }

      for (const tc of parseToolCalls(r.tool_calls)) {
        items.push({
          kind: "tool_call",
          id: r.id,
          assistantId: r.id,
          callId: tc.callId,
          name: tc.name,
          args: tc.args,
          timestamp: r.timestamp,
        });
      }
      continue;
    }

    if (r.role === "tool") {
      const name = r.tool_name || "tool";
      items.push({
        kind: "tool_result",
        id: r.id,
        callId: r.tool_call_id || "",
        name,
        content: decoded.text,
        timestamp: r.timestamp,
        ...(decoded.attachments.length > 0
          ? { attachments: decoded.attachments }
          : {}),
      });
      continue;
    }
  }
  return items;
}

export function mergeStoredPromptImageAttachments(
  items: HistoryItem[],
  attachmentsByMessageId: Map<number, Attachment[]>,
): HistoryItem[] {
  return items.map((item) => {
    if (item.kind !== "user") return item;
    const fallback = extractLeadingVisionImageFallback(item.content);
    const stored = attachmentsByMessageId.get(item.id);
    const fallbackAttachment = attachmentFromLocalVisionImagePath(
      fallback.imagePath,
      `db-fallback-att-${item.id}-0`,
    );
    const nextContent = stripTrailingImagePlaceholders(fallback.content);
    const nextAttachments =
      item.attachments && item.attachments.length > 0
        ? item.attachments
        : stored && stored.length > 0
          ? stored
          : fallbackAttachment
            ? [fallbackAttachment]
            : undefined;

    if (
      nextContent === item.content &&
      (!nextAttachments || nextAttachments === item.attachments)
    ) {
      return item;
    }

    return {
      ...item,
      content: nextContent,
      ...(nextAttachments && nextAttachments.length > 0
        ? { attachments: nextAttachments }
        : {}),
    };
  });
}

export function getSessionMessages(sessionId: string): HistoryItem[] {
  const db = getDb();
  if (!db) return [];

  const rows = db
    .prepare(
      `SELECT id, role, content, timestamp,
              tool_call_id, tool_calls, tool_name,
              reasoning, reasoning_content, reasoning_details
       FROM messages
       WHERE session_id = ? AND role IN ('user', 'assistant', 'tool')
       ORDER BY timestamp, id`,
    )
    .all(sessionId) as RawMessageRow[];

  const items = expandRowsToHistory(rows);
  const canonical = mergeStoredPromptImageAttachments(
    items,
    loadPromptImageAttachments(db, sessionId),
  );
  return applySessionLocalOverlays(sessionId, canonical, db);
}

export function applySessionLocalOverlays(
  sessionId: string,
  items: HistoryItem[],
  existingDb?: Database.Database | null,
): HistoryItem[] {
  const db = existingDb ?? getDb();
  if (!db) return items;
  const canonical = mergeStoredPromptImageAttachments(
    items,
    loadPromptImageAttachments(db, sessionId),
  );
  const withLocalErrors = mergeSessionLocalErrors(
    canonical,
    loadSessionLocalErrors(db, sessionId),
  );
  return [...loadSessionContinuationItems(db, sessionId), ...withLocalErrors];
}

export interface DeleteSessionsResult {
  requested: number;
  deleted: number;
}

function normalizeSessionIds(sessionIds: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const id of sessionIds) {
    if (typeof id !== "string") continue;
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

function deleteSessionRows(db: Database.Database, sessionId: string): number {
  deletePromptImageAttachmentsForSession(db, sessionId);
  deleteSessionContinuationForSession(db, sessionId);
  deleteSessionContextFolderForSession(db, sessionId);
  deleteSessionModelOverrideForSession(db, sessionId);
  db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
  const result = db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  return result.changes;
}

function cleanupDeletedSession(sessionId: string): void {
  clearStagedAttachments(sessionId);
  removeSessionFromCache(sessionId);
}

export function deleteSession(sessionId: string): void {
  const id = normalizeSessionIds([sessionId])[0];
  if (!id) return;

  const db = getDb(false);

  if (db) {
    const tx = db.transaction((sessionIdToDelete: string) => {
      deleteSessionRows(db, sessionIdToDelete);
    });
    tx(id);
  }

  cleanupDeletedSession(id);
}

export function deleteSessions(sessionIds: string[]): DeleteSessionsResult {
  const ids = normalizeSessionIds(sessionIds);
  let deleted = 0;

  const db = getDb(false);

  if (db) {
    const tx = db.transaction((idsToDelete: string[]) => {
      for (const id of idsToDelete) {
        deleted += deleteSessionRows(db, id);
      }
    });
    tx(ids);
  }

  for (const id of ids) {
    cleanupDeletedSession(id);
  }

  return { requested: ids.length, deleted };
}

// ===========================================================================
// Multi-profile aggregation + desktop-owned session metadata (issue: sessions
// disappeared because the desktop only read the active profile's state.db).
//
// Sessions live per-profile on disk. The desktop now lists across every
// profile DB and tags each row with its profile so resume/rename/delete can
// reopen the right DB. Extra UI state the engine doesn't model — pin, paused/
// complete status, and groups — is stored in two desktop-owned tables created
// lazily in each profile's state.db. They never collide with engine writes.
// ===========================================================================

export type SessionStatus = "active" | "paused" | "complete";

export interface SessionMeta {
  pinned: boolean;
  status: SessionStatus;
  groupId: string | null;
  pinnedAt: number | null;
}

export interface SessionGroup {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
  createdAt: number;
}

export interface AggregatedSession {
  id: string;
  profile: string;
  title: string | null;
  startedAt: number;
  /**
   * Timestamp of the most recent message in the session (epoch seconds),
   * falling back to `startedAt` for sessions that have no messages yet. This
   * — not `startedAt` — is what the UI sorts and date-groups by, so a fresh
   * reply on an old conversation floats it back to the top.
   */
  lastActivity: number;
  source: string;
  messageCount: number;
  model: string;
  archived: boolean;
  pinned: boolean;
  status: SessionStatus;
  groupId: string | null;
}

export interface AggregatedSearchResult extends AggregatedSession {
  snippet: string;
}

const DEFAULT_META: SessionMeta = {
  pinned: false,
  status: "active",
  groupId: null,
  pinnedAt: null,
};

/**
 * Create the desktop-owned metadata tables if absent. Idempotent — safe to
 * call on every DB open. These tables are additive and desktop-private; the
 * engine never reads or writes them.
 */
export function ensureDesktopSessionTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS desktop_session_meta (
      session_id  TEXT PRIMARY KEY,
      pinned      INTEGER NOT NULL DEFAULT 0,
      status      TEXT NOT NULL DEFAULT 'active'
                    CHECK(status IN ('active','paused','complete')),
      group_id    TEXT,
      group_order INTEGER,
      pinned_at   REAL
    );
    CREATE TABLE IF NOT EXISTS desktop_session_group (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      color      TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at REAL NOT NULL
    );
  `);
}

/** Open a writable DB for a profile, ensuring desktop tables exist. */
function openProfileDb(
  profile: string,
  readonly: boolean,
): Database.Database | null {
  const dbPath = stateDbPathForProfile(profile);
  if (!existsSync(dbPath)) return null;
  // Always open writable once to ensure the desktop tables exist, even for a
  // "readonly" caller — a readonly handle can't CREATE TABLE. We open writable,
  // ensure, and (for readonly callers) keep using it since better-sqlite3
  // gives no cheap downgrade; the cost is negligible and reads still work.
  const db = new Database(dbPath, readonly ? {} : {});
  try {
    ensureDesktopSessionTables(db);
  } catch {
    // If the schema can't be created (e.g. a corrupt DB) the meta-aware reads
    // below fall back to defaults via try/catch, so don't fail the open.
  }
  return db;
}

function rowToMeta(row: {
  pinned: number | null;
  status: string | null;
  group_id: string | null;
  pinned_at: number | null;
}): SessionMeta {
  const status =
    row.status === "paused" || row.status === "complete"
      ? row.status
      : "active";
  return {
    pinned: !!row.pinned,
    status,
    groupId: row.group_id ?? null,
    pinnedAt: row.pinned_at ?? null,
  };
}

/** Read desktop meta for all sessions in one DB, keyed by session id. */
function readAllMeta(db: Database.Database): Map<string, SessionMeta> {
  const map = new Map<string, SessionMeta>();
  try {
    const rows = db
      .prepare(
        `SELECT session_id, pinned, status, group_id, pinned_at
         FROM desktop_session_meta`,
      )
      .all() as Array<{
      session_id: string;
      pinned: number | null;
      status: string | null;
      group_id: string | null;
      pinned_at: number | null;
    }>;
    for (const r of rows) map.set(r.session_id, rowToMeta(r));
  } catch {
    // table missing / unreadable — every session uses defaults
  }
  return map;
}

/** Does this DB's sessions table carry an `archived` column? (older DBs may not) */
function hasArchivedColumn(db: Database.Database): boolean {
  try {
    const cols = db.prepare(`PRAGMA table_info(sessions)`).all() as Array<{
      name: string;
    }>;
    return cols.some((c) => c.name === "archived");
  } catch {
    return false;
  }
}

/**
 * List sessions across every profile DB, tagged with profile + desktop meta.
 * Best-effort: a DB that fails to open is skipped (the corrupted pre-update
 * snapshot, for instance) rather than crashing the whole list.
 */
export function listAllSessions(limit = 200): AggregatedSession[] {
  const all: AggregatedSession[] = [];
  for (const { profile, dbPath } of listAllStateDbPaths()) {
    let db: Database.Database | null = null;
    try {
      db = new Database(dbPath, { readonly: true });
      const archived = hasArchivedColumn(db);
      const rows = db
        .prepare(
          `SELECT s.id, s.source, s.started_at, s.message_count, s.model, s.title
             ${archived ? ", s.archived" : ""},
             (SELECT MAX(m.timestamp) FROM messages m WHERE m.session_id = s.id)
               AS last_activity
           FROM sessions s
           ORDER BY COALESCE(
             (SELECT MAX(m.timestamp) FROM messages m WHERE m.session_id = s.id),
             s.started_at
           ) DESC
           LIMIT ?`,
        )
        .all(limit) as Array<{
        id: string;
        source: string;
        started_at: number;
        message_count: number;
        model: string;
        title: string | null;
        archived?: number;
        last_activity: number | null;
      }>;
      const meta = readAllMeta(db);
      for (const r of rows) {
        const m = meta.get(r.id) ?? DEFAULT_META;
        all.push({
          id: r.id,
          profile,
          title: r.title,
          startedAt: r.started_at,
          lastActivity: r.last_activity ?? r.started_at,
          source: r.source,
          messageCount: r.message_count,
          model: r.model || "",
          archived: !!r.archived,
          pinned: m.pinned,
          status: m.status,
          groupId: m.groupId,
        });
      }
    } catch (err) {
      console.error(`listAllSessions: skipping ${dbPath}`, err);
    } finally {
      db?.close();
    }
  }
  all.sort((a, b) => b.lastActivity - a.lastActivity);
  return all.slice(0, limit);
}

/** Search across every profile DB; reuses the single-DB searchSessions logic. */
export function searchAllSessions(
  query: string,
  limit = 20,
): AggregatedSearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const all: AggregatedSearchResult[] = [];
  for (const { profile, dbPath } of listAllStateDbPaths()) {
    let db: Database.Database | null = null;
    try {
      db = new Database(dbPath, { readonly: true });
      const meta = readAllMeta(db);
      const archived = hasArchivedColumn(db);
      // Reuse the proven single-DB search by temporarily pointing at this DB.
      const results = searchSessionsInDb(db, trimmed, limit, archived);
      for (const r of results) {
        const m = meta.get(r.sessionId) ?? DEFAULT_META;
        all.push({
          id: r.sessionId,
          profile,
          title: r.title,
          startedAt: r.startedAt,
          lastActivity: r.lastActivity,
          source: r.source,
          messageCount: r.messageCount,
          model: r.model,
          archived: r.archived,
          pinned: m.pinned,
          status: m.status,
          groupId: m.groupId,
          snippet: r.snippet,
        });
      }
    } catch (err) {
      console.error(`searchAllSessions: skipping ${dbPath}`, err);
    } finally {
      db?.close();
    }
  }
  // Title/FTS matches already ranked per-DB; across DBs sort by recency.
  all.sort((a, b) => b.lastActivity - a.lastActivity);
  return all.slice(0, limit);
}

/**
 * Single-DB search body shared by the aggregator. Mirrors `searchSessions`
 * but takes an already-open DB so the aggregator opens each DB once. Returns
 * an `archived` flag per row when the column exists.
 */
function searchSessionsInDb(
  db: Database.Database,
  trimmedQuery: string,
  limit: number,
  archived: boolean,
): Array<SearchResult & { archived: boolean }> {
  const titleRows = db
    .prepare(
      `SELECT s.id as session_id, s.title, s.started_at, s.source,
              s.message_count, s.model ${archived ? ", s.archived" : ""},
              (SELECT MAX(m.timestamp) FROM messages m WHERE m.session_id = s.id)
                AS last_activity
       FROM sessions s
       WHERE LOWER(COALESCE(s.title, '')) LIKE ? ESCAPE '\\'
         OR LOWER(s.id) LIKE ? ESCAPE '\\'
       ORDER BY s.started_at DESC
       LIMIT ?`,
    )
    .all(
      `%${escapeLikePattern(trimmedQuery.toLocaleLowerCase())}%`,
      `%${escapeLikePattern(trimmedQuery.toLocaleLowerCase())}%`,
      limit,
    ) as Array<{
    session_id: string;
    title: string | null;
    started_at: number;
    source: string;
    message_count: number;
    model: string;
    archived?: number;
    last_activity: number | null;
  }>;

  const titleMatches = titleRows.map((r) => ({
    ...r,
    snippet: highlightSessionMatch(r.title, r.session_id, trimmedQuery),
  }));

  const tableCheck = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='messages_fts'",
    )
    .get() as { name: string } | undefined;

  const sanitized = trimmedQuery
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => `"${w.replace(/"/g, "")}"*`)
    .join(" ");

  const ftsRows = tableCheck
    ? (db
        .prepare(
          `SELECT DISTINCT m.session_id, s.title, s.started_at, s.source,
                  s.message_count, s.model ${archived ? ", s.archived" : ""},
                  (SELECT MAX(m2.timestamp) FROM messages m2
                     WHERE m2.session_id = s.id) AS last_activity,
                  snippet(messages_fts, 0, '<<', '>>', '...', 40) as snippet
           FROM messages_fts
           JOIN messages m ON m.id = messages_fts.rowid
           JOIN sessions s ON s.id = m.session_id
           WHERE messages_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(sanitized, Math.max(limit * 5, limit)) as Array<{
        session_id: string;
        title: string | null;
        started_at: number;
        source: string;
        message_count: number;
        model: string;
        archived?: number;
        last_activity: number | null;
        snippet: string;
      }>)
    : [];

  const uniqueRows = dedupeSearchRowsBySession(
    [...titleMatches, ...ftsRows],
    limit,
  );
  return uniqueRows.map((r) => ({
    sessionId: r.session_id,
    title: r.title,
    startedAt: r.started_at,
    lastActivity: r.last_activity ?? r.started_at,
    source: r.source,
    messageCount: r.message_count,
    model: r.model || "",
    snippet: r.snippet || "",
    archived: !!r.archived,
  }));
}

/** Resume a session from a specific profile's DB (not the active-profile file). */
export function getSessionMessagesFromProfile(
  profile: string,
  sessionId: string,
): HistoryItem[] {
  const dbPath = stateDbPathForProfile(profile);
  if (!existsSync(dbPath)) return [];
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .prepare(
        `SELECT id, role, content, timestamp,
                tool_call_id, tool_calls, tool_name,
                reasoning, reasoning_content, reasoning_details
         FROM messages
         WHERE session_id = ? AND role IN ('user', 'assistant', 'tool')
         ORDER BY timestamp, id`,
      )
      .all(sessionId) as RawMessageRow[];
    const items = expandRowsToHistory(rows);
    return mergeStoredPromptImageAttachments(
      items,
      loadPromptImageAttachments(db, sessionId),
    );
  } finally {
    db.close();
  }
}

/** Hard-delete a session from a specific profile's DB. */
export function deleteSessionInProfile(
  profile: string,
  sessionId: string,
): void {
  const id = normalizeSessionIds([sessionId])[0];
  if (!id) return;
  const dbPath = stateDbPathForProfile(profile);
  if (existsSync(dbPath)) {
    const db = new Database(dbPath);
    try {
      const tx = db.transaction((sid: string) => {
        deleteSessionRows(db, sid);
        try {
          db.prepare("DELETE FROM desktop_session_meta WHERE session_id = ?").run(
            sid,
          );
        } catch {
          /* meta table may not exist */
        }
      });
      tx(id);
    } finally {
      db.close();
    }
  }
  cleanupDeletedSession(id);
}

/** Bulk-delete sessions grouped by profile. */
export function deleteSessionsByProfile(
  byProfile: Record<string, string[]>,
): DeleteSessionsResult {
  let requested = 0;
  let deleted = 0;
  for (const [profile, ids] of Object.entries(byProfile)) {
    const norm = normalizeSessionIds(ids);
    requested += norm.length;
    const dbPath = stateDbPathForProfile(profile);
    if (existsSync(dbPath)) {
      const db = new Database(dbPath);
      try {
        const tx = db.transaction((list: string[]) => {
          for (const id of list) {
            deleted += deleteSessionRows(db, id);
            try {
              db.prepare(
                "DELETE FROM desktop_session_meta WHERE session_id = ?",
              ).run(id);
            } catch {
              /* meta table may not exist */
            }
          }
        });
        tx(norm);
      } finally {
        db.close();
      }
    }
    for (const id of norm) cleanupDeletedSession(id);
  }
  return { requested, deleted };
}

/** Rename a session's title in a specific profile's DB. */
export function renameSessionInProfile(
  profile: string,
  sessionId: string,
  title: string,
): void {
  const dbPath = stateDbPathForProfile(profile);
  if (!existsSync(dbPath)) return;
  const db = new Database(dbPath);
  try {
    db.prepare("UPDATE sessions SET title = ? WHERE id = ?").run(
      title,
      sessionId,
    );
  } finally {
    db.close();
  }
}

/** Flip a session's engine-side `archived` flag in a specific profile's DB. */
export function setSessionArchived(
  profile: string,
  sessionId: string,
  archived: boolean,
): void {
  const dbPath = stateDbPathForProfile(profile);
  if (!existsSync(dbPath)) return;
  const db = new Database(dbPath);
  try {
    if (!hasArchivedColumn(db)) return; // older DB without the column
    db.prepare("UPDATE sessions SET archived = ? WHERE id = ?").run(
      archived ? 1 : 0,
      sessionId,
    );
  } finally {
    db.close();
  }
}

function upsertMeta(
  profile: string,
  sessionId: string,
  patch: Partial<{
    pinned: boolean;
    status: SessionStatus;
    groupId: string | null;
    pinnedAt: number | null;
  }>,
): void {
  const db = openProfileDb(profile, false);
  if (!db) return;
  try {
    // Insert a default row if absent, then patch the requested columns.
    db.prepare(
      `INSERT OR IGNORE INTO desktop_session_meta (session_id) VALUES (?)`,
    ).run(sessionId);
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (patch.pinned !== undefined) {
      sets.push("pinned = ?");
      vals.push(patch.pinned ? 1 : 0);
      sets.push("pinned_at = ?");
      vals.push(patch.pinned ? Date.now() / 1000 : null);
    }
    if (patch.status !== undefined) {
      sets.push("status = ?");
      vals.push(patch.status);
    }
    if (patch.groupId !== undefined) {
      sets.push("group_id = ?");
      vals.push(patch.groupId);
    }
    if (sets.length === 0) return;
    vals.push(sessionId);
    db.prepare(
      `UPDATE desktop_session_meta SET ${sets.join(", ")} WHERE session_id = ?`,
    ).run(...vals);
  } finally {
    db.close();
  }
}

export function setSessionPinned(
  profile: string,
  sessionId: string,
  pinned: boolean,
): void {
  upsertMeta(profile, sessionId, { pinned });
}

export function setSessionStatus(
  profile: string,
  sessionId: string,
  status: SessionStatus,
): void {
  upsertMeta(profile, sessionId, { status });
}

export function moveSessionToGroup(
  profile: string,
  sessionId: string,
  groupId: string | null,
): void {
  upsertMeta(profile, sessionId, { groupId });
}

export function listSessionGroups(profile: string): SessionGroup[] {
  const db = openProfileDb(profile, true);
  if (!db) return [];
  try {
    const rows = db
      .prepare(
        `SELECT id, name, color, sort_order, created_at
         FROM desktop_session_group ORDER BY sort_order, created_at`,
      )
      .all() as Array<{
      id: string;
      name: string;
      color: string | null;
      sort_order: number;
      created_at: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      sortOrder: r.sort_order,
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  } finally {
    db.close();
  }
}

/** Aggregate groups across all profiles (UI shows one group list). */
export function listAllSessionGroups(): Array<SessionGroup & { profile: string }> {
  const out: Array<SessionGroup & { profile: string }> = [];
  for (const { profile } of listAllStateDbPaths()) {
    for (const g of listSessionGroups(profile)) out.push({ ...g, profile });
  }
  return out;
}

export function createSessionGroup(
  profile: string,
  name: string,
  color?: string | null,
): SessionGroup | null {
  const db = openProfileDb(profile, false);
  if (!db) return null;
  try {
    const id = `grp-${Date.now().toString(36)}-${Math.floor(
      Math.random() * 1e6,
    ).toString(36)}`;
    const createdAt = Date.now() / 1000;
    const maxOrder = (
      db.prepare(`SELECT MAX(sort_order) as m FROM desktop_session_group`).get() as
        | { m: number | null }
        | undefined
    )?.m;
    const sortOrder = (maxOrder ?? 0) + 1;
    db.prepare(
      `INSERT INTO desktop_session_group (id, name, color, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(id, name, color ?? null, sortOrder, createdAt);
    return { id, name, color: color ?? null, sortOrder, createdAt };
  } finally {
    db.close();
  }
}

export function deleteSessionGroup(profile: string, groupId: string): void {
  const db = openProfileDb(profile, false);
  if (!db) return;
  try {
    const tx = db.transaction((gid: string) => {
      db.prepare("DELETE FROM desktop_session_group WHERE id = ?").run(gid);
      // Un-group any sessions that pointed at it.
      db.prepare(
        "UPDATE desktop_session_meta SET group_id = NULL WHERE group_id = ?",
      ).run(gid);
    });
    tx(groupId);
  } finally {
    db.close();
  }
}
