import crypto from "crypto";
import { EventEmitter } from "events";
import log from "electron-log";

export interface PartyMember {
  socketId: string;
  displayName: string;
  joinedAt: number;
}

export interface PartyInfo {
  id: string;
  code: string;
  hostDisplayName: string;
  members: PartyMember[];
  createdAt: number;
}

interface FailedAttemptRecord {
  count: number;
  firstAttemptAt: number;
  blockedUntil: number | null;
}

/**
 * Manages a single listening party per companion server instance.
 *
 * Security model:
 * - Party creation requires a valid companion server auth token (verified at the IPC layer)
 * - Party joining requires the 8-character party code (shared out-of-band by the host)
 * - IP-based rate limiting blocks brute-force code guessing (10 failures = 10 min block)
 * - Party code uses an unambiguous character set (no 0/O/1/I/L) with ~1.1 trillion combinations
 * - Max 8 members per party
 * - Leader-only: guests receive state, they cannot send commands through the party
 *
 * Events emitted:
 * - "partyCreated" (PartyInfo) - A new party was created
 * - "partyDissolved" - The party was dissolved
 * - "memberJoined" (PartyMember) - A guest joined
 * - "memberLeft" (socketId: string) - A guest left
 */
export class ListeningPartyManager extends EventEmitter {
  private static readonly MAX_PARTY_SIZE = 8;
  private static readonly MAX_FAILED_ATTEMPTS = 10;
  private static readonly BLOCK_DURATION_MS = 10 * 60 * 1000;
  private static readonly CODE_LENGTH = 8;
  // Unambiguous character set: no 0/O, no 1/I/L
  private static readonly CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

  private partyId: string | null = null;
  private partyCode: string | null = null;
  private hostDisplayName: string | null = null;
  private createdAt: number | null = null;
  private guests: Map<string, PartyMember> = new Map();
  private failedAttempts: Map<string, FailedAttemptRecord> = new Map();

  createParty(hostDisplayName: string): { partyId: string; code: string } {
    if (this.partyId) {
      this.dissolve();
    }

    this.partyId = crypto.randomUUID();
    this.partyCode = this.generateCode();
    this.hostDisplayName = this.sanitizeDisplayName(hostDisplayName);
    this.createdAt = Date.now();
    this.guests.clear();

    log.info(`Listening party created: ${this.partyId}`);
    this.emit("partyCreated", this.getPartyInfo());
    return { partyId: this.partyId, code: this.partyCode };
  }

  addGuest(code: string, socketId: string, displayName: string, ip: string): PartyMember | null {
    if (this.isIpBlocked(ip)) {
      log.warn(`Blocked party join attempt from IP: ${ip}`);
      return null;
    }

    const normalizedCode = code.toUpperCase();
    if (
      normalizedCode.length !== ListeningPartyManager.CODE_LENGTH ||
      !this.partyId ||
      !this.partyCode ||
      !crypto.timingSafeEqual(Buffer.from(this.partyCode), Buffer.from(normalizedCode))
    ) {
      this.recordFailedAttempt(ip);
      return null;
    }

    if (this.guests.size + 1 >= ListeningPartyManager.MAX_PARTY_SIZE) {
      return null;
    }

    if (this.guests.has(socketId)) {
      return this.guests.get(socketId);
    }

    const member: PartyMember = {
      socketId,
      displayName: this.sanitizeDisplayName(displayName),
      joinedAt: Date.now()
    };

    this.guests.set(socketId, member);
    log.info(`Guest joined party ${this.partyId}: ${member.displayName}`);
    this.emit("memberJoined", member);
    return member;
  }

  removeGuest(socketId: string): void {
    if (!this.guests.has(socketId)) return;
    this.guests.delete(socketId);
    log.info(`Guest left party ${this.partyId}: ${socketId}`);
    this.emit("memberLeft", socketId);
  }

  dissolve(): void {
    if (this.partyId) {
      log.info(`Listening party dissolved: ${this.partyId}`);
    }
    this.partyId = null;
    this.partyCode = null;
    this.hostDisplayName = null;
    this.createdAt = null;
    this.guests.clear();
    this.emit("partyDissolved");
  }

  isActive(): boolean {
    return this.partyId !== null;
  }

  getPartyInfo(): PartyInfo | null {
    if (!this.partyId) return null;

    const members: PartyMember[] = [{ socketId: "host", displayName: this.hostDisplayName, joinedAt: this.createdAt }, ...Array.from(this.guests.values())];

    return {
      id: this.partyId,
      code: this.partyCode,
      hostDisplayName: this.hostDisplayName,
      members,
      createdAt: this.createdAt
    };
  }

  // --- Rate limiting / brute-force protection ---

  private isIpBlocked(ip: string): boolean {
    this.cleanExpiredBlocks();
    const record = this.failedAttempts.get(ip);
    if (!record) return false;
    return record.blockedUntil !== null && Date.now() < record.blockedUntil;
  }

  private recordFailedAttempt(ip: string): void {
    const record = this.failedAttempts.get(ip) || {
      count: 0,
      firstAttemptAt: Date.now(),
      blockedUntil: null
    };
    record.count++;

    if (record.count >= ListeningPartyManager.MAX_FAILED_ATTEMPTS) {
      record.blockedUntil = Date.now() + ListeningPartyManager.BLOCK_DURATION_MS;
      log.warn(`IP ${ip} blocked from party joins for ${ListeningPartyManager.BLOCK_DURATION_MS / 1000}s after ${record.count} failed attempts`);
    }

    this.failedAttempts.set(ip, record);
  }

  private cleanExpiredBlocks(): void {
    const now = Date.now();
    for (const [ip, record] of this.failedAttempts) {
      if (record.blockedUntil && now >= record.blockedUntil) {
        this.failedAttempts.delete(ip);
      }
    }
  }

  // --- Helpers ---

  private generateCode(): string {
    const chars = ListeningPartyManager.CODE_CHARS;
    let code = "";
    for (let i = 0; i < ListeningPartyManager.CODE_LENGTH; i++) {
      code += chars[crypto.randomInt(0, chars.length)];
    }
    return code;
  }

  private sanitizeDisplayName(name: string): string {
    return (
      name
        .replace(/[^\w\s\-_.]/g, "")
        .slice(0, 32)
        .trim() || "Guest"
    );
  }
}

const listeningPartyManager = new ListeningPartyManager();
export default listeningPartyManager;
