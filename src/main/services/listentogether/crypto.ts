import crypto, { type KeyObject } from "node:crypto";
import {
  noopLogger,
  type ListenTogetherLogger,
} from "~shared/listentogether/logger";
import {
  normalizePasscode,
  type InviteEnvelope,
} from "~shared/listentogether/protocol";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const X25519_SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");

const SCRYPT_SALT = "ytmd-lookup-kdf-v1";
const SCRYPT_KEYLEN = 48;
const SCRYPT_OPTIONS: crypto.ScryptOptions = {
  N: 32768,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
};
const MAX_CONCURRENT_SCRYPT = 2;

const CROCKFORD_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

const EPH_SIG_DOMAIN = Buffer.from("ytmd-eph-v1", "utf8");
const AUTH_HASH_DOMAIN = Buffer.from("ytmd-auth-v1", "utf8");
const AUTH_HKDF_INFO = Buffer.from("ytmd-listen-v1-auth", "utf8");
const H2G_HKDF_INFO = Buffer.from("h2g", "utf8");
const G2H_HKDF_INFO = Buffer.from("g2h", "utf8");

const FRAME_VERSION = 0x01;
const FRAME_HEADER_BYTES = 1 + 8 + 16; // version + uint64be counter + GCM tag
export const REKEY_COUNTER_LIMIT = 0xffffffffn;

const DEFAULT_PEER_FAIL_LIMIT = 5;
const DEFAULT_PEER_BLOCK_MS = 60_000;
const DEFAULT_GLOBAL_PASSCODE_FAIL_LIMIT = 20;
const DEFAULT_SCRYPT_TIMEOUT_MS = 10_000;

export type Ed25519Keypair = {
  publicKeyB64: string;
  privateKey: KeyObject;
};

export type UnsignedInviteEnvelope = Omit<InviteEnvelope, "s">;

export type PasscodeLookupResult = {
  lookupId: string;
  passcodeAuthKey: Buffer;
};

export type AuthMode = "token" | "passcode" | "friend";

export type ClientHello = {
  type: "CLIENT_HELLO";
  guestEphPubB64: string;
};

export type HostHello = {
  type: "HOST_HELLO";
  roomId: string;
  lookupId: string;
  epoch: number;
  connNonceB64: string;
  roomSaltB64: string;
  hostEphPubB64: string;
  hostIdentityPubB64: string;
  hostEphSigB64: string;
};

export type ClientAuth = {
  type: "CLIENT_AUTH";
  clientIdentityPubB64: string;
  clientProofB64: string;
  authMode: AuthMode;
  tokenEpoch?: number;
};

export type ServerAuth = {
  type: "SERVER_AUTH";
  serverProofB64: string;
};

export type HandshakeErrorCode =
  | "INVALID_SIGNATURE"
  | "HOST_KEY_MISMATCH"
  | "ROOM_MISMATCH"
  | "AUTH_FAILED"
  | "BANNED"
  | "RATE_LIMITED"
  | "PASSCODE_PAUSED"
  | "TOKEN_EPOCH_MISMATCH"
  | "MALFORMED"
  | "INVALID_STATE";

export class HandshakeError extends Error {
  public readonly code: HandshakeErrorCode;

  constructor(code: HandshakeErrorCode, message: string) {
    super(message);
    this.name = "HandshakeError";
    this.code = code;
  }
}

export type LinkRole = "host" | "guest";

export type LinkSession = {
  readonly role: LinkRole;
  readonly roomId: string;
  readonly epoch: number;
  readonly connNonce: Buffer;
  readonly txKey: Buffer;
  readonly rxKey: Buffer;
  readonly txDirection: "h2g" | "g2h";
  readonly rxDirection: "h2g" | "g2h";
  txCounter: bigint;
  lastRxCounter: bigint;
};

export type HostAuthGuardOptions = {
  nowMs?: () => number;
  peerFailLimit?: number;
  peerBlockMs?: number;
  globalPasscodeFailLimit?: number;
  logger?: ListenTogetherLogger;
};

export class HostAuthGuard {
  private readonly nowMs: () => number;
  private readonly peerFailLimit: number;
  private readonly peerBlockMs: number;
  private readonly globalPasscodeFailLimit: number;
  private readonly logger: ListenTogetherLogger;
  private readonly bannedPeers = new Set<string>();
  private readonly peerFailures = new Map<
    string,
    { count: number; blockedUntilMs: number }
  >();
  private totalPasscodeFailures = 0;

  constructor(options: HostAuthGuardOptions = {}) {
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.peerFailLimit = options.peerFailLimit ?? DEFAULT_PEER_FAIL_LIMIT;
    this.peerBlockMs = options.peerBlockMs ?? DEFAULT_PEER_BLOCK_MS;
    this.globalPasscodeFailLimit =
      options.globalPasscodeFailLimit ?? DEFAULT_GLOBAL_PASSCODE_FAIL_LIMIT;
    this.logger = options.logger ?? noopLogger;
  }

  public banPeer(clientIdentityPubB64: string): void {
    this.bannedPeers.add(clientIdentityPubB64);
    this.logger.info?.("Banned peer identity", {
      peerKey: clientIdentityPubB64,
    });
  }

  public unbanPeer(clientIdentityPubB64: string): void {
    const removed = this.bannedPeers.delete(clientIdentityPubB64);
    if (removed) {
      this.logger.info?.("Unbanned peer identity", {
        peerKey: clientIdentityPubB64,
      });
    }
  }

  public isBanned(clientIdentityPubB64: string): boolean {
    return this.bannedPeers.has(clientIdentityPubB64);
  }

