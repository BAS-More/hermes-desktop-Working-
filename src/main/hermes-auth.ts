import { spawn, execFile, type ChildProcess } from "child_process";
import { randomBytes, createHash } from "crypto";
import { homedir } from "os";
import {
  HERMES_PYTHON,
  HERMES_REPO,
  HERMES_HOME,
  hermesCliArgs,
  getEnhancedPath,
} from "./installer";
import { HIDDEN_SUBPROCESS_OPTIONS } from "./process-options";
import { profileHome, stripAnsi } from "./utils";

/**
 * Provider identifiers that authenticate via an interactive OAuth flow
 * (`hermes auth add <provider> --type oauth`) rather than a static API
 * key. Mirrors hermes-agent's `_OAUTH_CAPABLE_PROVIDERS` set.
 *
 * `nous` is included even though it also has an API-key variant — the
 * Providers UI now offers both surfaces (an API Key card and an
 * OAuth Sign-in card, issue #367), and the OAuth path goes through
 * this gate. The desktop previously excluded `nous` here on the
 * (incorrect) assumption that it used the normal key flow only.
 */
export const OAUTH_LOGIN_PROVIDERS = [
  "openai-codex",
  "xai-oauth",
  "qwen-oauth",
  "google-gemini-cli",
  "minimax-oauth",
  "nous",
] as const;

export type OAuthLoginProvider = (typeof OAUTH_LOGIN_PROVIDERS)[number];

export function isOAuthLoginProvider(
  value: string,
): value is OAuthLoginProvider {
  return (OAUTH_LOGIN_PROVIDERS as readonly string[]).includes(value);
}

export interface OAuthLoginResult {
  success: boolean;
  error?: string;
}

/**
 * Parse a device-code login prompt out of the CLI's streamed output.
 * The OpenAI Codex flow — unlike the browser-loopback providers —
 * prints a URL to open and a short code to enter rather than opening a
 * browser itself. Detecting both lets the desktop open the page and
 * pre-copy the code so the user only has to paste.
 *
 * Returns null until both parts are present. Only an `https:` URL is
 * accepted (the value is fed to `shell.openExternal`).
 */
export function detectDeviceCode(
  text: string,
): { url: string; code: string } | null {
  // `[^\S\n]*` is horizontal-whitespace-only — using `\s*` here would
  // silently consume a blank line between the label and the value, making
  // a false-positive match against the wrong line possible.
  const urlMatch = text.match(
    /Open this URL in your browser:[^\S\n]*\n[^\S\n]*(https:\/\/\S+)/,
  );
  const codeMatch = text.match(/Enter this code:[^\S\n]*\n[^\S\n]*(\S+)/);
  if (urlMatch && codeMatch) {
    return { url: urlMatch[1], code: codeMatch[1] };
  }
  return null;
}

// Only one interactive login can run at a time — the renderer surfaces a
// single modal. Tracked so the renderer can cancel a flow the user
// abandoned (otherwise the CLI's loopback OAuth server lingers).
let activeProc: ChildProcess | null = null;

/**
 * Run `hermes auth add <provider> --type oauth`, streaming the CLI's
 * stdout/stderr line-by-line to `emit`. The CLI opens the system browser
 * for the OAuth consent step and runs a localhost loopback server to
 * catch the redirect; this function just supervises that subprocess.
 *
 * Resolves `{ success: true }` on exit code 0, `{ success: false, error }`
 * otherwise (non-zero exit, spawn failure, or cancellation).
 */
export function runHermesAuthLogin(
  provider: string,
  emit: (chunk: string) => void,
  profile?: string,
): Promise<OAuthLoginResult> {
  return new Promise((resolve) => {
    if (!isOAuthLoginProvider(provider)) {
      resolve({
        success: false,
        error: `Unsupported OAuth provider: ${provider}`,
      });
      return;
    }
    if (activeProc) {
      resolve({
        success: false,
        error: "Another sign-in is already in progress.",
      });
      return;
    }

    // `--type oauth` is explicit so the CLI never falls back to an
    // interactive "API key or OAuth?" prompt on a stdin we've closed.
    const subArgs =
      profile && profile !== "default"
        ? ["-p", profile, "auth", "add", provider, "--type", "oauth"]
        : ["auth", "add", provider, "--type", "oauth"];

    let proc: ChildProcess;
    try {
      proc = spawn(HERMES_PYTHON, hermesCliArgs(subArgs), {
        cwd: HERMES_REPO,
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
          HOME: homedir(),
          HERMES_HOME,
          PYTHONUNBUFFERED: "1",
          TERM: "dumb",
        },
        stdio: ["ignore", "pipe", "pipe"],
        ...HIDDEN_SUBPROCESS_OPTIONS,
      });
    } catch (err) {
      resolve({ success: false, error: (err as Error).message });
      return;
    }

    activeProc = proc;
    let settled = false;
    const finish = (result: OAuthLoginResult): void => {
      if (settled) return;
      settled = true;
      activeProc = null;
      resolve(result);
    };

    proc.stdout?.on("data", (data: Buffer) => emit(stripAnsi(data.toString())));
    proc.stderr?.on("data", (data: Buffer) => emit(stripAnsi(data.toString())));

    proc.on("error", (err) => {
      finish({
        success: false,
        error: `Failed to start sign-in: ${err.message}`,
      });
    });

    proc.on("close", (code, signal) => {
      if (code === 0) {
        finish({ success: true });
      } else if (signal) {
        finish({ success: false, error: "Sign-in cancelled." });
      } else {
        finish({ success: false, error: `Sign-in exited with code ${code}.` });
      }
    });
  });
}

