import { describe, expect, it } from "vitest";
import {
  redactInviteUrl,
  redactLogUrl,
  type ListenTogetherLogger,
} from "../logger";
import {
  computeSkipVotesRequired,
  decodeAppMessage,
  encodeInviteUrl,
  isAllowedSignalingUrl,
  isValidDirectEndpoint,
  normalizePasscode,
  parseInviteUrl,
  type InviteEnvelope,
} from "../protocol";

type LogEntry = {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  context?: Record<string, unknown>;
};

function createSpyLogger(): {
  logger: Required<ListenTogetherLogger>;
  entries: LogEntry[];
} {
  const entries: LogEntry[] = [];
  return {
    entries,
    logger: {
      debug: (message, context) =>
        entries.push({ level: "debug", message, context }),
      info: (message, context) =>
        entries.push({ level: "info", message, context }),
      warn: (message, context) =>
        entries.push({ level: "warn", message, context }),
      error: (message, context) =>
        entries.push({ level: "error", message, context }),
    },
  };
}

function makeValidTrack(overrides: Record<string, unknown> = {}) {
  return {
    entryId: "entry-1",
    videoId: "dQw4w9WgXcQ",
    title: "Never Gonna Give You Up",
    author: "Rick Astley",
    durationSec: 213,
    thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    addedBy: "peer-host",
    addedByName: "Host",
    addedAtMs: 1000,
    source: "dj" as const,
    pinned: false,
    ...overrides,
  };
}

function makeValidInviteEnvelope(
  overrides: Partial<InviteEnvelope> = {},
): InviteEnvelope {
  return {
    r: "room-abc-123",
    k: "host-public-key-base64",
    t: "SECRET_JOIN_TOKEN_987654",
    ep: ["192.168.1.42:42069", "[fd7a:115c:a1e0::1]:42069"],
    sig: "wss://signal.example.com:8443/ws",
    exp: 1_900_000_000,
    te: 3600,
    s: "SECRET_HMAC_SIGNATURE_XYZ",
    ...overrides,
  };
}

describe("protocol: vote skip thresholds", () => {
  it("computes required votes per mode", () => {
    expect(computeSkipVotesRequired("off", 5)).toBe(0);
    expect([1, 2, 3, 4, 5].map((n) => computeSkipVotesRequired("majority", n))).toEqual([1, 2, 2, 3, 3]);
    expect([1, 2, 3, 4, 6].map((n) => computeSkipVotesRequired("two-thirds", n))).toEqual([1, 2, 2, 3, 4]);
    expect(computeSkipVotesRequired("unanimous", 4)).toBe(4);
    expect(computeSkipVotesRequired("majority", 0)).toBe(1);
  });

  it("rejects invalid reorder and vote payloads", () => {
    expect(decodeAppMessage({ type: "QUEUE_REORDER", entryId: "e", targetIndex: -1 })).toBeNull();
    expect(decodeAppMessage({ type: "VOTE_SKIP", seq: -1 })).toBeNull();
    expect(decodeAppMessage({ type: "HOST_JUMP_TRACK", target: "x", entryId: "e" })).toBeNull();
  });
});