  public isRateLimited(peerKey: string): boolean {
    const state = this.peerFailures.get(peerKey);
    if (!state) return false;
    if (state.blockedUntilMs > this.nowMs()) {
      return true;
    }
    if (state.blockedUntilMs > 0) {
      this.peerFailures.delete(peerKey);
      this.logger.debug?.("Peer rate-limit window expired", { peerKey });
    }
    return false;
  }

  public isPasscodePaused(): boolean {
    return this.totalPasscodeFailures >= this.globalPasscodeFailLimit;
  }

  public recordFailure(peerKey: string, authMode: AuthMode): void {
    const now = this.nowMs();
    const prev = this.peerFailures.get(peerKey);
    const activeCount =
      prev && (prev.blockedUntilMs === 0 || prev.blockedUntilMs > now)
        ? prev.count
        : 0;
    const nextCount = activeCount + 1;
    const blockedUntilMs =
      nextCount >= this.peerFailLimit ? now + this.peerBlockMs : 0;
    this.peerFailures.set(peerKey, { count: nextCount, blockedUntilMs });

    if (blockedUntilMs > 0 && (!prev || prev.blockedUntilMs <= now)) {
      this.logger.warn?.("Peer rate-limited after repeated auth failures", {
        peerKey,
        authMode,
        failCount: nextCount,
        blockedUntilMs,
      });
    }

    if (authMode === "passcode") {
      this.totalPasscodeFailures += 1;
      if (this.totalPasscodeFailures === this.globalPasscodeFailLimit) {
        this.logger.warn?.("Global passcode joins paused after failures", {
          totalPasscodeFailures: this.totalPasscodeFailures,
          limit: this.globalPasscodeFailLimit,
        });
      }
    }
  }

  public recordSuccess(peerKey: string): void {
    this.peerFailures.delete(peerKey);
  }

  public resetPasscodeLockout(): void {
    const previousFailures = this.totalPasscodeFailures;
    this.totalPasscodeFailures = 0;
    if (previousFailures > 0) {
      this.logger.info?.("Reset global passcode lockout", {
        previousFailures,
      });
    }
  }

  public getPasscodeFailureCount(): number {
    return this.totalPasscodeFailures;
  }
}

export type ScryptFn = (
  password: string,
  salt: string,
  keylen: number,
  options: crypto.ScryptOptions,
  callback: (err: Error | null, derivedKey: Buffer) => void,
) => void;

export type DerivePasscodeLookupOptions = {
  logger?: ListenTogetherLogger;
  timeoutMs?: number;
  scryptFn?: ScryptFn;
};

let activeScryptCount = 0;
const scryptWaitQueue: Array<() => void> = [];

/**
 * Returns current scrypt KDF concurrency and wait queue depth.
 */
export function getScryptQueueStats(): {
  activeCount: number;
  queuedCount: number;
} {
  return {
    activeCount: activeScryptCount,
    queuedCount: scryptWaitQueue.length,
  };
}

async function runQueuedScrypt(
  normalizedCode: string,
  logger: ListenTogetherLogger = noopLogger,
  timeoutMs: number = DEFAULT_SCRYPT_TIMEOUT_MS,
  scryptFn: ScryptFn = crypto.scrypt,
): Promise<Buffer> {
  if (activeScryptCount >= MAX_CONCURRENT_SCRYPT) {
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const waiter = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        resolve();
      };
      scryptWaitQueue.push(waiter);
      logger.debug?.("Scrypt KDF request queued", {
        activeCount: activeScryptCount,
        queueDepth: scryptWaitQueue.length,
      });

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          timer = null;
          const idx = scryptWaitQueue.indexOf(waiter);
          if (idx >= 0) {
            scryptWaitQueue.splice(idx, 1);
          }
          logger.warn?.("Scrypt KDF request timed out in queue", {
            activeCount: activeScryptCount,
            queueDepth: scryptWaitQueue.length,
            timeoutMs,
          });
          reject(new Error(`Scrypt KDF queued timeout after ${timeoutMs} ms`));
        }, timeoutMs);
      }
    });
  }

  activeScryptCount += 1;
  let slotReleased = false;
  const releaseSlot = () => {
    if (slotReleased) return;
    slotReleased = true;
    activeScryptCount = Math.max(0, activeScryptCount - 1);
    const next = scryptWaitQueue.shift();
    if (next) next();
  };

  try {
    return await new Promise<Buffer>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          timer = null;
          logger.warn?.("Scrypt KDF execution timed out", {
            activeCount: activeScryptCount,
            queueDepth: scryptWaitQueue.length,
            timeoutMs,
          });
          releaseSlot();
          reject(new Error(`Scrypt KDF timed out after ${timeoutMs} ms`));
        }, timeoutMs);
      }

      scryptFn(
        normalizedCode,
        SCRYPT_SALT,
        SCRYPT_KEYLEN,
        SCRYPT_OPTIONS,
        (err, derivedKey) => {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          if (settled) {
            return;
          }
          settled = true;
          if (err) {
            logger.error?.("Scrypt KDF derivation failed", {
              error: err.message,
            });
            reject(err);
            return;
          }
          resolve(derivedKey);
        },
      );
    });
  } finally {
    releaseSlot();
  }
}

function decodeStrictBase64Url(
  value: string,
  expectedBytes: number,
): Buffer | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length % 4 === 1 ||
    !BASE64URL_RE.test(value)
  ) {
    return null;
  }
  const buf = Buffer.from(value, "base64url");
  if (buf.length !== expectedBytes) {
    return null;
  }
  return buf;
}