/**
 * Kill the in-flight login subprocess, if any. Used when the user closes
 * the sign-in modal before the OAuth flow completes.
 */
export function cancelHermesAuthLogin(): boolean {
  if (!activeProc) return false;
  activeProc.kill();
  return true;
}

// === Anthropic Claude (OAuth) — native PKCE flow ===
//
// Anthropic's OAuth is a paste-a-code PKCE flow: the user authorizes in
// the browser and is handed a `<code>#<state>` string to paste back. The
// CLI's `auth add` path can't drive this here because it ignores the
// closed stdin we hand it and refuses a non-tty stdin. So we run the PKCE
// dance natively in this Node main process, then persist the resulting
// token into the engine's credential pool via a non-interactive Python
// one-liner. Constants mirror hermes-agent/agent/anthropic_adapter.py.

const ANTHROPIC_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const ANTHROPIC_AUTHORIZE_BASE = "https://claude.ai/oauth/authorize";
const ANTHROPIC_REDIRECT_URI =
  "https://console.anthropic.com/oauth/code/callback";
const ANTHROPIC_SCOPE = "org:create_api_key user:profile user:inference";
const ANTHROPIC_TOKEN_ENDPOINTS = [
  "https://platform.claude.com/v1/oauth/token",
  "https://console.anthropic.com/v1/oauth/token",
];
const ANTHROPIC_USER_AGENT = "claude-cli/2.1.74 (external, cli)";

function base64UrlNoPad(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Generate a fresh PKCE verifier/challenge + state and build the Anthropic
 * authorize URL. The caller must hold onto `verifier` and `state` to pass
 * back into {@link exchangeAnthropicCode} when the user submits the pasted
 * code.
 */
export function buildAnthropicAuthUrl(): {
  url: string;
  verifier: string;
  state: string;
} {
  const verifier = base64UrlNoPad(randomBytes(32));
  const challenge = base64UrlNoPad(
    createHash("sha256").update(verifier).digest(),
  );
  const state = base64UrlNoPad(randomBytes(32));

  const params = new URLSearchParams({
    code: "true",
    client_id: ANTHROPIC_CLIENT_ID,
    response_type: "code",
    redirect_uri: ANTHROPIC_REDIRECT_URI,
    scope: ANTHROPIC_SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });

  return {
    url: `${ANTHROPIC_AUTHORIZE_BASE}?${params.toString()}`,
    verifier,
    state,
  };
}

interface AnthropicTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

/**
 * POST the authorization code to Anthropic's token endpoint, trying the
 * primary `platform.claude.com` host first and falling back to
 * `console.anthropic.com`. Returns the parsed token payload or throws with
 * the last error encountered.
 */
async function postAnthropicToken(
  code: string,
  state: string,
  verifier: string,
): Promise<AnthropicTokenResponse> {
  const body = JSON.stringify({
    grant_type: "authorization_code",
    client_id: ANTHROPIC_CLIENT_ID,
    code,
    state,
    redirect_uri: ANTHROPIC_REDIRECT_URI,
    code_verifier: verifier,
  });

  let lastError = "";
  for (const endpoint of ANTHROPIC_TOKEN_ENDPOINTS) {
    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": ANTHROPIC_USER_AGENT,
        },
        body,
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        lastError = `${endpoint} → HTTP ${resp.status} ${text.slice(0, 200)}`;
        continue;
      }
      return (await resp.json()) as AnthropicTokenResponse;
    } catch (err) {
      lastError = `${endpoint} → ${(err as Error).message}`;
    }
  }
  throw new Error(lastError || "Token exchange failed.");
}