describe("protocol: decodeAppMessage", () => {
  it("accepts valid messages across protocol variants", () => {
    const validMessages: unknown[] = [
      { type: "PING", pingId: "p-1", t0: 100 },
      { type: "PONG", pingId: "p-1", t0: 100, t1: 120, t2: 121 },
      {
        type: "QUEUE_ADD",
        videoId: "dQw4w9WgXcQ",
        title: "Valid Track",
        author: "Artist",
        durationSec: 180,
        thumbnailUrl: "https://lh3.googleusercontent.com/abc/thumb.jpg",
      },
      {
        type: "QUEUE_ADD",
        videoId: "AbCdEfGhI_1",
        title: "Null Thumb Track",
        author: "",
        durationSec: 1,
        thumbnailUrl: null,
      },
      {
        type: "AUTOPLAY_CANDIDATES",
        seedVideoId: "dQw4w9WgXcQ",
        candidates: [
          {
            videoId: "9bZkp7q19f0",
            title: "Candidate",
            author: "Artist",
            durationSec: 200,
            thumbnailUrl: "https://yt3.ggpht.com/avatar.jpg",
          },
        ],
      },
      { type: "TRACK_READY", seq: 0 },
      { type: "TRACK_ENDED", seq: 4 },
      { type: "TRACK_UNAVAILABLE", seq: 4, errorCode: 150 },
      { type: "TRACK_UNAVAILABLE", seq: 4, errorCode: "UNPLAYABLE" },
      { type: "AD_STARTED", seq: 1 },
      { type: "AD_ENDED", seq: 1 },
      { type: "VOTE_SKIP", seq: 3 },
      { type: "QUEUE_REORDER", entryId: "e-1", targetIndex: 2 },
      { type: "HOST_JUMP_TRACK", target: "history", entryId: "e-1" },
      { type: "HOST_UPDATE_SETTINGS", settings: { voteSkipMode: "unanimous" } },
      { type: "HOST_FORCE_RESUME_FROM_AD", seq: 2 },
      { type: "HOST_TRANSPORT", action: "seek", seekPosSec: 42.5 },
      {
        type: "HOST_MODERATION",
        targetPeerId: "peer-2",
        action: "demote-clear",
      },
      {
        type: "HOST_UPDATE_SETTINGS",
        settings: { adSyncMode: "stay-live", rateLimitPreset: "strict" },
      },
      {
        type: "ACTION_REJECTED",
        reason: "RATE_LIMITED",
        retryAfterMs: 25000,
      },
      {
        type: "ROOM_ENDED",
        reason: "host-left",
        queueSnapshot: [makeValidTrack()],
      },
    ];

    for (const msg of validMessages) {
      const { logger, entries } = createSpyLogger();
      const decoded = decodeAppMessage(msg, logger);
      expect(decoded).toEqual(msg);
      expect(entries).toHaveLength(0);
    }
  });

  it("rejects bad videoIds and logs warning", () => {
    const badIds = ["short", "toolongvideoid12", "bad$char1234", "", 12345];
    for (const videoId of badIds) {
      const { logger, entries } = createSpyLogger();
      const decoded = decodeAppMessage(
        {
          type: "QUEUE_ADD",
          videoId,
          title: "Test",
          author: "Artist",
          durationSec: 120,
          thumbnailUrl: null,
        },
        logger,
      );
      expect(decoded).toBeNull();
      expect(entries.some((e) => e.level === "warn")).toBe(true);
    }
  });

  it("enforces YouTube-only HTTPS thumbnail domains against XSS and IP leaks", () => {
    const badThumbnails = [
      "http://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      "https://evil.example.com/tracker.png",
      "https://192.168.1.1/pixel.png",
      "https://169.254.169.254/latest/meta-data/",
      "https://i.ytimg.com.evil.com/x.jpg",
      "javascript:alert(1)",
      "data:image/svg+xml,<svg onload=alert(1)>",
      `https://i.ytimg.com/${"a".repeat(500)}`,
    ];

    for (const thumbnailUrl of badThumbnails) {
      const { logger, entries } = createSpyLogger();
      const decoded = decodeAppMessage(
        {
          type: "QUEUE_ADD",
          videoId: "dQw4w9WgXcQ",
          title: "Track",
          author: "Artist",
          durationSec: 120,
          thumbnailUrl,
        },
        logger,
      );
      expect(decoded).toBeNull();
      expect(entries[0]?.level).toBe("warn");
      expect(entries[0]?.context?.messageType).toBe("QUEUE_ADD");
    }
  });

  it("rejects oversized or empty titles and invalid structural payloads", () => {
    const invalidPayloads: unknown[] = [
      null,
      undefined,
      "PING",
      42,
      {},
      { type: "UNKNOWN_TYPE" },
      {
        type: "QUEUE_ADD",
        videoId: "dQw4w9WgXcQ",
        title: "x".repeat(201),
        author: "Artist",
        durationSec: 100,
        thumbnailUrl: null,
      },
      {
        type: "QUEUE_ADD",
        videoId: "dQw4w9WgXcQ",
        title: "",
        author: "Artist",
        durationSec: 100,
        thumbnailUrl: null,
      },
      {
        type: "QUEUE_ADD",
        videoId: "dQw4w9WgXcQ",
        title: "Zero duration",
        author: "Artist",
        durationSec: 0,
        thumbnailUrl: null,
      },
      {
        type: "AUTOPLAY_CANDIDATES",
        seedVideoId: "dQw4w9WgXcQ",
        candidates: Array.from({ length: 6 }, (_, i) => ({
          videoId: `dQw4w9WgX0${i}`,
          title: `Track ${i}`,
          author: "Artist",
          durationSec: 100,
          thumbnailUrl: null,
        })),
      },
    ];

    for (const payload of invalidPayloads) {
      const { logger, entries } = createSpyLogger();
      expect(decodeAppMessage(payload, logger)).toBeNull();
      expect(entries.some((e) => e.level === "warn")).toBe(true);
    }
  });
});