function rawKeyFromSpki(key: KeyObject, expectedPrefix: Buffer): Buffer {
  const der = key.export({ type: "spki", format: "der" });
  if (
    der.length !== expectedPrefix.length + 32 ||
    !der.subarray(0, expectedPrefix.length).equals(expectedPrefix)
  ) {
    throw new Error("Unexpected SPKI key encoding");
  }
  return Buffer.from(der.subarray(expectedPrefix.length));
}

function spkiKeyFromRaw(raw: Buffer, prefix: Buffer): KeyObject {
  if (raw.length !== 32) {
    throw new Error("Raw key must be 32 bytes");
  }
  const der = Buffer.concat([prefix, raw]);
  return crypto.createPublicKey({ key: der, format: "der", type: "spki" });
}

function encodeLengthPrefixedUtf8(value: string): Buffer {
  return encodeLengthPrefixedBuffer(Buffer.from(value, "utf8"));
}

function encodeLengthPrefixedBuffer(value: Buffer): Buffer {
  const len = Buffer.allocUnsafe(4);
  len.writeUInt32BE(value.length, 0);
  return Buffer.concat([len, value]);
}

function canonicalInvitePayload(
  envelope: Pick<InviteEnvelope, "r" | "k" | "exp" | "sig" | "te">,
): Buffer {
  return Buffer.from(
    JSON.stringify({
      exp: envelope.exp ?? null,
      k: envelope.k,
      r: envelope.r,
      sig: envelope.sig ?? null,
      te: envelope.te,
    }),
    "utf8",
  );
}

function buildEphemeralSignaturePayload(params: {
  roomId: string;
  epoch: number;
  connNonce: Buffer;
  hostEphPub: Buffer;
}): Buffer {
  const epochBuf = Buffer.allocUnsafe(4);
  epochBuf.writeUInt32BE(params.epoch >>> 0, 0);
  return Buffer.concat([
    EPH_SIG_DOMAIN,
    encodeLengthPrefixedUtf8(params.roomId),
    epochBuf,
    params.connNonce,
    params.hostEphPub,
  ]);
}

function computeTranscriptHash(params: {
  roomId: string;
  lookupId: string;
  hostEphPub: Buffer;
  guestEphPub: Buffer;
  connNonce: Buffer;
  roomSalt: Buffer;
}): Buffer {
  return crypto
    .createHash("sha256")
    .update(AUTH_HASH_DOMAIN)
    .update(encodeLengthPrefixedUtf8(params.roomId))
    .update(encodeLengthPrefixedUtf8(params.lookupId))
    .update(params.hostEphPub)
    .update(params.guestEphPub)
    .update(params.connNonce)
    .update(encodeLengthPrefixedBuffer(params.roomSalt))
    .digest();
}

function deriveHkdfKey(
  ecdhShared: Buffer,
  authSecret: Buffer,
  transcriptHash: Buffer,
  info: Buffer,
): Buffer {
  const ikm = Buffer.concat([ecdhShared, authSecret]);
  return Buffer.from(crypto.hkdfSync("sha256", ikm, transcriptHash, info, 32));
}

function computeHmacProof(
  authKey: Buffer,
  label: "client" | "server",
  transcriptHash: Buffer,
): Buffer {
  return crypto
    .createHmac("sha256", authKey)
    .update(label)
    .update(transcriptHash)
    .digest();
}

function buildFrameAad(params: {
  roomId: string;
  epoch: number;
  connNonce: Buffer;
  direction: "h2g" | "g2h";
  counter: bigint;
}): Buffer {
  const fixed = Buffer.allocUnsafe(4 + 32 + 3 + 8);
  fixed.writeUInt32BE(params.epoch >>> 0, 0);
  params.connNonce.copy(fixed, 4);
  fixed.write(params.direction, 36, 3, "ascii");
  fixed.writeBigUInt64BE(params.counter, 39);
  return Buffer.concat([encodeLengthPrefixedUtf8(params.roomId), fixed]);
}

function buildNonce(epoch: number, counter: bigint): Buffer {
  const nonce = Buffer.allocUnsafe(12);
  nonce.writeUInt32BE(epoch >>> 0, 0);
  nonce.writeBigUInt64BE(counter, 4);
  return nonce;
}

/**
 * Generates an Ed25519 identity keypair with a raw 32-byte base64url public key.
 */
export function generateEd25519Keypair(): Ed25519Keypair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const rawPub = rawKeyFromSpki(publicKey, ED25519_SPKI_PREFIX);
  return {
    publicKeyB64: rawPub.toString("base64url"),
    privateKey,
  };
}

/**
 * Signs arbitrary bytes with an Ed25519 private key.
 */
export function signEd25519(data: Buffer, privateKey: KeyObject): Buffer {
  return crypto.sign(null, data, privateKey);
}

/**
 * Verifies an Ed25519 signature against a raw 32-byte base64url public key.
 */
export function verifyEd25519(
  data: Buffer,
  signature: Buffer,
  publicKeyB64: string,
  logger: ListenTogetherLogger = noopLogger,
): boolean {
  const rawPub = decodeStrictBase64Url(publicKeyB64, 32);
  if (!rawPub || signature.length !== 64) {
    logger.warn?.("Ed25519 signature verification failed", {
      reason: !rawPub ? "invalid_public_key" : "invalid_signature_length",
    });
    return false;
  }
  try {
    const keyObj = spkiKeyFromRaw(rawPub, ED25519_SPKI_PREFIX);
    const verified = crypto.verify(null, data, keyObj, signature);
    if (!verified) {
      logger.warn?.("Ed25519 signature verification failed", {
        reason: "signature_mismatch",
      });
    }
    return verified;
  } catch {
    logger.warn?.("Ed25519 signature verification failed", {
      reason: "verify_exception",
    });
    return false;
  }
}

/**
 * Signs an invite envelope over canonical JSON `{ r, k, exp, sig, te }`.
 */
