import type {
  ListenTogetherActionResult,
  ListenTogetherCommand,
} from "~shared/listentogether/ipc";
import type { Role } from "~shared/listentogether/protocol";

const INVITE_URL_PREFIX = "ytmd://listen/v1/";
const COMPACT_INVITE_URL_PREFIX = "ytmd://l/";
const PASSCODE_RE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/;

export async function dispatchCommand(
  command: ListenTogetherCommand,
): Promise<ListenTogetherActionResult> {
  const dispatch = window.ytmd?.listenTogether?.dispatch;
  if (!dispatch) {
    return { ok: false, error: "Listen Together controls are unavailable" };
  }
  try {
    const result = await dispatch(command);
    if (!result.ok) {
      console.warn("Listen Together command failed", {
        type: command.type,
        error: result.error,
      });
    }
    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : "Action failed";
    console.warn("Listen Together command threw", {
      type: command.type,
      error,
    });
    return {
      ok: false,
      error,
    };
  }
}

export function closeListenTogetherPanel(): void {
  window.ytmd?.listenTogether?.closePanel?.();
}

export function normalizePasscodeInput(raw: string): string | null {
  const normalized = raw.replace(/[\s-]+/g, "").toUpperCase();
  if (!PASSCODE_RE.test(normalized)) {
    return null;
  }
  return normalized;
}

export function formatPasscodeDisplay(raw: string): string {
  const clean = raw.replace(/[\s-]+/g, "").toUpperCase();
  if (clean.length <= 4) {
    return clean;
  }
  return `${clean.slice(0, 4)}-${clean.slice(4, 8)}`;
}

export function isInviteUrlInput(raw: string): boolean {
  const trimmed = raw.trim();
  return (
    trimmed.startsWith(INVITE_URL_PREFIX) ||
    trimmed.startsWith(COMPACT_INVITE_URL_PREFIX)
  );
}

export function looksLikeRoomCodeInput(raw: string): boolean {
  const trimmed = raw.trim();
  if (
    !trimmed ||
    trimmed.includes("://") ||
    trimmed.toLowerCase().startsWith("ytmd:")
  ) {
    return false;
  }
  return /^[A-Za-z0-9\s-]{2,}$/.test(trimmed);
}

export function formatEndpoint(ip: string, port: number): string {
  if (ip.includes(":") && !ip.startsWith("[")) {
    return `[${ip}]:${port}`;
  }
  return `${ip}:${port}`;
}

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function roleLabel(role: Role): string {
  switch (role) {
    case "admin":
      return "Host";
    case "dj":
      return "DJ";
    case "listener":
      return "Listener";
  }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to execCommand below when clipboard API is blocked.
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
