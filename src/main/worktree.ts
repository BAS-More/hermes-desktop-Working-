/**
 * worktree.ts — Git worktree lifecycle manager for Hermes Desktop
 *
 * Security model (per o3 audit):
 *  - repoPath validated against allowlist (homedir + explicit additions)
 *  - sessionId sanitised to [a-zA-Z0-9_-] before use as branch name
 *  - execFile used throughout (no shell expansion)
 *  - Stale worktrees pruned on startup
 */

import { execFile } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WorktreeRecord {
  sessionId: string
  repoPath: string
  worktreePath: string
  branch: string
  createdAt: string
}

export type WorktreeCreateResult =
  | { ok: true; record: WorktreeRecord }
  | { ok: false; error: string }

// ─── Path helpers ─────────────────────────────────────────────────────────────

/** Base directory where all session worktrees are stored */
function worktreesBase(repoPath: string): string {
  return path.join(repoPath, '.hermes', 'worktrees')
}

/** Sanitise sessionId → safe branch-name segment (alphanumeric + hyphen only) */
function sanitiseSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40)
}

// ─── Allowlist validation ─────────────────────────────────────────────────────

const _allowedRoots: Set<string> = new Set([os.homedir()])

export function addAllowedRoot(p: string): void {
  _allowedRoots.add(path.resolve(p))
}

function assertPathAllowed(p: string): void {
  const resolved = path.resolve(p)
  for (const root of _allowedRoots) {
    if (resolved === root || resolved.startsWith(root + path.sep)) return
  }
  throw new Error(`repoPath not in allowed roots: ${resolved}`)
}

// ─── Core operations ──────────────────────────────────────────────────────────

/** Return true if `dir` is a git repo root (has .git) */
async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['-C', dir, 'rev-parse', '--git-dir'])
    return true
  } catch {
    return false
  }
}

/**
 * Create a new git worktree for a session.
 * Branch name: session/<sanitisedSessionId>
 * Path:        <repoPath>/.hermes/worktrees/<sanitisedSessionId>
 */
export async function createWorktree(
  sessionId: string,
  repoPath: string
): Promise<WorktreeCreateResult> {
  try {
    assertPathAllowed(repoPath)

    if (!(await isGitRepo(repoPath))) {
      return { ok: false, error: `Not a git repository: ${repoPath}` }
    }

    const safe = sanitiseSessionId(sessionId)
    const branch = `session/${safe}`
    const worktreePath = path.join(worktreesBase(repoPath), safe)

    // Idempotent: if the worktree dir already exists, return it
    if (fs.existsSync(worktreePath)) {
      const record: WorktreeRecord = {
        sessionId,
        repoPath,
        worktreePath,
        branch,
        createdAt: new Date().toISOString()
      }
      return { ok: true, record }
    }

    fs.mkdirSync(path.dirname(worktreePath), { recursive: true })

    await execFileAsync('git', [
      '-C', repoPath,
      'worktree', 'add',
      worktreePath,
      '-b', branch
    ])

    const record: WorktreeRecord = {
      sessionId,
      repoPath,
      worktreePath,
      branch,
      createdAt: new Date().toISOString()
    }

    return { ok: true, record }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

/**
 * Remove a session worktree + delete its branch.
 */
export async function removeWorktree(
  sessionId: string,
  repoPath: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    assertPathAllowed(repoPath)

    const safe = sanitiseSessionId(sessionId)
    const branch = `session/${safe}`
    const worktreePath = path.join(worktreesBase(repoPath), safe)

    if (fs.existsSync(worktreePath)) {
      await execFileAsync('git', ['-C', repoPath, 'worktree', 'remove', '--force', worktreePath])
    }

    // Delete the branch if it exists
    try {
      await execFileAsync('git', ['-C', repoPath, 'branch', '-D', branch])
    } catch {
      // Branch may not exist — not an error
    }

    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

/**
 * List all active worktrees for a repo (parses `git worktree list --porcelain`).
 * Filters to session/* branches only.
 */
export async function listWorktrees(repoPath: string): Promise<WorktreeRecord[]> {
  try {
    assertPathAllowed(repoPath)

    const { stdout } = await execFileAsync('git', [
      '-C', repoPath,
      'worktree', 'list', '--porcelain'
    ])

    const records: WorktreeRecord[] = []
    const blocks = stdout.trim().split(/\n\n/)

    for (const block of blocks) {
      const lines = block.split('\n')
      const wPath = lines.find(l => l.startsWith('worktree '))?.slice('worktree '.length) ?? ''
      const branch = lines.find(l => l.startsWith('branch '))?.slice('branch '.length).replace('refs/heads/', '') ?? ''

      if (!branch.startsWith('session/')) continue

      const sessionId = branch.replace('session/', '')
      records.push({
        sessionId,
        repoPath,
        worktreePath: wPath,
        branch,
        createdAt: ''
      })
    }

    return records
  } catch {
    return []
  }
}

/**
 * Prune stale worktrees (those whose directories no longer exist).
 * Call on app startup.
 */
export async function pruneWorktrees(repoPath: string): Promise<void> {
  try {
    assertPathAllowed(repoPath)
    await execFileAsync('git', ['-C', repoPath, 'worktree', 'prune'])
  } catch {
    // Non-fatal — best effort
  }
}