export function signInviteEnvelope(
  unsigned: UnsignedInviteEnvelope,
  privateKey: KeyObject,
): InviteEnvelope {
  const payload = canonicalInvitePayload(unsigned);
  const sig = signEd25519(payload, privateKey);
  return {
    ...unsigned,
    s: sig.toString("base64url"),
  };
}

/**
 * Verifies an invite envelope's Ed25519 signature and optional expiration timestamp (ms).
 */
export function verifyInviteEnvelope(
  envelope: InviteEnvelope,
  options: {
    nowMs?: number | (() => number);
    checkExpiry?: boolean;
    logger?: ListenTogetherLogger;
  } = {},
): boolean {
  const logger = options.logger ?? noopLogger;
  const sig = decodeStrictBase64Url(envelope.s, 64);
  if (!sig) {
    logger.warn?.("Rejected invite envelope: malformed signature", {
      roomId: envelope.r,
    });
    return false;
  }
  const payload = canonicalInvitePayload(envelope);
  if (!verifyEd25519(payload, sig, envelope.k)) {
    logger.warn?.("Rejected invite envelope: signature mismatch", {
      roomId: envelope.r,
    });
    return false;
  }
  if (options.checkExpiry !== false && envelope.exp !== undefined) {
    const now =
      typeof options.nowMs === "function"
        ? options.nowMs()
        : (options.nowMs ?? Date.now());
    if (now > envelope.exp) {
      logger.warn?.("Rejected invite envelope: expired", {
        roomId: envelope.r,
        exp: envelope.exp,
        nowMs: now,
      });
      return false;
    }
  }
  return true;
}

/**
 * Generates an 8-character Crockford Base32 room passcode formatted as `XXXX-XXXX`.
 */