// Persists the freshly-minted Anthropic token into the engine's
// credential pool by appending a new entry (each call adds an account,
// so repeated sign-ins build up multi-account support automatically).
const ANTHROPIC_PERSIST_PYCODE = `import sys,uuid,time
from agent.credential_pool import PooledCredential, AUTH_TYPE_OAUTH, SOURCE_MANUAL, label_from_token, load_pool
from hermes_cli.auth_commands import _oauth_default_label, _provider_base_url
at,rt,ein=sys.argv[1],sys.argv[2],int(sys.argv[3])
pool=load_pool("anthropic"); n=len(pool.entries())+1
lab=label_from_token(at,_oauth_default_label("anthropic",n))
pool.add_entry(PooledCredential(provider="anthropic",id=uuid.uuid4().hex[:6],label=lab,auth_type=AUTH_TYPE_OAUTH,priority=0,source=f"{SOURCE_MANUAL}:desktop_pkce",access_token=at,refresh_token=(rt or None),expires_at_ms=int(time.time()*1000)+ein*1000,base_url=_provider_base_url("anthropic")))
print("OK "+lab)`;

function persistAnthropicToken(
  accessToken: string,
  refreshToken: string,
  expiresInSeconds: number,
  profile?: string,
): Promise<{ ok: boolean; output: string }> {
  // The hermes-agent engine resolves its data home purely from the
  // HERMES_HOME env var (see hermes_constants.get_hermes_home — it reads
  // os.environ["HERMES_HOME"] and has no HERMES_PROFILE support). So to
  // make load_pool() write into the SELECTED profile's credential pool
  // rather than the default one, we point HERMES_HOME at that profile's
  // home (<HERMES_HOME>/profiles/<name>) for non-default profiles. The
  // default profile keeps the unmodified HERMES_HOME to avoid regressions.
  const persistHome =
    profile && profile !== "default" ? profileHome(profile) : HERMES_HOME;
  return new Promise((resolve) => {
    execFile(
      HERMES_PYTHON,
      [
        "-c",
        ANTHROPIC_PERSIST_PYCODE,
        accessToken,
        refreshToken,
        String(expiresInSeconds),
      ],
      {
        cwd: HERMES_REPO,
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
          HOME: homedir(),
          HERMES_HOME: persistHome,
          PYTHONUNBUFFERED: "1",
        },
        ...HIDDEN_SUBPROCESS_OPTIONS,
      },
      (err, stdout, stderr) => {
        const out = `${stdout || ""}${stderr || ""}`;
        if (out.includes("OK ")) {
          resolve({ ok: true, output: out });
        } else {
          resolve({
            ok: false,
            output: err ? `${err.message}\n${out}` : out,
          });
        }
      },
    );
  });
}

/**
 * Complete the Anthropic OAuth flow: split the pasted `<code>#<state>`
 * string, exchange the code for tokens, then persist them into the
 * credential pool. Returns `{ success: true, persisted: true }` once the
 * Python persistence prints "OK ", otherwise a failure with the reason.
 */
export async function exchangeAnthropicCode(
  pasted: string,
  verifier: string,
  state: string,
  profile?: string,
): Promise<OAuthLoginResult & { persisted?: boolean }> {
  const trimmed = (pasted || "").trim();
  if (!trimmed) {
    return { success: false, error: "No code provided." };
  }
  if (!verifier || !state) {
    return {
      success: false,
      error: "No sign-in in progress — start the flow first.",
    };
  }

  const [code, returnedState] = trimmed.split("#");
  if (!code) {
    return { success: false, error: "Pasted code is malformed." };
  }
  // The browser hands back `<code>#<state>`. We send the state we
  // generated (the proven flow passes the original state in the token
  // POST); the returned half is just sanity-checked when present.
  if (returnedState && returnedState !== state) {
    return {
      success: false,
      error: "State mismatch — please restart the sign-in.",
    };
  }

  let tokens: AnthropicTokenResponse;
  try {
    tokens = await postAnthropicToken(code, state, verifier);
  } catch (err) {
    return {
      success: false,
      error: `Token exchange failed: ${(err as Error).message}`,
    };
  }

  const accessToken = tokens.access_token;
  if (!accessToken) {
    return {
      success: false,
      error: "Token endpoint returned no access_token.",
    };
  }
  const refreshToken = tokens.refresh_token ?? "";
  const expiresIn =
    typeof tokens.expires_in === "number" ? tokens.expires_in : 0;

  const persisted = await persistAnthropicToken(
    accessToken,
    refreshToken,
    expiresIn,
    profile,
  );
  if (persisted.ok) {
    return { success: true, persisted: true };
  }
  return {
    success: false,
    error: `Failed to save credential: ${persisted.output.trim().slice(0, 400)}`,
  };
}
