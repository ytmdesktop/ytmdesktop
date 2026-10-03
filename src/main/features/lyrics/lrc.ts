import { LyricsLine } from "./types";

const TIMESTAMP_REGEX = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

export function parseSyncedLyricsToLines(syncedLyrics: string): LyricsLine[] {
  const lines: LyricsLine[] = [];
  const rawLines = syncedLyrics.split(/\r?\n/);

  for (const rawLine of rawLines) {
    if (!rawLine.trim()) {
      continue;
    }

    const timestamps: number[] = [];
    let match: RegExpExecArray | null;
    TIMESTAMP_REGEX.lastIndex = 0;
    while ((match = TIMESTAMP_REGEX.exec(rawLine)) !== null) {
      const minutes = Number.parseInt(match[1], 10);
      const seconds = Number.parseInt(match[2], 10);
      const millisecondsRaw = match[3] ?? "0";
      const milliseconds = Number.parseInt(millisecondsRaw.padEnd(3, "0").slice(0, 3), 10);
      timestamps.push(minutes * 60_000 + seconds * 1000 + milliseconds);
    }

    if (timestamps.length === 0) {
      continue;
    }

    const text = rawLine.replace(TIMESTAMP_REGEX, "").trim();
    if (!text) {
      continue;
    }
    for (const timestamp of timestamps) {
      lines.push({
        startMs: timestamp,
        text
      });
    }
  }

  lines.sort((a, b) => a.startMs - b.startMs);

  for (let i = 0; i < lines.length; i++) {
    const currentLine = lines[i];
    const nextLine = lines[i + 1];
    if (nextLine) {
      currentLine.endMs = Math.max(currentLine.startMs, nextLine.startMs - 1);
    }
  }

  return lines;
}