describe("protocol: encodeInviteUrl & parseInviteUrl", () => {
  it("roundtrips valid invite envelopes in compact ytmd://l/ format and remains backwards-compatible with ytmd://listen/v1/", () => {
    const envelope = makeValidInviteEnvelope({
      r: "87a63234-e273-479a-bdb3-33d8eb772683",
      sig: "https://100.64.0.10:8443/signal",
    });
    const { logger, entries } = createSpyLogger();
    const url = encodeInviteUrl(envelope, logger);

    expect(url.startsWith("ytmd://l/")).toBe(true);
    expect(url.includes("=")).toBe(false);

    const parsed = parseInviteUrl(url, logger);
    expect(parsed).toEqual(envelope);
    expect(entries).toHaveLength(0);

    // Legacy v1 JSON link
    const legacyB64 = Buffer.from(JSON.stringify(envelope), "utf8").toString(
      "base64url",
    );
    const legacyUrl = `ytmd://listen/v1/${legacyB64}`;
    expect(parseInviteUrl(legacyUrl, logger)).toEqual(envelope);
    expect(url.length).toBeLessThan(legacyUrl.length);
  });

  it("roundtrips minimal envelope and UTF-8 roomIds without optional fields", () => {
    const minimal: InviteEnvelope = {
      r: "room-café-🎵",
      k: "pubkey",
      t: "TOKEN_123",
      te: 0,
      s: "SIG_123",
    };
    const url = encodeInviteUrl(minimal);
    expect(url.startsWith("ytmd://l/")).toBe(true);
    expect(parseInviteUrl(url)).toEqual(minimal);
  });

  it("rejects ep.length > 6 during both encode and parse", () => {
    const tooManyEndpoints = Array.from(
      { length: 7 },
      (_, i) => `192.168.1.${i + 10}:42069`,
    );
    const badEnvelope = makeValidInviteEnvelope({ ep: tooManyEndpoints });

    expect(() => encodeInviteUrl(badEnvelope)).toThrow();

    const forgedB64 = Buffer.from(JSON.stringify(badEnvelope), "utf8")
      .toString("base64url")
      .replace(/=+$/, "");
    const { logger, entries } = createSpyLogger();
    expect(parseInviteUrl(`ytmd://listen/v1/${forgedB64}`, logger)).toBeNull();
    expect(entries.some((e) => e.level === "warn")).toBe(true);
  });

  it("rejects malformed invite URLs and invalid envelopes", () => {
    const badUrls = [
      "",
      "https://example.com/invite",
      "ytmd://listen/v2/abc",
      "ytmd://listen/v1/",
      `ytmd://listen/v1/${"A".repeat(4097)}`,
      "ytmd://listen/v1/invalid!base64*",
      "ytmd://listen/v1/AAAAA", // length % 4 === 1
      `ytmd://listen/v1/${Buffer.from([0xff, 0xfe]).toString("base64url")}`,
      `ytmd://listen/v1/${Buffer.from("{not-json", "utf8").toString("base64url")}`,
      `ytmd://listen/v1/${Buffer.from(JSON.stringify({ r: "only-room" }), "utf8").toString("base64url")}`,
    ];

    for (const url of badUrls) {
      const { logger, entries } = createSpyLogger();
      expect(parseInviteUrl(url, logger)).toBeNull();
      expect(entries.some((e) => e.level === "warn")).toBe(true);
    }
  });

  it("rejects envelopes containing blocked endpoints or signaling URLs", () => {
    const ssrfEndpointEnv = makeValidInviteEnvelope({
      ep: ["127.0.0.1:42069"],
    });
    expect(() => encodeInviteUrl(ssrfEndpointEnv)).toThrow();

    const ssrfSigEnv = makeValidInviteEnvelope({
      sig: "https://169.254.169.254/latest",
    });
    expect(() => encodeInviteUrl(ssrfSigEnv)).toThrow();

    const forged = Buffer.from(
      JSON.stringify(ssrfEndpointEnv),
      "utf8",
    ).toString("base64url");
    expect(parseInviteUrl(`ytmd://listen/v1/${forged}`)).toBeNull();
  });
});