export function generatePasscode(): string {
  let raw = "";
  for (let i = 0; i < 8; i++) {
    raw += CROCKFORD_ALPHABET[crypto.randomInt(0, CROCKFORD_ALPHABET.length)];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/**
 * Derives `lookupId` and `passcodeAuthKey` using queued async `scrypt` (`N=32768, r=8, p=1`).
 */
export async function derivePasscodeLookup(
  code: string,
  opts: DerivePasscodeLookupOptions = {},
): Promise<PasscodeLookupResult> {
  const logger = opts.logger ?? noopLogger;

  const normalized = normalizePasscode(code, logger);
  if (!normalized) {
    logger.warn?.("Rejected invalid passcode format");
    throw new Error("Invalid passcode format");
  }
  const derived = await runQueuedScrypt(
    normalized,
    logger,
    opts.timeoutMs ?? DEFAULT_SCRYPT_TIMEOUT_MS,
    opts.scryptFn ?? crypto.scrypt,
  );
  return {
    lookupId: derived.subarray(0, 16).toString("base64url"),
    passcodeAuthKey: Buffer.from(derived.subarray(16, 48)),
  };
}

export type HostHandshakeOptions = {
  roomId: string;
  lookupId: string;
  epoch: number;
  roomSalt: Buffer;
  hostKeypair: Ed25519Keypair;
  roomInviteToken?: Buffer;
  roomTokenEpoch?: number;
  passcodeAuthKey?: Buffer;
  isTrustedFriend?: (clientIdentityPubB64: string) => boolean;
  authGuard?: HostAuthGuard;
  peerRateKey?: string;
  logger?: ListenTogetherLogger;
};

export type HostHandshakeSession = {
  receiveClientHello(hello: ClientHello): HostHello;
  verifyClientAuth(auth: ClientAuth): {
    serverAuth: ServerAuth;
    session: LinkSession;
    clientIdentityPubB64: string;
    authMode: AuthMode;
  };
};

/**
 * Creates a Host-side ephemeral X25519 + mutual transcript-bound handshake state machine.
 */
export function createHostHandshake(
  options: HostHandshakeOptions,
): HostHandshakeSession {
  const logger = options.logger ?? noopLogger;
  let guestEphPub: Buffer | null = null;
  let hostEphPriv: KeyObject | null = null;
  let hostEphPub: Buffer | null = null;
  let connNonce: Buffer | null = null;
  let completed = false;

  return {
    receiveClientHello(hello: ClientHello): HostHello {
      if (guestEphPub !== null || completed) {
        logger.warn?.("Host handshake rejected CLIENT_HELLO: invalid state", {
          roomId: options.roomId,
        });
        throw new HandshakeError(
          "INVALID_STATE",
          "ClientHello already received",
        );
      }
      if (hello.type !== "CLIENT_HELLO") {
        logger.warn?.("Host handshake rejected CLIENT_HELLO: malformed type", {
          roomId: options.roomId,
        });
        throw new HandshakeError("MALFORMED", "Expected CLIENT_HELLO");
      }
      const parsedGuestPub = decodeStrictBase64Url(hello.guestEphPubB64, 32);
      if (!parsedGuestPub) {
        logger.warn?.(
          "Host handshake rejected CLIENT_HELLO: invalid guest ephemeral key",
          { roomId: options.roomId },
        );
        throw new HandshakeError("MALFORMED", "Invalid guest ephemeral key");
      }

      const eph = crypto.generateKeyPairSync("x25519");
      const rawHostEphPub = rawKeyFromSpki(eph.publicKey, X25519_SPKI_PREFIX);
      const nonce = crypto.randomBytes(32);

      const sigPayload = buildEphemeralSignaturePayload({
        roomId: options.roomId,
        epoch: options.epoch,
        connNonce: nonce,
        hostEphPub: rawHostEphPub,
      });
      const sig = signEd25519(sigPayload, options.hostKeypair.privateKey);

      guestEphPub = parsedGuestPub;
      hostEphPriv = eph.privateKey;
      hostEphPub = rawHostEphPub;
      connNonce = nonce;

      logger.debug?.("Host handshake issued HOST_HELLO", {
        roomId: options.roomId,
        lookupId: options.lookupId,
        epoch: options.epoch,
      });

      return {
        type: "HOST_HELLO",
        roomId: options.roomId,
        lookupId: options.lookupId,
        epoch: options.epoch,
        connNonceB64: nonce.toString("base64url"),
        roomSaltB64: options.roomSalt.toString("base64url"),
        hostEphPubB64: rawHostEphPub.toString("base64url"),
        hostIdentityPubB64: options.hostKeypair.publicKeyB64,
        hostEphSigB64: sig.toString("base64url"),
      };
    },

    verifyClientAuth(auth: ClientAuth) {
      if (
        !guestEphPub ||
        !hostEphPriv ||
        !hostEphPub ||
        !connNonce ||
        completed
      ) {
        logger.warn?.("Host handshake rejected CLIENT_AUTH: invalid state", {
          roomId: options.roomId,
        });
        throw new HandshakeError("INVALID_STATE", "HostHello not issued yet");
      }
      if (auth.type !== "CLIENT_AUTH") {
        logger.warn?.("Host handshake rejected CLIENT_AUTH: malformed type", {
          roomId: options.roomId,
        });
        throw new HandshakeError("MALFORMED", "Expected CLIENT_AUTH");
      }

      const guard = options.authGuard;
      const rateKey = options.peerRateKey ?? auth.clientIdentityPubB64;

      if (guard?.isRateLimited(rateKey)) {
        logger.warn?.(
          "Host handshake rejected CLIENT_AUTH: peer rate limited",
          {
            roomId: options.roomId,
            peerRateKey: rateKey,
            authMode: auth.authMode,
          },
        );
        throw new HandshakeError(
          "RATE_LIMITED",
          "Peer temporarily rate limited",
        );
      }

      const clientPub = decodeStrictBase64Url(auth.clientIdentityPubB64, 32);
      const clientProof = decodeStrictBase64Url(auth.clientProofB64, 32);
      if (!clientPub || !clientProof) {
        logger.warn?.("Host handshake rejected CLIENT_AUTH: malformed fields", {
          roomId: options.roomId,
          authMode: auth.authMode,
        });
        throw new HandshakeError("MALFORMED", "Malformed client auth fields");
      }

      if (guard?.isBanned(auth.clientIdentityPubB64)) {
        logger.warn?.("Host handshake rejected CLIENT_AUTH: peer banned", {
          roomId: options.roomId,
          peerKey: auth.clientIdentityPubB64,
        });
        throw new HandshakeError("BANNED", "Peer identity is banned from room");
      }

      let authSecret: Buffer;
      if (auth.authMode === "token") {
        if (!options.roomInviteToken) {
          logger.warn?.(
            "Host handshake rejected CLIENT_AUTH: token auth unavailable",
            { roomId: options.roomId },
          );
          throw new HandshakeError(
            "AUTH_FAILED",
            "Invite token auth unavailable",
          );
        }
        if (
          options.roomTokenEpoch !== undefined &&
          auth.tokenEpoch !== options.roomTokenEpoch
        ) {
          guard?.recordFailure(rateKey, "token");
          logger.warn?.(
            "Host handshake rejected CLIENT_AUTH: token epoch mismatch",
            {
              roomId: options.roomId,
              expectedTokenEpoch: options.roomTokenEpoch,
              actualTokenEpoch: auth.tokenEpoch,
            },
          );
          throw new HandshakeError(
            "TOKEN_EPOCH_MISMATCH",
            "Invite token epoch mismatch",
          );
        }
        authSecret = options.roomInviteToken;
      } else if (auth.authMode === "passcode") {
        if (guard?.isPasscodePaused()) {
          logger.warn?.(
            "Host handshake rejected CLIENT_AUTH: passcode joins paused",
            { roomId: options.roomId, peerRateKey: rateKey },
          );
          throw new HandshakeError(
            "PASSCODE_PAUSED",
            "Passcode joins paused after repeated failures",
          );
        }
        if (!options.passcodeAuthKey) {
          logger.warn?.(
            "Host handshake rejected CLIENT_AUTH: passcode auth unavailable",
            { roomId: options.roomId },
          );
          throw new HandshakeError("AUTH_FAILED", "Passcode auth unavailable");
        }
        authSecret = options.passcodeAuthKey;
      } else if (auth.authMode === "friend") {
        if (!options.isTrustedFriend?.(auth.clientIdentityPubB64)) {
          guard?.recordFailure(rateKey, "friend");
          logger.warn?.(
            "Host handshake rejected CLIENT_AUTH: peer not in friends list",
            {
              roomId: options.roomId,
              peerKey: auth.clientIdentityPubB64,
            },
          );
          throw new HandshakeError("AUTH_FAILED", "Not in host friends list");
        }
        authSecret = Buffer.from(options.hostKeypair.publicKeyB64, "utf8");
      } else {
        logger.warn?.("Host handshake rejected CLIENT_AUTH: unsupported mode", {
          roomId: options.roomId,
        });
        throw new HandshakeError("MALFORMED", "Unsupported authMode");
      }

      let guestKeyObj: KeyObject;
      let ecdhShared: Buffer;
      try {
        guestKeyObj = spkiKeyFromRaw(guestEphPub, X25519_SPKI_PREFIX);
        ecdhShared = crypto.diffieHellman({
          privateKey: hostEphPriv,
          publicKey: guestKeyObj,
        });
      } catch {
        logger.warn?.(
          "Host handshake rejected CLIENT_AUTH: invalid guest X25519 key",
          { roomId: options.roomId },
        );
        throw new HandshakeError("MALFORMED", "Invalid guest X25519 key");
      }

      const transcriptHash = computeTranscriptHash({
        roomId: options.roomId,
        lookupId: options.lookupId,
        hostEphPub,
        guestEphPub,
        connNonce,
        roomSalt: options.roomSalt,
      });

      const authKey = deriveHkdfKey(
        ecdhShared,
        authSecret,
        transcriptHash,
        AUTH_HKDF_INFO,
      );
      const expectedClientProof = computeHmacProof(
        authKey,
        "client",
        transcriptHash,
      );

      if (!crypto.timingSafeEqual(expectedClientProof, clientProof)) {
        guard?.recordFailure(rateKey, auth.authMode);
        logger.warn?.(
          "Host handshake rejected CLIENT_AUTH: clientProof mismatch",
          {
            roomId: options.roomId,
            authMode: auth.authMode,
            peerRateKey: rateKey,
          },
        );
        throw new HandshakeError(
          "AUTH_FAILED",
          "Client proof verification failed",
        );
      }

      guard?.recordSuccess(rateKey);
      const serverProof = computeHmacProof(authKey, "server", transcriptHash);
      const session = createLinkSession({
        role: "host",
        roomId: options.roomId,
        epoch: options.epoch,
        connNonce,
        ecdhShared,
        authSecret,
        transcriptHash,
      });
      completed = true;

      logger.info?.("Host handshake authenticated peer", {
        roomId: options.roomId,
        epoch: options.epoch,
        authMode: auth.authMode,
      });

      return {
        serverAuth: {
          type: "SERVER_AUTH" as const,
          serverProofB64: serverProof.toString("base64url"),
        },
        session,
        clientIdentityPubB64: auth.clientIdentityPubB64,
        authMode: auth.authMode,
      };
    },
  };
}

export type GuestHandshakeOptions = {
  guestKeypair: Ed25519Keypair;
  expectedRoomId?: string;
  expectedLookupId?: string;
  expectedHostPubKeyB64?: string;
  authMode: AuthMode;
  authSecret: Buffer;
  tokenEpoch?: number;
  logger?: ListenTogetherLogger;
};

export type GuestHandshakeSession = {
  createClientHello(): ClientHello;
  receiveHostHello(hello: HostHello): ClientAuth;
  verifyServerAuth(serverAuth: ServerAuth): LinkSession;
};

/**
 * Creates a Guest-side ephemeral X25519 + mutual transcript-bound handshake state machine.
 */
export function createGuestHandshake(
  options: GuestHandshakeOptions,
): GuestHandshakeSession {
  const logger = options.logger ?? noopLogger;
  let guestEphPriv: KeyObject | null = null;
  let guestEphPub: Buffer | null = null;
  let pendingAuthKey: Buffer | null = null;
  let pendingTranscriptHash: Buffer | null = null;
  let pendingSessionParams: {
    roomId: string;
    epoch: number;
    connNonce: Buffer;
    ecdhShared: Buffer;
  } | null = null;
  let completed = false;

  return {
    createClientHello(): ClientHello {
      if (guestEphPriv !== null || completed) {
        logger.warn?.(
          "Guest handshake rejected createClientHello: invalid state",
        );
        throw new HandshakeError(
          "INVALID_STATE",
          "ClientHello already created",
        );
      }
      const eph = crypto.generateKeyPairSync("x25519");
      guestEphPriv = eph.privateKey;
      guestEphPub = rawKeyFromSpki(eph.publicKey, X25519_SPKI_PREFIX);
      return {
        type: "CLIENT_HELLO",
        guestEphPubB64: guestEphPub.toString("base64url"),
      };
    },

    receiveHostHello(hello: HostHello): ClientAuth {
      if (!guestEphPriv || !guestEphPub || pendingAuthKey || completed) {
        logger.warn?.("Guest handshake rejected HOST_HELLO: invalid state", {
          roomId: hello?.roomId,
        });
        throw new HandshakeError(
          "INVALID_STATE",
          "Unexpected HOST_HELLO state",
        );
      }
      if (hello.type !== "HOST_HELLO") {
        logger.warn?.("Guest handshake rejected HOST_HELLO: malformed type");
        throw new HandshakeError("MALFORMED", "Expected HOST_HELLO");
      }
      if (
        options.expectedRoomId !== undefined &&
        hello.roomId !== options.expectedRoomId
      ) {
        logger.warn?.("Guest handshake rejected HOST_HELLO: roomId mismatch", {
          expectedRoomId: options.expectedRoomId,
          actualRoomId: hello.roomId,
        });
        throw new HandshakeError("ROOM_MISMATCH", "Host roomId mismatch");
      }
      if (
        options.expectedLookupId !== undefined &&
        hello.lookupId !== options.expectedLookupId
      ) {
        logger.warn?.(
          "Guest handshake rejected HOST_HELLO: lookupId mismatch",
          {
            expectedLookupId: options.expectedLookupId,
            actualLookupId: hello.lookupId,
          },
        );
        throw new HandshakeError("ROOM_MISMATCH", "Host lookupId mismatch");
      }
      if (
        options.expectedHostPubKeyB64 !== undefined &&
        hello.hostIdentityPubB64 !== options.expectedHostPubKeyB64
      ) {
        logger.warn?.(
          "Guest handshake rejected HOST_HELLO: host identity key mismatch",
          { roomId: hello.roomId },
        );
        throw new HandshakeError(
          "HOST_KEY_MISMATCH",
          "Host identity public key mismatch",
        );
      }
      if (!Number.isInteger(hello.epoch) || hello.epoch < 0) {
        logger.warn?.("Guest handshake rejected HOST_HELLO: invalid epoch", {
          roomId: hello.roomId,
          epoch: hello.epoch,
        });
        throw new HandshakeError("MALFORMED", "Invalid epoch in HOST_HELLO");
      }

      const connNonce = decodeStrictBase64Url(hello.connNonceB64, 32);
      const hostEphPub = decodeStrictBase64Url(hello.hostEphPubB64, 32);
      const hostSig = decodeStrictBase64Url(hello.hostEphSigB64, 64);
      const roomSalt =
        hello.roomSaltB64.length > 0 && BASE64URL_RE.test(hello.roomSaltB64)
          ? Buffer.from(hello.roomSaltB64, "base64url")
          : null;

      if (!connNonce || !hostEphPub || !hostSig || !roomSalt) {
        logger.warn?.("Guest handshake rejected HOST_HELLO: malformed fields", {
          roomId: hello.roomId,
        });
        throw new HandshakeError("MALFORMED", "Malformed HOST_HELLO fields");
      }

      const sigPayload = buildEphemeralSignaturePayload({
        roomId: hello.roomId,
        epoch: hello.epoch,
        connNonce,
        hostEphPub,
      });

      const verifyingKeyB64 =
        options.expectedHostPubKeyB64 ?? hello.hostIdentityPubB64;
      if (!verifyEd25519(sigPayload, hostSig, verifyingKeyB64)) {
        logger.warn?.(
          "Guest handshake rejected HOST_HELLO: invalid host ephemeral signature",
          { roomId: hello.roomId },
        );
        throw new HandshakeError(
          "INVALID_SIGNATURE",
          "Invalid Host ephemeral signature",
        );
      }

      let hostKeyObj: KeyObject;
      let ecdhShared: Buffer;
      try {
        hostKeyObj = spkiKeyFromRaw(hostEphPub, X25519_SPKI_PREFIX);
        ecdhShared = crypto.diffieHellman({
          privateKey: guestEphPriv,
          publicKey: hostKeyObj,
        });
      } catch {
        logger.warn?.(
          "Guest handshake rejected HOST_HELLO: invalid host X25519 key",
          { roomId: hello.roomId },
        );
        throw new HandshakeError("MALFORMED", "Invalid host X25519 key");
      }

      const transcriptHash = computeTranscriptHash({
        roomId: hello.roomId,
        lookupId: hello.lookupId,
        hostEphPub,
        guestEphPub,
        connNonce,
        roomSalt,
      });

      const authKey = deriveHkdfKey(
        ecdhShared,
        options.authSecret,
        transcriptHash,
        AUTH_HKDF_INFO,
      );
      const clientProof = computeHmacProof(authKey, "client", transcriptHash);

      pendingAuthKey = authKey;
      pendingTranscriptHash = transcriptHash;
      pendingSessionParams = {
        roomId: hello.roomId,
        epoch: hello.epoch,
        connNonce,
        ecdhShared,
      };

      logger.debug?.(
        "Guest handshake verified HOST_HELLO and generated CLIENT_AUTH",
        {
          roomId: hello.roomId,
          epoch: hello.epoch,
          authMode: options.authMode,
        },
      );

      const msg: ClientAuth = {
        type: "CLIENT_AUTH",
        clientIdentityPubB64: options.guestKeypair.publicKeyB64,
        clientProofB64: clientProof.toString("base64url"),
        authMode: options.authMode,
      };
      if (options.authMode === "token" && options.tokenEpoch !== undefined) {
        msg.tokenEpoch = options.tokenEpoch;
      }
      return msg;
    },

    verifyServerAuth(serverAuth: ServerAuth): LinkSession {
      if (
        !pendingAuthKey ||
        !pendingTranscriptHash ||
        !pendingSessionParams ||
        completed
      ) {
        logger.warn?.("Guest handshake rejected SERVER_AUTH: invalid state");
        throw new HandshakeError(
          "INVALID_STATE",
          "ClientAuth has not been sent yet",
        );
      }
      if (serverAuth.type !== "SERVER_AUTH") {
        logger.warn?.("Guest handshake rejected SERVER_AUTH: malformed type", {
          roomId: pendingSessionParams.roomId,
        });
        throw new HandshakeError("MALFORMED", "Expected SERVER_AUTH");
      }

      const serverProof = decodeStrictBase64Url(serverAuth.serverProofB64, 32);
      if (!serverProof) {
        logger.warn?.(
          "Guest handshake rejected SERVER_AUTH: malformed serverProof",
          { roomId: pendingSessionParams.roomId },
        );
        throw new HandshakeError("MALFORMED", "Malformed serverProof");
      }

      const expectedServerProof = computeHmacProof(
        pendingAuthKey,
        "server",
        pendingTranscriptHash,
      );
      if (!crypto.timingSafeEqual(expectedServerProof, serverProof)) {
        logger.warn?.(
          "Guest handshake rejected SERVER_AUTH: serverProof mismatch",
          {
            roomId: pendingSessionParams.roomId,
            authMode: options.authMode,
          },
        );
        throw new HandshakeError(
          "AUTH_FAILED",
          "Server proof verification failed",
        );
      }

      const session = createLinkSession({
        role: "guest",
        roomId: pendingSessionParams.roomId,
        epoch: pendingSessionParams.epoch,
        connNonce: pendingSessionParams.connNonce,
        ecdhShared: pendingSessionParams.ecdhShared,
        authSecret: options.authSecret,
        transcriptHash: pendingTranscriptHash,
      });
      completed = true;
      logger.info?.("Guest handshake verified serverAuth", {
        roomId: pendingSessionParams.roomId,
        epoch: pendingSessionParams.epoch,
        authMode: options.authMode,
      });
      return session;
    },
  };
}

export type CreateLinkSessionParams = {
  role: LinkRole;
  roomId: string;
  epoch: number;
  connNonce: Buffer;
  ecdhShared: Buffer;
  authSecret: Buffer;
  transcriptHash: Buffer;
};

/**
 * Derives directional AES-256-GCM keys (`h2g` / `g2h`) and initializes replay/rekey counters.
 */
export function createLinkSession(
  params: CreateLinkSessionParams,
): LinkSession {
  if (params.connNonce.length !== 32) {
    throw new Error("connNonce must be 32 bytes");
  }
  if (!Number.isInteger(params.epoch) || params.epoch < 0) {
    throw new Error("epoch must be a non-negative integer");
  }

  const h2gKey = deriveHkdfKey(
    params.ecdhShared,
    params.authSecret,
    params.transcriptHash,
    H2G_HKDF_INFO,
  );
  const g2hKey = deriveHkdfKey(
    params.ecdhShared,
    params.authSecret,
    params.transcriptHash,
    G2H_HKDF_INFO,
  );

  const isHost = params.role === "host";
  return {
    role: params.role,
    roomId: params.roomId,
    epoch: params.epoch,
    connNonce: Buffer.from(params.connNonce),
    txKey: isHost ? h2gKey : g2hKey,
    rxKey: isHost ? g2hKey : h2gKey,
    txDirection: isHost ? "h2g" : "g2h",
    rxDirection: isHost ? "g2h" : "h2g",
    txCounter: 0n,
    lastRxCounter: -1n,
  };
}

/**
 * Encrypts a plaintext payload with AES-256-GCM using directional keys, 96-bit nonce, and AAD.
 */
export function encryptFrame(
  session: LinkSession,
  plaintext: Buffer | Uint8Array | string,
  logger: ListenTogetherLogger = noopLogger,
): Buffer {
  const counter = session.txCounter;
  if (counter >= REKEY_COUNTER_LIMIT) {
    logger.warn?.("Link session TX counter reached REKEY_COUNTER_LIMIT", {
      roomId: session.roomId,
      epoch: session.epoch,
      role: session.role,
      txCounter: counter.toString(),
    });
    throw new Error("Link session rekey required: TX counter exhausted");
  }

  const data =
    typeof plaintext === "string"
      ? Buffer.from(plaintext, "utf8")
      : Buffer.isBuffer(plaintext)
        ? plaintext
        : Buffer.from(plaintext);

  const nonce = buildNonce(session.epoch, counter);
  const aad = buildFrameAad({
    roomId: session.roomId,
    epoch: session.epoch,
    connNonce: session.connNonce,
    direction: session.txDirection,
    counter,
  });

  const cipher = crypto.createCipheriv("aes-256-gcm", session.txKey, nonce);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();

  session.txCounter = counter + 1n;

  const header = Buffer.allocUnsafe(FRAME_HEADER_BYTES);
  header.writeUInt8(FRAME_VERSION, 0);
  header.writeBigUInt64BE(counter, 1);
  tag.copy(header, 9);

  return Buffer.concat([header, encrypted]);
}

/**
 * Decrypts and authenticates an AES-256-GCM frame, enforcing strict monotonic `counter > lastRxCounter`.
 */
export function decryptFrame(
  session: LinkSession,
  frame: Buffer | Uint8Array,
  logger: ListenTogetherLogger = noopLogger,
): Buffer {
  const buf = Buffer.isBuffer(frame) ? frame : Buffer.from(frame);
  if (buf.length < FRAME_HEADER_BYTES) {
    logger.warn?.("Rejected encrypted frame: too short", {
      roomId: session.roomId,
      epoch: session.epoch,
      length: buf.length,
    });
    throw new Error("Encrypted frame too short");
  }
  const version = buf.readUInt8(0);
  if (version !== FRAME_VERSION) {
    logger.warn?.("Rejected encrypted frame: unsupported version", {
      roomId: session.roomId,
      epoch: session.epoch,
      version,
    });
    throw new Error(`Unsupported frame version: ${version}`);
  }

  const counter = buf.readBigUInt64BE(1);
  if (counter >= REKEY_COUNTER_LIMIT) {
    logger.warn?.("Link session RX counter reached REKEY_COUNTER_LIMIT", {
      roomId: session.roomId,
      epoch: session.epoch,
      role: session.role,
      counter: counter.toString(),
    });
    throw new Error("Link session rekey required: RX counter limit reached");
  }
  if (counter <= session.lastRxCounter) {
    logger.warn?.("Rejected replay or out-of-order frame", {
      roomId: session.roomId,
      epoch: session.epoch,
      role: session.role,
      counter: counter.toString(),
      lastRxCounter: session.lastRxCounter.toString(),
    });
    throw new Error("Replay or out-of-order frame rejected");
  }

  const tag = buf.subarray(9, FRAME_HEADER_BYTES);
  const ciphertext = buf.subarray(FRAME_HEADER_BYTES);
  const nonce = buildNonce(session.epoch, counter);
  const aad = buildFrameAad({
    roomId: session.roomId,
    epoch: session.epoch,
    connNonce: session.connNonce,
    direction: session.rxDirection,
    counter,
  });

  let plaintext: Buffer;
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      session.rxKey,
      nonce,
    );
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (err) {
    logger.warn?.("Rejected encrypted frame: AES-GCM authentication failed", {
      roomId: session.roomId,
      epoch: session.epoch,
      role: session.role,
      counter: counter.toString(),
    });
    throw err;
  }

  session.lastRxCounter = counter;
  return plaintext;
}
