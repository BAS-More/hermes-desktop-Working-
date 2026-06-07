import { useState, useEffect, useRef } from "react";
import { X } from "../assets/icons";
import { useI18n } from "./useI18n";

interface OAuthLoginModalProps {
  provider: string;
  providerLabel: string;
  profile?: string;
  onClose: () => void;
}

type Status = "running" | "success" | "error";

/**
 * Drives an interactive OAuth sign-in for a subscription provider.
 *
 * For the CLI-loopback providers this spawns `hermes auth add <provider>
 * --type oauth` in the main process, streams the CLI output here, and
 * reports success/failure. The CLI opens the system browser for the
 * consent step.
 *
 * Anthropic is special: it uses a paste-a-code PKCE flow the CLI can't
 * drive from a non-tty stdin, so the main process runs the PKCE dance
 * natively. This modal then opens the authorize URL and collects the
 * `<code>#<state>` string the user pastes back.
 */
function OAuthLoginModal({
  provider,
  providerLabel,
  profile,
  onClose,
}: OAuthLoginModalProps): React.JSX.Element {
  const { t } = useI18n();
  const isAnthropic = provider === "anthropic";

  const [log, setLog] = useState("");
  const [status, setStatus] = useState<Status>("running");
  const [error, setError] = useState("");
  const logRef = useRef<HTMLPreElement>(null);
  // The login subprocess is single-flight in the main process. React
  // StrictMode (dev) double-invokes effects, so guard against firing a
  // second start that would just bounce off that guard.
  const startedRef = useRef(false);

  // Anthropic paste-a-code state.
  const [authUrl, setAuthUrl] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isAnthropic) {
      // Native PKCE flow: kick off the main-process start to get the
      // authorize URL, then open it. Submission happens on demand below.
      if (!startedRef.current) {
        startedRef.current = true;
        window.hermesAPI
          .anthropicOauthStart()
          .then((res) => {
            setAuthUrl(res.url);
            window.open(res.url, "_blank", "noopener,noreferrer");
          })
          .catch((err: unknown) => {
            setStatus("error");
            setError((err as Error)?.message || t("providers.oauth.failed"));
          });
      }
      return;
    }

    const cleanup = window.hermesAPI.onOAuthLoginProgress((chunk) => {
      setLog((prev) => prev + chunk);
    });
    if (!startedRef.current) {
      startedRef.current = true;
      window.hermesAPI
        .oauthLogin(provider, profile)
        .then((res) => {
          if (res.success) {
            setStatus("success");
          } else {
            setStatus("error");
            setError(res.error || t("providers.oauth.failed"));
          }
        })
        .catch((err: unknown) => {
          setStatus("error");
          setError((err as Error)?.message || t("providers.oauth.failed"));
        });
    }
    return cleanup;
  }, [provider, profile, t, isAnthropic]);

  // Keep the streamed log scrolled to the newest line.
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log]);

  function handleClose(): void {
    // Abandoning a CLI flow mid-OAuth: tell main to kill the subprocess
    // so its loopback redirect server doesn't linger. The native
    // Anthropic flow has no subprocess to cancel.
    if (status === "running" && !isAnthropic) {
      void window.hermesAPI.cancelOAuthLogin();
    }
    onClose();
  }

  function handleAnthropicSubmit(): void {
    if (!code.trim() || submitting) return;
    setSubmitting(true);
    window.hermesAPI
      .anthropicOauthSubmit(code.trim())
      .then((res) => {
        if (res.success) {
          setStatus("success");
        } else {
          setStatus("error");
          setError(res.error || t("providers.oauth.failed"));
        }
      })
      .catch((err: unknown) => {
        setStatus("error");
        setError((err as Error)?.message || t("providers.oauth.failed"));
      })
      .finally(() => {
        setSubmitting(false);
      });
  }

  return (
    <div className="models-modal-overlay" onClick={handleClose}>
      <div className="models-modal" onClick={(e) => e.stopPropagation()}>
        <div className="models-modal-header">
          <h2 className="models-modal-title">
            {t("providers.oauth.signIn")} — {providerLabel}
          </h2>
          <button
            className="btn-ghost"
            onClick={handleClose}
            aria-label={t("common.close")}
          >
            <X size={18} />
          </button>
        </div>
        <div className="models-modal-body">
          {status === "success" && (
            <div className="oauth-login-result oauth-login-result-success">
              ✓&nbsp;{t("providers.oauth.successHint")}
            </div>
          )}
          {status === "error" && (
            <div className="oauth-login-result oauth-login-result-error">
              ✗&nbsp;{error}
            </div>
          )}

          {isAnthropic ? (
            status === "running" && (
              <div className="oauth-anthropic-flow">
                <p className="oauth-login-status">
                  {t("providers.oauth.runningHint")}
                </p>
                {authUrl && (
                  <p>
                    <a href={authUrl} target="_blank" rel="noopener noreferrer">
                      {authUrl}
                    </a>
                  </p>
                )}
                <input
                  type="text"
                  className="input"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="code#state"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            )
          ) : (
            <>
              {status === "running" && (
                <p className="oauth-login-status">
                  {t("providers.oauth.runningHint")}
                </p>
              )}
              {log && (
                <pre className="settings-hermes-doctor" ref={logRef}>
                  {log}
                </pre>
              )}
            </>
          )}
        </div>
        <div className="models-modal-footer">
          {isAnthropic && status === "running" && (
            <button
              className="btn btn-primary btn-sm"
              onClick={handleAnthropicSubmit}
              disabled={!code.trim() || submitting}
            >
              {t("common.submit")}
            </button>
          )}
          <button className="btn btn-sm" onClick={handleClose}>
            {status === "running" ? t("common.cancel") : t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default OAuthLoginModal;