describe("protocol: isValidDirectEndpoint", () => {
  it("accepts valid LAN, Tailscale/CGNAT, and public IPv4/IPv6 endpoints", () => {
    const validEndpoints = [
      "192.168.1.100:42069",
      "10.0.0.1:1024",
      "172.16.5.4:65535",
      "100.64.0.1:42069",
      "100.127.255.254:12345",
      "8.8.8.8:8443",
      "[fd7a:115c:a1e0::1]:42069",
      "[fc00::1]:1024",
      "[2001:db8::1]:65535",
      "[::ffff:192.168.1.5]:8080",
    ];

    for (const ep of validEndpoints) {
      expect(isValidDirectEndpoint(ep)).toBe(true);
    }
  });

  it("rejects loopback, unspecified, link-local/metadata, multicast, bad ports, and hostnames", () => {
    const invalidEndpoints = [
      "",
      "127.0.0.1:42069",
      "127.1.2.3:8080",
      "[::1]:42069",
      "[0:0:0:0:0:0:0:1]:42069",
      "[::ffff:127.0.0.1]:8080",
      "[::ffff:7f00:1]:8080",
      "[::ffff:0:127.0.0.1]:8080",
      "[64:ff9b::169.254.169.254]:8080",
      "[2002:7f00:1::]:8080",
      "0.0.0.0:42069",
      "0.1.2.3:42069",
      "[::]:42069",
      "169.254.169.254:8080",
      "169.254.1.1:8080",
      "[fe80::1]:8080",
      "[febf::abcd]:8080",
      "[::ffff:169.254.169.254]:8080",
      "224.0.0.1:8080",
      "255.255.255.255:8080",
      "[ff02::1]:8080",
      "192.168.1.1:0",
      "192.168.1.1:80",
      "192.168.1.1:1023",
      "192.168.1.1:65536",
      "192.168.1.1:08080",
      "192.168.1.1",
      "192.168.01.1:8080",
      "example.com:8080",
      "localhost:8080",
      "[localhost]:8080",
      "[fe80::1%eth0]:8080",
      "[fd00::1%25eth0]:8080",
      `[2001:db8::${"1".repeat(55)}]:8080`,
    ];

    for (const ep of invalidEndpoints) {
      expect(isValidDirectEndpoint(ep)).toBe(false);
    }
  });
});

describe("protocol: isAllowedSignalingUrl", () => {
  it("allows https and wss public URLs and rejects http, ws, and credentials", () => {
    expect(isAllowedSignalingUrl("https://signal.example.com/room")).toBe(true);
    expect(isAllowedSignalingUrl("wss://signal.example.com:8443/ws")).toBe(
      true,
    );
    expect(isAllowedSignalingUrl("https://1.1.1.1:8443/sig")).toBe(true);
    expect(isAllowedSignalingUrl("wss://[2001:db8::1]:8443/ws")).toBe(true);

    expect(isAllowedSignalingUrl("http://signal.example.com/room")).toBe(false);
    expect(isAllowedSignalingUrl("ws://signal.example.com/ws")).toBe(false);
    expect(isAllowedSignalingUrl("ftp://signal.example.com/file")).toBe(false);
    expect(isAllowedSignalingUrl("not-a-url")).toBe(false);
    expect(isAllowedSignalingUrl("https://user:pass@signal.example.com")).toBe(
      false,
    );
    expect(isAllowedSignalingUrl("wss://token@signal.example.com")).toBe(false);
  });

  it("blocks localhost, loopback, link-local, and metadata even with allowPrivateLiteral = true", () => {
    const alwaysBlocked = [
      "https://localhost:8443",
      "https://localhost.:8443",
      "wss://foo.localhost:8443",
      "wss://foo.localhost.:8443",
      "https://metadata.google.internal/computeMetadata/v1",
      "https://metadata.google.internal./computeMetadata/v1",
      "https://127.0.0.1:8443",
      "https://0.0.0.0:8443",
      "https://169.254.169.254/latest/meta-data/",
      "wss://[::1]:8443",
      "wss://[fe80::1]:8443",
      "https://[::ffff:127.0.0.1]:8443",
      "https://[::ffff:169.254.169.254]:8443",
      "https://[::ffff:0:169.254.169.254]:8443",
      "https://[64:ff9b::127.0.0.1]:8443",
      "https://[2002:a9fe:a9fe::]:8443",
    ];

    for (const url of alwaysBlocked) {
      expect(isAllowedSignalingUrl(url, false)).toBe(false);
      expect(isAllowedSignalingUrl(url, true)).toBe(false);
    }
  });

  it("gates private/Tailscale literals behind allowPrivateLiteral", () => {
    const privateUrls = [
      "https://10.0.0.5:8443",
      "wss://172.16.0.5:8443",
      "https://192.168.1.50:8443",
      "wss://100.64.0.1:8443",
      "wss://[fd7a:115c:a1e0::1]:8443",
      "https://[fc00::1]:8443",
      "https://[::ffff:192.168.1.50]:8443",
    ];

    for (const url of privateUrls) {
      expect(isAllowedSignalingUrl(url, false)).toBe(false);
      expect(isAllowedSignalingUrl(url, true)).toBe(true);
    }
  });
});

