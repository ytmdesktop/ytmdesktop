import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ListenTogetherLogger } from "~shared/listentogether/logger";
import {
  createGuestHandshake,
  createHostHandshake,
  createLinkSession,
  decryptFrame,
  derivePasscodeLookup,
  encryptFrame,
  generateEd25519Keypair,
  generatePasscode,
  getScryptQueueStats,
  HandshakeError,
  HostAuthGuard,
  REKEY_COUNTER_LIMIT,
  signInviteEnvelope,
  verifyEd25519,
  verifyInviteEnvelope,
  type ScryptFn,
} from "../crypto";

function createSpyLogger(): {
  logger: ListenTogetherLogger;
  entries: Array<{
    level: string;
    message: string;
    context?: Record<string, unknown>;
  }>;
  dump(): string;
} {
  const entries: Array<{
    level: string;
    message: string;
    context?: Record<string, unknown>;
  }> = [];
  const record =
    (level: string) => (message: string, context?: Record<string, unknown>) => {
      entries.push({ level, message, context });
    };
  return {
    entries,
    logger: {
      debug: record("debug"),
      info: record("info"),
      warn: record("warn"),
      error: record("error"),
    },
    dump() {
      return JSON.stringify(entries);
    },
  };
}

describe("crypto", () => {
  it("generates raw 32-byte base64url Ed25519 keypairs and validates invite envelopes strictly", () => {
    const hostKeys = generateEd25519Keypair();
    const rawPub = Buffer.from(hostKeys.publicKeyB64, "base64url");
    expect(rawPub.length).toBe(32);

    const now = 1_700_000_000_000;
    const envelope = signInviteEnvelope(
      {
        r: "room-abc",
        k: hostKeys.publicKeyB64,
        t: crypto.randomBytes(16).toString("base64url"),
        ep: ["192.168.1.20:45123"],
        sig: "wss://relay.example.com",
        exp: now + 60_000,
        te: 1,
      },
      hostKeys.privateKey,
    );

    expect(verifyInviteEnvelope(envelope, { nowMs: now })).toBe(true);
    // Exact boundary exp === nowMs is still valid; 1 ms past expiry fails
    expect(verifyInviteEnvelope(envelope, { nowMs: now + 60_000 })).toBe(true);
    expect(verifyInviteEnvelope(envelope, { nowMs: now + 60_001 })).toBe(false);
    expect(
      verifyInviteEnvelope(envelope, {
        nowMs: now + 120_000,
        checkExpiry: false,
      }),
    ).toBe(true);

    // Envelope without exp is accepted
    const noExpEnvelope = signInviteEnvelope(
      {
        r: "room-no-exp",
        k: hostKeys.publicKeyB64,
        t: crypto.randomBytes(16).toString("base64url"),
        te: 1,
      },
      hostKeys.privateKey,
    );
    expect(verifyInviteEnvelope(noExpEnvelope, { nowMs: now + 999_999 })).toBe(
      true,
    );

    // Tampering with signed fields fails verification
    expect(verifyInviteEnvelope({ ...envelope, te: 2 }, { nowMs: now })).toBe(
      false,
    );
    expect(
      verifyInviteEnvelope({ ...envelope, r: "room-xyz" }, { nowMs: now }),
    ).toBe(false);
    expect(
      verifyInviteEnvelope(
        { ...envelope, sig: "wss://evil.example.com" },
        { nowMs: now },
      ),
    ).toBe(false);
    expect(
      verifyInviteEnvelope({ ...envelope, exp: now + 120_000 }, { nowMs: now }),
    ).toBe(false);

    // Tampered or malformed signature fails verification
    const sigBuf = Buffer.from(envelope.s, "base64url");
    sigBuf[0] ^= 0xff;
    expect(
      verifyInviteEnvelope(
        { ...envelope, s: sigBuf.toString("base64url") },
        { nowMs: now },
      ),
    ).toBe(false);
    expect(
      verifyInviteEnvelope(
        { ...envelope, s: Buffer.alloc(63, 1).toString("base64url") },
        { nowMs: now },
      ),
    ).toBe(false);
    expect(
      verifyInviteEnvelope({ ...envelope, s: "not*valid!" }, { nowMs: now }),
    ).toBe(false);

    // Different keypair or malformed public key fails verification
    const otherKeys = generateEd25519Keypair();
    expect(
      verifyInviteEnvelope(
        { ...envelope, k: otherKeys.publicKeyB64 },
        { nowMs: now },
      ),
    ).toBe(false);
    expect(
      verifyInviteEnvelope(
        { ...envelope, k: Buffer.alloc(31, 2).toString("base64url") },
        { nowMs: now },
      ),
    ).toBe(false);
    expect(
      verifyInviteEnvelope({ ...envelope, k: "bad+key/==" }, { nowMs: now }),
    ).toBe(false);

    // Direct verifyEd25519 sanity check for invalid key lengths
    expect(
      verifyEd25519(
        Buffer.from("msg"),
        Buffer.alloc(64),
        Buffer.alloc(31).toString("base64url"),
      ),
    ).toBe(false);
  });

  it("derives deterministic lookupId and passcodeAuthKey via queued async scrypt", async () => {
    const passcode = generatePasscode();
    expect(passcode).toMatch(/^[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}$/);

    const normalized = passcode.replace("-", "").toLowerCase();
    const [a, b, c] = await Promise.all([
      derivePasscodeLookup(passcode),
      derivePasscodeLookup(`  ${normalized} `),
      derivePasscodeLookup("ABCD-EFGH"),
    ]);

    expect(Buffer.from(a.lookupId, "base64url").length).toBe(16);
    expect(a.passcodeAuthKey.length).toBe(32);
    expect(a.lookupId).toBe(b.lookupId);
    expect(a.passcodeAuthKey.equals(b.passcodeAuthKey)).toBe(true);
    expect(a.lookupId).not.toBe(c.lookupId);

    await expect(derivePasscodeLookup("INVALID01")).rejects.toThrow(
      /Invalid passcode/i,
    );
    await expect(derivePasscodeLookup("ABCD-EFG")).rejects.toThrow(
      /Invalid passcode/i,
    );
  });

  it("enforces maxConcurrent = 2 scrypt queue, execution/queue timeouts, and error cleanup", async () => {
    const pending: Array<{
      password: string;
      cb: (err: Error | null, derivedKey: Buffer) => void;
    }> = [];
    let maxConcurrentSeen = 0;

    const controlledScrypt: ScryptFn = (password, _salt, keylen, _opts, cb) => {
      pending.push({
        password,
        cb: (err, buf) => cb(err, buf.subarray(0, keylen)),
      });
      if (pending.length > maxConcurrentSeen) {
        maxConcurrentSeen = pending.length;
      }
    };

    const p1 = derivePasscodeLookup("AAAA-BBBB", {
      scryptFn: controlledScrypt,
    });
    const p2 = derivePasscodeLookup("CCCC-DDDD", {
      scryptFn: controlledScrypt,
    });
    const p3 = derivePasscodeLookup("EEEE-FFFF", {
      scryptFn: controlledScrypt,
    });
    const p4 = derivePasscodeLookup("GGGG-HHHH", {
      scryptFn: controlledScrypt,
    });

    await Promise.resolve();
    expect(pending.length).toBe(2);
    expect(maxConcurrentSeen).toBe(2);
    expect(getScryptQueueStats()).toEqual({ activeCount: 2, queuedCount: 2 });

    // Resolve first active job -> 3rd queued job enters active slot
    pending.shift()!.cb(null, Buffer.alloc(48, 1));
    await expect(p1).resolves.toMatchObject({
      lookupId: Buffer.alloc(16, 1).toString("base64url"),
    });
    await Promise.resolve();
    expect(pending.length).toBe(2);
    expect(getScryptQueueStats()).toEqual({ activeCount: 2, queuedCount: 1 });

    // Resolve remaining jobs
    pending.shift()!.cb(null, Buffer.alloc(48, 2));
    await expect(p2).resolves.toBeDefined();
    await Promise.resolve();
    expect(getScryptQueueStats()).toEqual({ activeCount: 2, queuedCount: 0 });

    pending.shift()!.cb(null, Buffer.alloc(48, 3));
    pending.shift()!.cb(null, Buffer.alloc(48, 4));
    await expect(Promise.all([p3, p4])).resolves.toHaveLength(2);
    expect(getScryptQueueStats()).toEqual({ activeCount: 0, queuedCount: 0 });

    // Execution timeout + late callback does not corrupt activeCount
    const stalledCallbacks: Array<
      (err: Error | null, derivedKey: Buffer) => void
    > = [];
    const stalledScrypt: ScryptFn = (_pw, _salt, _keylen, _opts, cb) => {
      stalledCallbacks.push(cb);
    };

    await expect(
      derivePasscodeLookup("JJJJ-KKKK", {
        scryptFn: stalledScrypt,
        timeoutMs: 20,
      }),
    ).rejects.toThrow(/timed out/i);
    expect(getScryptQueueStats()).toEqual({ activeCount: 0, queuedCount: 0 });

    // Trigger late callback after timeout; stats must remain 0
    stalledCallbacks.shift()!(null, Buffer.alloc(48, 9));
    expect(getScryptQueueStats()).toEqual({ activeCount: 0, queuedCount: 0 });

    // Queue timeout when both active slots are busy
    const hold1 = derivePasscodeLookup("MMMM-NNNN", {
      scryptFn: stalledScrypt,
      timeoutMs: 500,
    });
    const hold2 = derivePasscodeLookup("PPPP-QQQQ", {
      scryptFn: stalledScrypt,
      timeoutMs: 500,
    });
    await expect(
      derivePasscodeLookup("RRRR-SSSS", {
        scryptFn: stalledScrypt,
        timeoutMs: 20,
      }),
    ).rejects.toThrow(/queued timeout/i);

    expect(getScryptQueueStats()).toEqual({ activeCount: 2, queuedCount: 0 });
    stalledCallbacks.shift()!(null, Buffer.alloc(48, 5));
    stalledCallbacks.shift()!(null, Buffer.alloc(48, 6));
    await Promise.all([hold1, hold2]);
    expect(getScryptQueueStats()).toEqual({ activeCount: 0, queuedCount: 0 });

    // Error callback releases active slot
    const failingScrypt: ScryptFn = (_pw, _salt, _keylen, _opts, cb) => {
      cb(new Error("kdf hardware fault"), Buffer.alloc(0));
    };
    await expect(
      derivePasscodeLookup("TTTT-UUUU", { scryptFn: failingScrypt }),
    ).rejects.toThrow("kdf hardware fault");
    expect(getScryptQueueStats()).toEqual({ activeCount: 0, queuedCount: 0 });
  });

  it("completes mutual transcript-bound handshake for token and passcode paths", () => {
    const hostKeys = generateEd25519Keypair();
    const guestKeys = generateEd25519Keypair();
    const roomSalt = crypto.randomBytes(16);
    const inviteToken = crypto.randomBytes(16);
    const passcodeAuthKey = crypto.randomBytes(32);

    for (const authMode of ["token", "passcode"] as const) {
      const hostHs = createHostHandshake({
        roomId: "room-1",
        lookupId: "lookup-1",
        epoch: 3,
        roomSalt,
        hostKeypair: hostKeys,
        roomInviteToken: inviteToken,
        roomTokenEpoch: 2,
        passcodeAuthKey,
      });

      const guestHs = createGuestHandshake({
        guestKeypair: guestKeys,
        expectedRoomId: "room-1",
        expectedLookupId: "lookup-1",
        expectedHostPubKeyB64:
          authMode === "token" ? hostKeys.publicKeyB64 : undefined,
        authMode,
        authSecret: authMode === "token" ? inviteToken : passcodeAuthKey,
        tokenEpoch: authMode === "token" ? 2 : undefined,
      });

      const clientHello = guestHs.createClientHello();
      const hostHello = hostHs.receiveClientHello(clientHello);
      const clientAuth = guestHs.receiveHostHello(hostHello);
      const { serverAuth, session: hostSession } =
        hostHs.verifyClientAuth(clientAuth);
      const guestSession = guestHs.verifyServerAuth(serverAuth);

      const h2gFrame = encryptFrame(
        hostSession,
        JSON.stringify({ type: "PING" }),
      );
      expect(decryptFrame(guestSession, h2gFrame).toString("utf8")).toBe(
        '{"type":"PING"}',
      );

      const g2hFrame = encryptFrame(
        guestSession,
        JSON.stringify({ type: "PONG" }),
      );
      expect(decryptFrame(hostSession, g2hFrame).toString("utf8")).toBe(
        '{"type":"PONG"}',
      );
    }
  });

  it("rejects two-way ECDH MITM when attacker proxies across separate X25519 keys or tampers with handshake", () => {
    const hostKeys = generateEd25519Keypair();
    const guestKeys = generateEd25519Keypair();
    const attackerKeys = generateEd25519Keypair();
    const roomSalt = crypto.randomBytes(16);
    const inviteToken = crypto.randomBytes(16);

    // Case 1: Attacker swaps Guest's X25519 key in CLIENT_HELLO with attacker's X25519 key
    const hostHs = createHostHandshake({
      roomId: "room-mitm",
      lookupId: "lookup-mitm",
      epoch: 1,
      roomSalt,
      hostKeypair: hostKeys,
      roomInviteToken: inviteToken,
      roomTokenEpoch: 1,
    });
    const guestHs = createGuestHandshake({
      guestKeypair: guestKeys,
      expectedRoomId: "room-mitm",
      expectedHostPubKeyB64: hostKeys.publicKeyB64,
      authMode: "token",
      authSecret: inviteToken,
      tokenEpoch: 1,
    });

    const attackerEph = crypto.generateKeyPairSync("x25519");
    const attackerPubRaw = attackerEph.publicKey
      .export({ type: "spki", format: "der" })
      .subarray(12);

    guestHs.createClientHello();
    const hostHello = hostHs.receiveClientHello({
      type: "CLIENT_HELLO",
      guestEphPubB64: attackerPubRaw.toString("base64url"),
    });
    const clientAuth = guestHs.receiveHostHello(hostHello);

    try {
      hostHs.verifyClientAuth(clientAuth);
      expect.unreachable("Expected HandshakeError AUTH_FAILED");
    } catch (err) {
      expect(err).toBeInstanceOf(HandshakeError);
      expect((err as HandshakeError).code).toBe("AUTH_FAILED");
    }

    // Case 2: Attacker replaces hostEphPubB64 in HOST_HELLO (breaks Ed25519 signature)
    const hostHs2 = createHostHandshake({
      roomId: "room-mitm",
      lookupId: "lookup-mitm",
      epoch: 1,
      roomSalt,
      hostKeypair: hostKeys,
      roomInviteToken: inviteToken,
      roomTokenEpoch: 1,
    });
    const guestHs2 = createGuestHandshake({
      guestKeypair: guestKeys,
      expectedRoomId: "room-mitm",
      expectedHostPubKeyB64: hostKeys.publicKeyB64,
      authMode: "token",
      authSecret: inviteToken,
      tokenEpoch: 1,
    });
    const hh2 = hostHs2.receiveClientHello(guestHs2.createClientHello());
    try {
      guestHs2.receiveHostHello({
        ...hh2,
        hostEphPubB64: attackerPubRaw.toString("base64url"),
      });
      expect.unreachable("Expected HandshakeError INVALID_SIGNATURE");
    } catch (err) {
      expect(err).toBeInstanceOf(HandshakeError);
      expect((err as HandshakeError).code).toBe("INVALID_SIGNATURE");
    }

    // Case 3: Attacker impersonates Host with own Ed25519 keypair
    const guestHs3 = createGuestHandshake({
      guestKeypair: guestKeys,
      expectedRoomId: "room-mitm",
      expectedHostPubKeyB64: hostKeys.publicKeyB64,
      authMode: "token",
      authSecret: inviteToken,
      tokenEpoch: 1,
    });
    const evilHostHs = createHostHandshake({
      roomId: "room-mitm",
      lookupId: "lookup-mitm",
      epoch: 1,
      roomSalt,
      hostKeypair: attackerKeys,
      roomInviteToken: inviteToken,
      roomTokenEpoch: 1,
    });
    const evilHello = evilHostHs.receiveClientHello(
      guestHs3.createClientHello(),
    );
    try {
      guestHs3.receiveHostHello(evilHello);
      expect.unreachable("Expected HandshakeError HOST_KEY_MISMATCH");
    } catch (err) {
      expect(err).toBeInstanceOf(HandshakeError);
      expect((err as HandshakeError).code).toBe("HOST_KEY_MISMATCH");
    }

    // Case 4: Tampered SERVER_AUTH serverProof is rejected by Guest
    const hostHs4 = createHostHandshake({
      roomId: "room-mitm",
      lookupId: "lookup-mitm",
      epoch: 1,
      roomSalt,
      hostKeypair: hostKeys,
      roomInviteToken: inviteToken,
      roomTokenEpoch: 1,
    });
    const guestHs4 = createGuestHandshake({
      guestKeypair: guestKeys,
      expectedRoomId: "room-mitm",
      expectedHostPubKeyB64: hostKeys.publicKeyB64,
      authMode: "token",
      authSecret: inviteToken,
      tokenEpoch: 1,
    });
    const ca4 = guestHs4.receiveHostHello(
      hostHs4.receiveClientHello(guestHs4.createClientHello()),
    );
    const { serverAuth } = hostHs4.verifyClientAuth(ca4);
    const tamperedProof = Buffer.from(serverAuth.serverProofB64, "base64url");
    tamperedProof[0] ^= 0xff;
    try {
      guestHs4.verifyServerAuth({
        type: "SERVER_AUTH",
        serverProofB64: tamperedProof.toString("base64url"),
      });
      expect.unreachable("Expected HandshakeError AUTH_FAILED");
    } catch (err) {
      expect(err).toBeInstanceOf(HandshakeError);
      expect((err as HandshakeError).code).toBe("AUTH_FAILED");
    }

    // Case 5: Tampered roomSaltB64 in HOST_HELLO causes transcript mismatch -> AUTH_FAILED on Host
    const hostHs5 = createHostHandshake({
      roomId: "room-mitm",
      lookupId: "lookup-mitm",
      epoch: 1,
      roomSalt,
      hostKeypair: hostKeys,
      roomInviteToken: inviteToken,
      roomTokenEpoch: 1,
    });
    const guestHs5 = createGuestHandshake({
      guestKeypair: guestKeys,
      expectedRoomId: "room-mitm",
      expectedHostPubKeyB64: hostKeys.publicKeyB64,
      authMode: "token",
      authSecret: inviteToken,
      tokenEpoch: 1,
    });
    const hh5 = hostHs5.receiveClientHello(guestHs5.createClientHello());
    const ca5 = guestHs5.receiveHostHello({
      ...hh5,
      roomSaltB64: crypto.randomBytes(16).toString("base64url"),
    });
    try {
      hostHs5.verifyClientAuth(ca5);
      expect.unreachable("Expected HandshakeError AUTH_FAILED");
    } catch (err) {
      expect(err).toBeInstanceOf(HandshakeError);
      expect((err as HandshakeError).code).toBe("AUTH_FAILED");
    }

    // Case 6: Low-order all-zero X25519 key is rejected with HandshakeError MALFORMED
    const zeroPubB64 = Buffer.alloc(32, 0).toString("base64url");
    const hostHs6 = createHostHandshake({
      roomId: "room-mitm",
      lookupId: "lookup-mitm",
      epoch: 1,
      roomSalt,
      hostKeypair: hostKeys,
      roomInviteToken: inviteToken,
      roomTokenEpoch: 1,
    });
    const guestHs6 = createGuestHandshake({
      guestKeypair: guestKeys,
      expectedRoomId: "room-mitm",
      expectedHostPubKeyB64: hostKeys.publicKeyB64,
      authMode: "token",
      authSecret: inviteToken,
      tokenEpoch: 1,
    });
    hostHs6.receiveClientHello({
      type: "CLIENT_HELLO",
      guestEphPubB64: zeroPubB64,
    });
    const helperHost = createHostHandshake({
      roomId: "room-mitm",
      lookupId: "lookup-mitm",
      epoch: 1,
      roomSalt,
      hostKeypair: hostKeys,
      roomInviteToken: inviteToken,
      roomTokenEpoch: 1,
    });
    const ca6 = guestHs6.receiveHostHello(
      helperHost.receiveClientHello(guestHs6.createClientHello()),
    );
    try {
      hostHs6.verifyClientAuth(ca6);
      expect.unreachable("Expected HandshakeError MALFORMED");
    } catch (err) {
      expect(err).toBeInstanceOf(HandshakeError);
      expect((err as HandshakeError).code).toBe("MALFORMED");
    }
  });

  it("enforces HostAuthGuard bans, per-peer rate limit, passcode pause, and roomTokenEpoch rotation", () => {
    let now = 10_000;
    const guard = new HostAuthGuard({ nowMs: () => now });
    const hostKeys = generateEd25519Keypair();
    const guestKeys = generateEd25519Keypair();
    const bannedGuestKeys = generateEd25519Keypair();
    const roomSalt = crypto.randomBytes(16);
    const inviteToken = crypto.randomBytes(16);
    const passcodeAuthKey = crypto.randomBytes(32);
    const wrongSecret = crypto.randomBytes(32);

    const attemptHandshake = (params: {
      authMode: "token" | "passcode";
      authSecret: Buffer;
      tokenEpoch?: number;
      hostTokenEpoch?: number;
      peerRateKey?: string;
      guestKeypair?: typeof guestKeys;
    }) => {
      const hostHs = createHostHandshake({
        roomId: "room-guard",
        lookupId: "lookup-guard",
        epoch: 1,
        roomSalt,
        hostKeypair: hostKeys,
        roomInviteToken: inviteToken,
        roomTokenEpoch: params.hostTokenEpoch ?? 1,
        passcodeAuthKey,
        authGuard: guard,
        peerRateKey: params.peerRateKey,
      });
      const guestHs = createGuestHandshake({
        guestKeypair: params.guestKeypair ?? guestKeys,
        expectedHostPubKeyB64:
          params.authMode === "token" ? hostKeys.publicKeyB64 : undefined,
        authMode: params.authMode,
        authSecret: params.authSecret,
        tokenEpoch: params.tokenEpoch,
      });
      const hh = hostHs.receiveClientHello(guestHs.createClientHello());
      const ca = guestHs.receiveHostHello(hh);
      const { serverAuth } = hostHs.verifyClientAuth(ca);
      return guestHs.verifyServerAuth(serverAuth);
    };

    // 4 failures + 1 success clears streak
    for (let i = 0; i < 4; i++) {
      expect(() =>
        attemptHandshake({
          authMode: "passcode",
          authSecret: wrongSecret,
          peerRateKey: "streak-reset-peer",
        }),
      ).toThrowError(HandshakeError);
    }
    expect(guard.isRateLimited("streak-reset-peer")).toBe(false);
    expect(
      attemptHandshake({
        authMode: "passcode",
        authSecret: passcodeAuthKey,
        peerRateKey: "streak-reset-peer",
      }),
    ).toBeDefined();
    for (let i = 0; i < 4; i++) {
      expect(() =>
        attemptHandshake({
          authMode: "passcode",
          authSecret: wrongSecret,
          peerRateKey: "streak-reset-peer",
        }),
      ).toThrowError(HandshakeError);
    }
    expect(guard.isRateLimited("streak-reset-peer")).toBe(false);

    // 5 failed attempts rate-limit a peer for 60s
    for (let i = 0; i < 5; i++) {
      expect(() =>
        attemptHandshake({
          authMode: "passcode",
          authSecret: wrongSecret,
          peerRateKey: "10.0.0.2",
        }),
      ).toThrowError(HandshakeError);
    }
    expect(guard.isRateLimited("10.0.0.2")).toBe(true);
    try {
      attemptHandshake({
        authMode: "passcode",
        authSecret: passcodeAuthKey,
        peerRateKey: "10.0.0.2",
      });
      expect.unreachable("Expected RATE_LIMITED");
    } catch (err) {
      expect(err).toBeInstanceOf(HandshakeError);
      expect((err as HandshakeError).code).toBe("RATE_LIMITED");
    }

    now += 60_000;
    expect(guard.isRateLimited("10.0.0.2")).toBe(false);

    // 20 total passcode failures pause passcode joins, while signed invite links STILL succeed
    // (we already had 4 + 4 + 5 = 13 passcode failures above; add 7 more -> 20)
    expect(guard.getPasscodeFailureCount()).toBe(13);
    for (let i = 0; i < 7; i++) {
      guard.recordFailure(`attacker-${i}`, "passcode");
    }
    expect(guard.getPasscodeFailureCount()).toBe(20);
    expect(guard.isPasscodePaused()).toBe(true);

    try {
      attemptHandshake({
        authMode: "passcode",
        authSecret: passcodeAuthKey,
        peerRateKey: "fresh-peer",
      });
      expect.unreachable("Expected PASSCODE_PAUSED");
    } catch (err) {
      expect(err).toBeInstanceOf(HandshakeError);
      expect((err as HandshakeError).code).toBe("PASSCODE_PAUSED");
    }

    // Signed invite link STILL succeeds while passcode joins are paused
    expect(
      attemptHandshake({
        authMode: "token",
        authSecret: inviteToken,
        tokenEpoch: 1,
        peerRateKey: "fresh-token-peer",
      }),
    ).toBeDefined();

    // Resetting passcode lockout restores passcode joins
    guard.resetPasscodeLockout();
    expect(guard.isPasscodePaused()).toBe(false);
    expect(
      attemptHandshake({
        authMode: "passcode",
        authSecret: passcodeAuthKey,
        peerRateKey: "fresh-peer",
      }),
    ).toBeDefined();

    // Banned identity is rejected with BANNED, and unbanning restores access
    guard.banPeer(bannedGuestKeys.publicKeyB64);
    expect(guard.isBanned(bannedGuestKeys.publicKeyB64)).toBe(true);
    try {
      attemptHandshake({
        authMode: "token",
        authSecret: inviteToken,
        tokenEpoch: 1,
        peerRateKey: "banned-ip",
        guestKeypair: bannedGuestKeys,
      });
      expect.unreachable("Expected BANNED");
    } catch (err) {
      expect(err).toBeInstanceOf(HandshakeError);
      expect((err as HandshakeError).code).toBe("BANNED");
    }
    guard.unbanPeer(bannedGuestKeys.publicKeyB64);
    expect(
      attemptHandshake({
        authMode: "token",
        authSecret: inviteToken,
        tokenEpoch: 1,
        peerRateKey: "banned-ip",
        guestKeypair: bannedGuestKeys,
      }),
    ).toBeDefined();

    // roomTokenEpoch rotation invalidates old invite tokens (te=1 rejected when host expects te=2)
    try {
      attemptHandshake({
        authMode: "token",
        authSecret: inviteToken,
        tokenEpoch: 1,
        hostTokenEpoch: 2,
        peerRateKey: "old-token-peer",
      });
      expect.unreachable("Expected TOKEN_EPOCH_MISMATCH");
    } catch (err) {
      expect(err).toBeInstanceOf(HandshakeError);
      expect((err as HandshakeError).code).toBe("TOKEN_EPOCH_MISMATCH");
    }
    expect(
      attemptHandshake({
        authMode: "token",
        authSecret: inviteToken,
        tokenEpoch: 2,
        hostTokenEpoch: 2,
        peerRateKey: "new-token-peer",
      }),
    ).toBeDefined();
  });

  it("enforces AES-256-GCM directional key separation, replay rejection, AAD binding, and rekey guard", () => {
    const ecdhShared = crypto.randomBytes(32);
    const authSecret = crypto.randomBytes(32);
    const transcriptHash = crypto.randomBytes(32);
    const connNonce = crypto.randomBytes(32);

    const hostSession = createLinkSession({
      role: "host",
      roomId: "room-aead",
      epoch: 4,
      connNonce,
      ecdhShared,
      authSecret,
      transcriptHash,
    });
    const guestSession = createLinkSession({
      role: "guest",
      roomId: "room-aead",
      epoch: 4,
      connNonce,
      ecdhShared,
      authSecret,
      transcriptHash,
    });

    // Directional key separation: h2g !== g2h
    expect(hostSession.txDirection).toBe("h2g");
    expect(hostSession.rxDirection).toBe("g2h");
    expect(guestSession.txDirection).toBe("g2h");
    expect(guestSession.rxDirection).toBe("h2g");
    expect(hostSession.txKey.equals(guestSession.rxKey)).toBe(true);
    expect(hostSession.rxKey.equals(guestSession.txKey)).toBe(true);
    expect(hostSession.txKey.equals(hostSession.rxKey)).toBe(false);

    const f0 = encryptFrame(hostSession, "msg-0");
    const f1 = encryptFrame(hostSession, "msg-1");
    const f2 = encryptFrame(hostSession, "msg-2");
    expect(f0.readBigUInt64BE(1)).toBe(0n);
    expect(f1.readBigUInt64BE(1)).toBe(1n);
    expect(f2.readBigUInt64BE(1)).toBe(2n);

    expect(decryptFrame(guestSession, f0).toString("utf8")).toBe("msg-0");
    // Replaying counter 0 is rejected
    expect(() => decryptFrame(guestSession, f0)).toThrow(/Replay/i);

    // Tampered frame with higher counter must fail auth and must NOT advance lastRxCounter
    const forged = Buffer.from(f1);
    forged.writeBigUInt64BE(999n, 1);
    expect(() => decryptFrame(guestSession, forged)).toThrow();
    expect(guestSession.lastRxCounter).toBe(0n);

    // Skipped counter (f2) advances lastRxCounter to 2n, and late f1 (counter <= lastRxCounter) is rejected
    expect(decryptFrame(guestSession, f2).toString("utf8")).toBe("msg-2");
    expect(guestSession.lastRxCounter).toBe(2n);
    expect(() => decryptFrame(guestSession, f1)).toThrow(/Replay/i);

    // Directional isolation: host cannot decrypt host's own h2g frame; guest cannot decrypt guest's own g2h frame
    const anotherHostSession = createLinkSession({
      role: "host",
      roomId: "room-aead",
      epoch: 4,
      connNonce,
      ecdhShared,
      authSecret,
      transcriptHash,
    });
    expect(() => decryptFrame(anotherHostSession, f0)).toThrow();

    const g0 = encryptFrame(guestSession, "guest-msg-0");
    const anotherGuestSession = createLinkSession({
      role: "guest",
      roomId: "room-aead",
      epoch: 4,
      connNonce,
      ecdhShared,
      authSecret,
      transcriptHash,
    });
    expect(() => decryptFrame(anotherGuestSession, g0)).toThrow();
    expect(decryptFrame(hostSession, g0).toString("utf8")).toBe("guest-msg-0");

    // AAD mismatch (different epoch, different roomId, different connNonce) fails
    const wrongEpochGuest = createLinkSession({
      role: "guest",
      roomId: "room-aead",
      epoch: 5,
      connNonce,
      ecdhShared,
      authSecret,
      transcriptHash,
    });
    expect(() => decryptFrame(wrongEpochGuest, f0)).toThrow();

    const wrongRoomGuest = createLinkSession({
      role: "guest",
      roomId: "room-other",
      epoch: 4,
      connNonce,
      ecdhShared,
      authSecret,
      transcriptHash,
    });
    expect(() => decryptFrame(wrongRoomGuest, f0)).toThrow();

    const wrongNonceGuest = createLinkSession({
      role: "guest",
      roomId: "room-aead",
      epoch: 4,
      connNonce: crypto.randomBytes(32),
      ecdhShared,
      authSecret,
      transcriptHash,
    });
    expect(() => decryptFrame(wrongNonceGuest, f0)).toThrow();

    // Tampered tag or ciphertext fails on valid session without advancing lastRxCounter
    const f3 = encryptFrame(hostSession, "msg-3");
    const badTag = Buffer.from(f3);
    badTag[12] ^= 0xff;
    expect(() => decryptFrame(guestSession, badTag)).toThrow();
    expect(guestSession.lastRxCounter).toBe(2n);

    const badCiphertext = Buffer.from(f3);
    badCiphertext[badCiphertext.length - 1] ^= 0xff;
    expect(() => decryptFrame(guestSession, badCiphertext)).toThrow();
    expect(guestSession.lastRxCounter).toBe(2n);

    expect(decryptFrame(guestSession, f3).toString("utf8")).toBe("msg-3");

    // Short frame and bad version rejected
    expect(() => decryptFrame(guestSession, Buffer.alloc(24))).toThrow(
      /too short/i,
    );
    const badVersion = Buffer.from(f0);
    badVersion[0] = 0x02;
    expect(() => decryptFrame(guestSession, badVersion)).toThrow(
      /Unsupported frame version/i,
    );

    // Rekey guard on RX (counter >= REKEY_COUNTER_LIMIT)
    const rxOverflowFrame = Buffer.from(f0);
    rxOverflowFrame.writeBigUInt64BE(REKEY_COUNTER_LIMIT, 1);
    expect(() => decryptFrame(guestSession, rxOverflowFrame)).toThrow(/rekey/i);

    // Rekey guard on TX at counter >= 0xffffffff
    hostSession.txCounter = REKEY_COUNTER_LIMIT;
    expect(() => encryptFrame(hostSession, "overflow")).toThrow(/rekey/i);
  });

  it("never leaks passcodes, tokens, signatures, private keys, shared secrets, authKey, or frame plaintext in logs", async () => {
    const spy = createSpyLogger();
    const hostKeys = generateEd25519Keypair();
    const guestKeys = generateEd25519Keypair();
    const roomSalt = crypto.randomBytes(16);
    const inviteToken = crypto.randomBytes(16);
    const inviteTokenB64 = inviteToken.toString("base64url");
    const passcode = "WXYZ-2345";
    const normalizedPasscode = "WXYZ2345";
    const plaintextPayload = "SECRET_TRACK_TITLE_AND_AUTH_PAYLOAD_999";

    const envelope = signInviteEnvelope(
      {
        r: "room-redact",
        k: hostKeys.publicKeyB64,
        t: inviteTokenB64,
        sig: "wss://relay.example.com",
        exp: 2_000_000_000_000,
        te: 1,
      },
      hostKeys.privateKey,
    );
    expect(
      verifyInviteEnvelope(envelope, {
        nowMs: 1_900_000_000_000,
        logger: spy.logger,
      }),
    ).toBe(true);
    // Trigger expired warn log
    expect(
      verifyInviteEnvelope(envelope, {
        nowMs: 2_000_000_000_001,
        logger: spy.logger,
      }),
    ).toBe(false);

    const kdf = await derivePasscodeLookup(passcode, { logger: spy.logger });
    await expect(
      derivePasscodeLookup("BAD-01IL", { logger: spy.logger }),
    ).rejects.toThrow();

    const guard = new HostAuthGuard({ logger: spy.logger });
    const hostHs = createHostHandshake({
      roomId: "room-redact",
      lookupId: kdf.lookupId,
      epoch: 1,
      roomSalt,
      hostKeypair: hostKeys,
      roomInviteToken: inviteToken,
      roomTokenEpoch: 1,
      passcodeAuthKey: kdf.passcodeAuthKey,
      authGuard: guard,
      peerRateKey: "peer-1",
      logger: spy.logger,
    });
    const guestHs = createGuestHandshake({
      guestKeypair: guestKeys,
      expectedRoomId: "room-redact",
      expectedHostPubKeyB64: hostKeys.publicKeyB64,
      authMode: "token",
      authSecret: inviteToken,
      tokenEpoch: 1,
      logger: spy.logger,
    });

    const clientHello = guestHs.createClientHello();
    const hostHello = hostHs.receiveClientHello(clientHello);
    const clientAuth = guestHs.receiveHostHello(hostHello);
    const { serverAuth, session: hostSession } =
      hostHs.verifyClientAuth(clientAuth);
    const guestSession = guestHs.verifyServerAuth(serverAuth);

    const encrypted = encryptFrame(hostSession, plaintextPayload, spy.logger);
    expect(
      decryptFrame(guestSession, encrypted, spy.logger).toString("utf8"),
    ).toBe(plaintextPayload);
    // Trigger replay warn log
    expect(() => decryptFrame(guestSession, encrypted, spy.logger)).toThrow();

    // Trigger handshake auth failure warn log on passcode path
    const badHostHs = createHostHandshake({
      roomId: "room-redact",
      lookupId: kdf.lookupId,
      epoch: 1,
      roomSalt,
      hostKeypair: hostKeys,
      passcodeAuthKey: kdf.passcodeAuthKey,
      authGuard: guard,
      peerRateKey: "peer-bad",
      logger: spy.logger,
    });
    const badGuestHs = createGuestHandshake({
      guestKeypair: guestKeys,
      authMode: "passcode",
      authSecret: crypto.randomBytes(32),
      logger: spy.logger,
    });
    const hhBad = badHostHs.receiveClientHello(badGuestHs.createClientHello());
    expect(() =>
      badHostHs.verifyClientAuth(badGuestHs.receiveHostHello(hhBad)),
    ).toThrow();

    // Export hostPrivKey and derive exact session keys/authKey equivalents to verify none appear in logs
    const hostPrivDer = hostKeys.privateKey.export({
      type: "pkcs8",
      format: "der",
    });
    const hostPrivPem = hostKeys.privateKey.export({
      type: "pkcs8",
      format: "pem",
    }) as string;

    const dumpedLogs = spy.dump();
    expect(spy.entries.length).toBeGreaterThan(0);

    const forbiddenValues = [
      passcode,
      normalizedPasscode,
      inviteTokenB64,
      inviteToken.toString("hex"),
      envelope.s,
      hostPrivDer.toString("base64"),
      hostPrivDer.toString("base64url"),
      hostPrivDer.toString("hex"),
      hostPrivPem,
      kdf.passcodeAuthKey.toString("base64"),
      kdf.passcodeAuthKey.toString("base64url"),
      hostHello.hostEphSigB64,
      clientAuth.clientProofB64,
      serverAuth.serverProofB64,
      hostSession.txKey.toString("base64"),
      hostSession.txKey.toString("base64url"),
      hostSession.rxKey.toString("base64"),
      hostSession.rxKey.toString("base64url"),
      guestSession.txKey.toString("base64url"),
      guestSession.rxKey.toString("base64url"),
      plaintextPayload,
    ];

    for (const secret of forbiddenValues) {
      expect(dumpedLogs).not.toContain(secret);
    }
  });
});
