export interface ListenTogetherLogger {
  debug?(message: string, context?: Record<string, unknown>): void;
  info?(message: string, context?: Record<string, unknown>): void;
  warn?(message: string, context?: Record<string, unknown>): void;
  error?(message: string, context?: Record<string, unknown>): void;
}

export const noopLogger: Required<ListenTogetherLogger> = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const TAILCAT_TOKEN_RE = /(?<![A-Za-z0-9_-])tc[A-Za-z0-9_-]{16,}/g;

function redactInvitePayloadOnly(url: string): string {
  return url
    .replace(/ytmd:\/\/l\/[^\s"'<>]*/gi, "ytmd://l/[redacted]")
    .replace(
      /ytmd:\/\/listen\/(v\d+)\/[^\s"'<>]*/gi,
      "ytmd://listen/$1/[redacted]",
    )
    .replace(
      /ytmd:\/\/listen\/(?!v\d+\/\[redacted\])[^\s"'<>]*/gi,
      "ytmd://listen/[redacted]",
    );
}

/**
 * Redacts `ytmd://listen/...` invite link payloads and Tailcat capability tokens (`tc...`)
 * before writing to logs.
 */
export function redactInviteUrl(url: string): string {
  return redactInvitePayloadOnly(url).replace(TAILCAT_TOKEN_RE, "tc[REDACTED]");
}

/**
 * Redacts embedded credentials, `ytmd://listen/...` invite payloads, and Tailcat capability tokens
 * before logging.
 */
export function redactLogUrl(url: string): string {
  const redactedInvite = redactInvitePayloadOnly(url);
  if (redactedInvite !== url) {
    return redactedInvite.replace(TAILCAT_TOKEN_RE, "tc[REDACTED]");
  }
  try {
    const parsed = new URL(url);
    if (parsed.username !== "" || parsed.password !== "") {
      parsed.username = "redacted";
      parsed.password = "redacted";
      return parsed.toString().replace(TAILCAT_TOKEN_RE, "tc[REDACTED]");
    }
    return url.replace(TAILCAT_TOKEN_RE, "tc[REDACTED]");
  } catch {
    return url
      .replace(/([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+@)/gi, "$1[redacted]@")
      .replace(TAILCAT_TOKEN_RE, "tc[REDACTED]");
  }
}