describe("protocol: normalizePasscode", () => {
  it("normalizes valid Crockford-alphabet passcodes with hyphens and spaces", () => {
    expect(normalizePasscode("23456789")).toBe("23456789");
    expect(normalizePasscode("abcdefgh")).toBe("ABCDEFGH");
    expect(normalizePasscode("jk-lm np-qr")).toBe("JKLMNPQR");
    expect(normalizePasscode("  stuv-wxyz \t\n")).toBe("STUVWXYZ");
  });

  it("rejects ambiguous chars (0, 1, I, O) and invalid lengths or symbols", () => {
    const invalid = [
      "",
      "2345678",
      "23456789A",
      "03456789",
      "13456789",
      "I3456789",
      "i3456789",
      "O3456789",
      "o3456789",
      "2345-678!",
      "2345_678",
    ];

    for (const raw of invalid) {
      const { logger, entries } = createSpyLogger();
      expect(normalizePasscode(raw, logger)).toBeNull();
      expect(entries.some((e) => e.level === "debug")).toBe(true);
    }
  });
});

describe("protocol & logger: secret redaction", () => {
  it("redacts invite URLs and embedded credentials in redactInviteUrl and redactLogUrl", () => {
      expect(
        redactInviteUrl(
          "Failed invite ytmd://listen/v1/SECRET_TOKEN_PAYLOAD inside text",
        ),
      ).toBe("Failed invite ytmd://listen/v1/[redacted] inside text");

      expect(
        redactInviteUrl(
          "Failed invite ytmd://l/COMPACT_SECRET_PAYLOAD inside text",
        ),
      ).toBe("Failed invite ytmd://l/[redacted] inside text");

    expect(redactInviteUrl("YTMD://LISTEN/legacy/SECRET_DATA")).toBe(
      "ytmd://listen/[redacted]",
    );

    expect(
      redactLogUrl("https://alice:super-secret-pass@signal.example.com/ws"),
    ).toBe("https://redacted:redacted@signal.example.com/ws");

    expect(redactLogUrl("ytmd://listen/v1/SECRET_TOKEN_PAYLOAD")).toBe(
      "ytmd://listen/v1/[redacted]",
    );

    expect(redactLogUrl("wss://user:secret@bad host/ws")).toBe(
      "wss://[redacted]@bad host/ws",
    );
  });

  it("never passes raw passcodes, t tokens, s signatures, or URL passwords to logger", () => {
    const { logger, entries } = createSpyLogger();
    const rawPasscode = "ABCD-EFGH-BAD";
    const secretToken = "SUPER_SECRET_TOKEN_T_VALUE";
    const secretSig = "SUPER_SECRET_SIG_S_VALUE";
    const secretUrlPass = "SUPER_SECRET_URL_PASSWORD";

    normalizePasscode(rawPasscode, logger);
    normalizePasscode("01IO2345", logger);

    const validEnv = makeValidInviteEnvelope({
      t: secretToken,
      s: secretSig,
    });
    const encoded = encodeInviteUrl(validEnv, logger);
    expect(parseInviteUrl(encoded, logger)).toEqual(validEnv);

    // Force parse failure after prefix check with a crafted URL containing secret-looking payload
    const badEndpointEnv = makeValidInviteEnvelope({
      t: secretToken,
      s: secretSig,
      ep: ["127.0.0.1:42069"],
    });
    const forgedUrl = `ytmd://listen/v1/${Buffer.from(
      JSON.stringify(badEndpointEnv),
      "utf8",
    ).toString("base64url")}`;
    expect(parseInviteUrl(forgedUrl, logger)).toBeNull();

    // Force encode failure with invalid schema alongside secrets
    expect(() =>
      encodeInviteUrl(
        {
          ...badEndpointEnv,
          r: "",
        },
        logger,
      ),
    ).toThrow();

    isAllowedSignalingUrl(
      `https://user:${secretUrlPass}@signal.example.com/ws`,
      false,
      logger,
    );

    decodeAppMessage({ type: "QUEUE_ADD", videoId: "bad" }, logger);

    const serializedLogs = JSON.stringify(entries);
    expect(serializedLogs).not.toContain(rawPasscode);
    expect(serializedLogs).not.toContain("01IO2345");
    expect(serializedLogs).not.toContain(secretToken);
    expect(serializedLogs).not.toContain(secretSig);
    expect(serializedLogs).not.toContain(secretUrlPass);
  });
});
