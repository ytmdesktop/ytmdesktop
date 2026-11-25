import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  createRelayServer,
  parseTrustProxyEnv,
  type RelayServerInstance,
} from "../index.js";
import {
  BlindRelayCore,
  type OutboundRelayMessage,
  type RelayLogger,
  type RelaySocket,
} from "../relay-core.js";

interface TestKeyPair {
  pubKeyB64: string;
  privateKey: KeyObject;
}

function makeEd25519KeyPair(): TestKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spkiDer = publicKey.export({ format: "der", type: "spki" });
  return {
    pubKeyB64: spkiDer.toString("base64url"),
    privateKey,
  };
}

function signChallenge(privateKey: KeyObject, challenge: string): string {
  return sign(null, Buffer.from(challenge, "utf8"), privateKey).toString(
    "base64url",
  );
}

class TestWsClient {
  readonly ws: WebSocket;
  private readonly queue: OutboundRelayMessage[] = [];
  private readonly waiters: Array<(msg: OutboundRelayMessage) => void> = [];
  readonly closedPromise: Promise<{ code: number; reason: string }>;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString("utf8")) as OutboundRelayMessage;
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter(msg);
      } else {
        this.queue.push(msg);
      }
    });
    this.closedPromise = new Promise((resolve) => {
      ws.on("close", (code, reason) => {
        resolve({ code, reason: reason.toString("utf8") });
      });
    });
  }

  static connect(
    url: string,
    headers?: Record<string, string>,
  ): Promise<TestWsClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { headers });
      const client = new TestWsClient(ws);
      ws.once("open", () => resolve(client));
      ws.once("error", (err) => reject(err));
    });
  }

  nextMessage(timeoutMs = 2000): Promise<OutboundRelayMessage> {
    const queued = this.queue.shift();
    if (queued) {
      return Promise.resolve(queued);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.indexOf(onMsg);
        if (idx >= 0) {
          this.waiters.splice(idx, 1);
        }
        reject(
          new Error(`Timed out waiting for WS message after ${timeoutMs}ms`),
        );
      }, timeoutMs);

      const onMsg = (msg: OutboundRelayMessage): void => {
        clearTimeout(timer);
        resolve(msg);
      };

      this.waiters.push(onMsg);
    });
  }

  send(payload: unknown): void {
    this.ws.send(JSON.stringify(payload));
  }

  close(): void {
    if (
      this.ws.readyState === WebSocket.OPEN ||
      this.ws.readyState === WebSocket.CONNECTING
    ) {
      this.ws.close();
    }
  }
}

describe("Standalone Blind Relay", () => {
  const servers: RelayServerInstance[] = [];
  const clients: TestWsClient[] = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      client.close();
    }
    for (const server of servers.splice(0)) {
      await server.close();
    }
  });

  async function startServer(
    opts: Parameters<typeof createRelayServer>[0] = {},
  ): Promise<{ server: RelayServerInstance; url: string }> {
    const server = await createRelayServer({
      port: 0,
      host: "127.0.0.1",
      logLevel: "silent",
      ...opts,
    });
    servers.push(server);
    const url = await server.start();
    return { server, url };
  }

  async function connectClient(
    url: string,
    headers?: Record<string, string>,
  ): Promise<TestWsClient> {
    const client = await TestWsClient.connect(url, headers);
    clients.push(client);
    return client;
  }

  async function createHostRoom(
    url: string,
    lookupId: string,
    hostKeys: TestKeyPair = makeEd25519KeyPair(),
    headers?: Record<string, string>,
  ): Promise<{ host: TestWsClient; hostKeys: TestKeyPair }> {
    const host = await connectClient(url, headers);
    const challengeMsg = await host.nextMessage();
    expect(challengeMsg.type).toBe("HOST_CHALLENGE");
    if (challengeMsg.type !== "HOST_CHALLENGE") {
      throw new Error("Expected HOST_CHALLENGE");
    }

    host.send({
      type: "HOST_CREATE",
      lookupId,
      hostPubKey: hostKeys.pubKeyB64,
      sig: signChallenge(hostKeys.privateKey, challengeMsg.challenge),
    });

    const hostAck = await host.nextMessage();
    expect(hostAck).toEqual({
      type: "RELAY_PEER_ADMITTED",
      relayPeerId: "host",
    });
    return { host, hostKeys };
  }

  async function joinGuest(
    url: string,
    lookupId: string,
    host: TestWsClient,
    options: { admit?: boolean; headers?: Record<string, string> } = {},
  ): Promise<{ guest: TestWsClient; peerId: string }> {
    const guest = await connectClient(url, options.headers);
    const challenge = await guest.nextMessage();
    expect(challenge.type).toBe("HOST_CHALLENGE");

    guest.send({ type: "GUEST_JOIN", lookupId });

    const guestJoinAck = await guest.nextMessage();
    const hostJoinNotif = await host.nextMessage();
    expect(guestJoinAck.type).toBe("GUEST_JOIN");
    expect(hostJoinNotif).toEqual(guestJoinAck);

    if (guestJoinAck.type !== "GUEST_JOIN" || !guestJoinAck.relayPeerId) {
      throw new Error("Expected GUEST_JOIN with relayPeerId");
    }
    const peerId = guestJoinAck.relayPeerId;

    if (options.admit) {
      host.send({
        type: "RELAY_PEER_ADMITTED",
        relayPeerId: peerId,
      });
      const guestAdmitted = await guest.nextMessage();
      expect(guestAdmitted).toEqual({
        type: "RELAY_PEER_ADMITTED",
        relayPeerId: peerId,
      });
    }

    return { guest, peerId };
  }

  it("handles HOST_CREATE, GUEST_JOIN, RELAY_PEER_ADMITTED, RELAY_FRAME, and /health", async () => {
    const { url } = await startServer();
    const { host } = await createHostRoom(url, "room-alpha");

    const httpBase = url.replace(/^ws:/, "http:");
    const healthRes = await fetch(`${httpBase}/health`);
    expect(healthRes.status).toBe(200);
    const healthJson = (await healthRes.json()) as {
      status: string;
      rooms: number;
    };
    expect(healthJson.status).toBe("ok");
    expect(healthJson.rooms).toBe(1);

    const guest = await connectClient(url);
    const guestChallenge = await guest.nextMessage();
    expect(guestChallenge.type).toBe("HOST_CHALLENGE");

    guest.send({ type: "GUEST_JOIN", lookupId: "room-alpha" });

    const guestJoinAck = await guest.nextMessage();
    const hostJoinNotif = await host.nextMessage();
    expect(guestJoinAck.type).toBe("GUEST_JOIN");
    expect(hostJoinNotif).toEqual(guestJoinAck);

    if (guestJoinAck.type !== "GUEST_JOIN" || !guestJoinAck.relayPeerId) {
      throw new Error("Expected GUEST_JOIN with relayPeerId");
    }
    const peerId = guestJoinAck.relayPeerId;

    const helloB64 = Buffer.from("encrypted-hello").toString("base64");
    guest.send({
      type: "RELAY_FRAME",
      targetPeerId: "host",
      payloadB64: helloB64,
    });

    const hostReceivedHello = await host.nextMessage();
    expect(hostReceivedHello).toEqual({
      type: "RELAY_FRAME",
      targetPeerId: "host",
      fromPeerId: peerId,
      payloadB64: helloB64,
    });

    host.send({
      type: "RELAY_PEER_ADMITTED",
      relayPeerId: peerId,
    });

    const guestAdmitted = await guest.nextMessage();
    expect(guestAdmitted).toEqual({
      type: "RELAY_PEER_ADMITTED",
      relayPeerId: peerId,
    });

    const syncB64 = Buffer.from("encrypted-sync-anchor").toString("base64");
    host.send({
      type: "RELAY_FRAME",
      targetPeerId: peerId,
      payloadB64: syncB64,
    });

    const guestReceivedSync = await guest.nextMessage();
    expect(guestReceivedSync).toEqual({
      type: "RELAY_FRAME",
      targetPeerId: peerId,
      fromPeerId: "host",
      payloadB64: syncB64,
    });
  });

  it("enforces Ed25519 challenge-response on HOST_RESUME, prevents hijacking, and expires grace window", async () => {
    const { url } = await startServer({ hostGraceMs: 5000, rateLimitMax: 20 });
    const hostKeys = makeEd25519KeyPair();
    const attackerKeys = makeEd25519KeyPair();

    const { host } = await createHostRoom(url, "room-resume", hostKeys);
    const { guest, peerId } = await joinGuest(url, "room-resume", host, {
      admit: true,
    });

    // Host drops connection, entering grace window.
    host.close();
    await host.closedPromise;

    // Guest attempting to send frame while host is offline gets HOST_OFFLINE
    guest.send({
      type: "RELAY_FRAME",
      targetPeerId: "host",
      payloadB64: Buffer.from("while-offline").toString("base64"),
    });
    const offlineErr = await guest.nextMessage();
    expect(offlineErr.type).toBe("RELAY_ERROR");
    if (offlineErr.type === "RELAY_ERROR") {
      expect(offlineErr.code).toBe("HOST_OFFLINE");
    }

    // Attacker tries HOST_RESUME with their own keypair.
    const attackerWrongKey = await connectClient(url);
    const attCh1 = await attackerWrongKey.nextMessage();
    if (attCh1.type !== "HOST_CHALLENGE") {
      throw new Error("Expected challenge");
    }
    attackerWrongKey.send({
      type: "HOST_RESUME",
      lookupId: "room-resume",
      hostPubKey: attackerKeys.pubKeyB64,
      challengeSig: signChallenge(attackerKeys.privateKey, attCh1.challenge),
    });
    const err1 = await attackerWrongKey.nextMessage();
    expect(err1.type).toBe("RELAY_ERROR");
    if (err1.type === "RELAY_ERROR") {
      expect(err1.code).toBe("FORBIDDEN");
    }
    expect((await attackerWrongKey.closedPromise).code).toBe(4003);

    // Attacker tries HOST_RESUME with host's public key but wrong signature.
    const attackerBadSig = await connectClient(url);
    const attCh2 = await attackerBadSig.nextMessage();
    if (attCh2.type !== "HOST_CHALLENGE") {
      throw new Error("Expected challenge");
    }
    attackerBadSig.send({
      type: "HOST_RESUME",
      lookupId: "room-resume",
      hostPubKey: hostKeys.pubKeyB64,
      challengeSig: signChallenge(attackerKeys.privateKey, attCh2.challenge),
    });
    const err2 = await attackerBadSig.nextMessage();
    expect(err2.type).toBe("RELAY_ERROR");
    if (err2.type === "RELAY_ERROR") {
      expect(err2.code).toBe("INVALID_SIGNATURE");
    }
    expect((await attackerBadSig.closedPromise).code).toBe(4001);

    // Legitimate host resumes with valid challenge signature.
    const resumedHost = await connectClient(url);
    const resumeCh = await resumedHost.nextMessage();
    if (resumeCh.type !== "HOST_CHALLENGE") {
      throw new Error("Expected challenge");
    }
    resumedHost.send({
      type: "HOST_RESUME",
      lookupId: "room-resume",
      hostPubKey: hostKeys.pubKeyB64,
      challengeSig: signChallenge(hostKeys.privateKey, resumeCh.challenge),
    });
    expect(await resumedHost.nextMessage()).toEqual({
      type: "RELAY_PEER_ADMITTED",
      relayPeerId: "host",
    });

    const resumedFrame = Buffer.from("after-resume").toString("base64");
    guest.send({
      type: "RELAY_FRAME",
      targetPeerId: "host",
      payloadB64: resumedFrame,
    });
    expect(await resumedHost.nextMessage()).toEqual({
      type: "RELAY_FRAME",
      targetPeerId: "host",
      fromPeerId: peerId,
      payloadB64: resumedFrame,
    });

    // Active host replacement via HOST_RESUME closes prior host with 4000
    const replacementHost = await connectClient(url);
    const repCh = await replacementHost.nextMessage();
    if (repCh.type !== "HOST_CHALLENGE") {
      throw new Error("Expected challenge");
    }
    replacementHost.send({
      type: "HOST_RESUME",
      lookupId: "room-resume",
      hostPubKey: hostKeys.pubKeyB64,
      challengeSig: signChallenge(hostKeys.privateKey, repCh.challenge),
    });
    expect(await replacementHost.nextMessage()).toEqual({
      type: "RELAY_PEER_ADMITTED",
      relayPeerId: "host",
    });
    expect((await resumedHost.closedPromise).code).toBe(4000);

    // HOST_RESUME for nonexistent room fails with ROOM_NOT_FOUND
    const missingHost = await connectClient(url);
    const missCh = await missingHost.nextMessage();
    if (missCh.type !== "HOST_CHALLENGE") {
      throw new Error("Expected challenge");
    }
    missingHost.send({
      type: "HOST_RESUME",
      lookupId: "room-missing",
      hostPubKey: hostKeys.pubKeyB64,
      challengeSig: signChallenge(hostKeys.privateKey, missCh.challenge),
    });
    const missErr = await missingHost.nextMessage();
    expect(missErr.type).toBe("RELAY_ERROR");
    if (missErr.type === "RELAY_ERROR") {
      expect(missErr.code).toBe("ROOM_NOT_FOUND");
    }
    expect((await missingHost.closedPromise).code).toBe(4004);

    // Grace window expiry destroys room and notifies guest with HOST_TIMEOUT
    const { url: shortGraceUrl } = await startServer({
      hostGraceMs: 60,
      rateLimitMax: 20,
    });
    const { host: shortHost } = await createHostRoom(
      shortGraceUrl,
      "room-short-grace",
      hostKeys,
    );
    const { guest: shortGuest } = await joinGuest(
      shortGraceUrl,
      "room-short-grace",
      shortHost,
    );

    shortHost.close();
    await shortHost.closedPromise;
    const graceErr = await shortGuest.nextMessage(1000);
    expect(graceErr.type).toBe("RELAY_ERROR");
    if (graceErr.type === "RELAY_ERROR") {
      expect(graceErr.code).toBe("HOST_TIMEOUT");
    }
    expect((await shortGuest.closedPromise).code).toBe(4002);
  });

  it("enforces max 8 admitted peers while ignoring pending sockets, and frees slots on disconnect", async () => {
    const { server, url } = await startServer({
      rateLimitMax: 50,
      maxPendingPerRoom: 10,
    });
    const { host } = await createHostRoom(url, "room-cap");

    // Connect 10 pending guests first.
    const joinedGuests: Array<{ client: TestWsClient; peerId: string }> = [];
    for (let i = 0; i < 10; i += 1) {
      const { guest, peerId } = await joinGuest(url, "room-cap", host);
      joinedGuests.push({ client: guest, peerId });
    }

    // 11th pending guest hits maxPendingPerRoom.
    const tooManyPending = await connectClient(url);
    await tooManyPending.nextMessage();
    tooManyPending.send({ type: "GUEST_JOIN", lookupId: "room-cap" });
    const pendingCapErr = await tooManyPending.nextMessage();
    expect(pendingCapErr.type).toBe("RELAY_ERROR");
    if (pendingCapErr.type === "RELAY_ERROR") {
      expect(pendingCapErr.code).toBe("TOO_MANY_PENDING");
    }
    expect((await tooManyPending.closedPromise).code).toBe(4008);

    // Admit 7 guests.
    for (let i = 0; i < 7; i += 1) {
      const target = joinedGuests[i]!;
      host.send({
        type: "RELAY_PEER_ADMITTED",
        relayPeerId: target.peerId,
      });
      expect(await target.client.nextMessage()).toEqual({
        type: "RELAY_PEER_ADMITTED",
        relayPeerId: target.peerId,
      });
    }

    expect(server.relay.getRoomStats("room-cap")).toEqual({
      admittedCount: 7,
      pendingCount: 3,
      hostConnected: true,
    });

    // Attempting to admit an 8th guest must fail with ROOM_FULL.
    const eighth = joinedGuests[7]!;
    host.send({
      type: "RELAY_PEER_ADMITTED",
      relayPeerId: eighth.peerId,
    });
    const hostErr = await host.nextMessage();
    const guestErr = await eighth.client.nextMessage();
    expect(hostErr.type).toBe("RELAY_ERROR");
    expect(guestErr.type).toBe("RELAY_ERROR");
    if (guestErr.type === "RELAY_ERROR") {
      expect(guestErr.code).toBe("ROOM_FULL");
    }
    expect((await eighth.client.closedPromise).code).toBe(4008);

    // New GUEST_JOIN when 8 peers are already admitted is also rejected.
    const extra = await connectClient(url);
    await extra.nextMessage();
    extra.send({ type: "GUEST_JOIN", lookupId: "room-cap" });
    const extraErr = await extra.nextMessage();
    expect(extraErr.type).toBe("RELAY_ERROR");
    if (extraErr.type === "RELAY_ERROR") {
      expect(extraErr.code).toBe("ROOM_FULL");
    }
    expect((await extra.closedPromise).code).toBe(4008);

    // Disconnecting one admitted guest frees a slot so a remaining pending guest can be admitted!
    joinedGuests[0]!.client.close();
    await joinedGuests[0]!.client.closedPromise;
    const ninth = joinedGuests[8]!;
    host.send({
      type: "RELAY_PEER_ADMITTED",
      relayPeerId: ninth.peerId,
    });
    expect(await ninth.client.nextMessage()).toEqual({
      type: "RELAY_PEER_ADMITTED",
      relayPeerId: ninth.peerId,
    });
    expect(server.relay.getRoomStats("room-cap")?.admittedCount).toBe(7);
  });

  it("expires unauthenticated pending sockets after pendingTtlMs", async () => {
    const { server, url } = await startServer({ pendingTtlMs: 120 });
    const { host } = await createHostRoom(url, "room-ttl");
    await joinGuest(url, "room-ttl", host, { admit: true });
    const { guest: pendingGuest } = await joinGuest(url, "room-ttl", host);

    const ttlErr = await pendingGuest.nextMessage(1000);
    expect(ttlErr.type).toBe("RELAY_ERROR");
    if (ttlErr.type === "RELAY_ERROR") {
      expect(ttlErr.code).toBe("PENDING_TIMEOUT");
    }
    expect((await pendingGuest.closedPromise).code).toBe(4003);

    expect(server.relay.getRoomStats("room-ttl")).toEqual({
      admittedCount: 1,
      pendingCount: 0,
      hostConnected: true,
    });
  });

  it("cuts admitted and pending peers immediately on RELAY_DROP_PEER and rejects non-host drops", async () => {
    const { server, url } = await startServer();
    const { host } = await createHostRoom(url, "room-drop");
    const { guest, peerId: admittedPeerId } = await joinGuest(
      url,
      "room-drop",
      host,
      { admit: true },
    );

    // Pending peer cannot drop others
    const { guest: pendingGuest, peerId: pendingPeerId } = await joinGuest(
      url,
      "room-drop",
      host,
    );

    guest.send({
      type: "RELAY_DROP_PEER",
      relayPeerId: pendingPeerId,
    });
    const nonHostDropErr = await guest.nextMessage();
    expect(nonHostDropErr.type).toBe("RELAY_ERROR");
    if (nonHostDropErr.type === "RELAY_ERROR") {
      expect(nonHostDropErr.code).toBe("FORBIDDEN");
    }

    // Host drops admitted guest
    host.send({
      type: "RELAY_DROP_PEER",
      relayPeerId: admittedPeerId,
    });
    const droppedErr = await guest.nextMessage();
    expect(droppedErr.type).toBe("RELAY_ERROR");
    if (droppedErr.type === "RELAY_ERROR") {
      expect(droppedErr.code).toBe("DROPPED_BY_HOST");
    }
    expect((await guest.closedPromise).code).toBe(4005);
    expect(server.relay.getRoomStats("room-drop")?.admittedCount).toBe(0);

    // Host drops pending guest
    host.send({
      type: "RELAY_DROP_PEER",
      relayPeerId: pendingPeerId,
    });
    const pendingDroppedErr = await pendingGuest.nextMessage();
    expect(pendingDroppedErr.type).toBe("RELAY_ERROR");
    if (pendingDroppedErr.type === "RELAY_ERROR") {
      expect(pendingDroppedErr.code).toBe("DROPPED_BY_HOST");
    }
    expect((await pendingGuest.closedPromise).code).toBe(4005);
    expect(server.relay.getRoomStats("room-drop")?.pendingCount).toBe(0);

    host.send({
      type: "RELAY_FRAME",
      targetPeerId: admittedPeerId,
      payloadB64: Buffer.from("after-drop").toString("base64"),
    });
    const hostErr = await host.nextMessage();
    expect(hostErr.type).toBe("RELAY_ERROR");
    if (hostErr.type === "RELAY_ERROR") {
      expect(hostErr.code).toBe("PEER_NOT_FOUND");
    }
  });

  it("rejects invalid HOST_CREATE signatures and duplicate rooms", async () => {
    const { url } = await startServer();
    const hostKeys = makeEd25519KeyPair();
    const wrongKeys = makeEd25519KeyPair();

    const badHost = await connectClient(url);
    const badCh = await badHost.nextMessage();
    if (badCh.type !== "HOST_CHALLENGE") {
      throw new Error("Expected challenge");
    }
    badHost.send({
      type: "HOST_CREATE",
      lookupId: "room-dup",
      hostPubKey: hostKeys.pubKeyB64,
      sig: signChallenge(wrongKeys.privateKey, badCh.challenge),
    });
    const badErr = await badHost.nextMessage();
    expect(badErr.type).toBe("RELAY_ERROR");
    if (badErr.type === "RELAY_ERROR") {
      expect(badErr.code).toBe("INVALID_SIGNATURE");
    }
    expect((await badHost.closedPromise).code).toBe(4001);

    await createHostRoom(url, "room-dup", hostKeys);

    const dupHost = await connectClient(url);
    const dupCh = await dupHost.nextMessage();
    if (dupCh.type !== "HOST_CHALLENGE") {
      throw new Error("Expected challenge");
    }
    dupHost.send({
      type: "HOST_CREATE",
      lookupId: "room-dup",
      hostPubKey: wrongKeys.pubKeyB64,
      sig: signChallenge(wrongKeys.privateKey, dupCh.challenge),
    });
    const dupErr = await dupHost.nextMessage();
    expect(dupErr.type).toBe("RELAY_ERROR");
    if (dupErr.type === "RELAY_ERROR") {
      expect(dupErr.code).toBe("ROOM_EXISTS");
    }
    expect((await dupHost.closedPromise).code).toBe(4009);
  });

  it("rate-limits upgrades to 5/min/IP with deterministic nowMs and respects TRUST_PROXY", async () => {
    expect(parseTrustProxyEnv("true")).toBe(true);
    expect(parseTrustProxyEnv("1")).toBe(true);
    expect(parseTrustProxyEnv("false")).toBe(false);
    expect(parseTrustProxyEnv(undefined)).toBe(false);

    let now = 1_000_000;
    const { url } = await startServer({
      trustProxy: true,
      nowMs: () => now,
    });

    for (let i = 0; i < 5; i += 1) {
      const c = await connectClient(url, {
        "x-forwarded-for": "198.51.100.10, 10.0.0.1",
      });
      await c.nextMessage();
      c.close();
    }

    await expect(
      connectClient(url, { "x-forwarded-for": "198.51.100.10" }),
    ).rejects.toThrow(/429/);

    // Still blocked 1 ms before 60s window expires
    now += 59_999;
    await expect(
      connectClient(url, { "x-forwarded-for": "198.51.100.10" }),
    ).rejects.toThrow(/429/);

    // Distinct forwarded IP succeeds when TRUST_PROXY is enabled
    const otherIpClient = await connectClient(url, {
      "x-forwarded-for": "198.51.100.11",
    });
    const ch = await otherIpClient.nextMessage();
    expect(ch.type).toBe("HOST_CHALLENGE");

    // Window rolls over at exactly 60_000 ms
    now += 1;
    const resetClient = await connectClient(url, {
      "x-forwarded-for": "198.51.100.10",
    });
    expect((await resetClient.nextMessage()).type).toBe("HOST_CHALLENGE");

    // When TRUST_PROXY is disabled, spoofed X-Forwarded-For headers are ignored
    let untrustedNow = 2_000_000;
    const { url: untrustedUrl } = await startServer({
      trustProxy: false,
      nowMs: () => untrustedNow,
    });

    for (let i = 0; i < 5; i += 1) {
      const c = await connectClient(untrustedUrl, {
        "x-forwarded-for": `203.0.113.${i + 1}`,
      });
      await c.nextMessage();
      c.close();
    }
    await expect(
      connectClient(untrustedUrl, { "x-forwarded-for": "203.0.113.99" }),
    ).rejects.toThrow(/429/);
  });

  it("rejects binary WebSocket frames, malformed JSON, invalid schema, and unknown upgrade paths", async () => {
    const { url } = await startServer({ rateLimitMax: 20 });

    // Unknown WS upgrade path returns 404
    await expect(connectClient(`${url}/unknown`)).rejects.toThrow(/404/);

    const client = await connectClient(`${url}/ws`);
    await client.nextMessage(); // HOST_CHALLENGE

    // Binary frame rejected cleanly without dropping socket
    client.ws.send(Buffer.from([0xde, 0xad, 0xbe, 0xef]), { binary: true });
    const binErr = await client.nextMessage();
    expect(binErr).toEqual({
      type: "RELAY_ERROR",
      code: "BINARY_UNSUPPORTED",
      message: "Expected UTF-8 JSON text frame",
    });

    // Malformed JSON rejected
    client.ws.send("{not-valid-json");
    const jsonErr = await client.nextMessage();
    expect(jsonErr.type).toBe("RELAY_ERROR");
    if (jsonErr.type === "RELAY_ERROR") {
      expect(jsonErr.code).toBe("INVALID_JSON");
    }

    // Valid JSON failing TypeBox schema rejected
    client.send({ type: "UNKNOWN_TYPE", foo: "bar" });
    const schemaErr = await client.nextMessage();
    expect(schemaErr.type).toBe("RELAY_ERROR");
    if (schemaErr.type === "RELAY_ERROR") {
      expect(schemaErr.code).toBe("INVALID_MESSAGE");
    }
  });

  it("never leaks client IPs, X-Forwarded-For, or encrypted/plaintext payloads in server or Fastify logs", async () => {
    const relayLogEntries: Array<{
      level: string;
      meta: Record<string, unknown>;
      msg: string;
    }> = [];
    const spyLogger: RelayLogger = {
      debug: (meta, msg) => relayLogEntries.push({ level: "debug", meta, msg }),
      info: (meta, msg) => relayLogEntries.push({ level: "info", meta, msg }),
      warn: (meta, msg) => relayLogEntries.push({ level: "warn", meta, msg }),
      error: (meta, msg) => relayLogEntries.push({ level: "error", meta, msg }),
    };

    const fastifyLogChunks: string[] = [];
    const logStream = new PassThrough();
    logStream.on("data", (chunk: Buffer) => {
      fastifyLogChunks.push(chunk.toString("utf8"));
    });

    // Capture real Fastify Pino JSON logs.
    const { url: fastifyUrl } = await startServer({
      trustProxy: true,
      logLevel: "debug",
      logStream,
      rateLimitMax: 5,
    });
    // Also test BlindRelayCore + RelayLogger directly via spyLogger
    const { url: spyUrl } = await startServer({
      trustProxy: true,
      logger: spyLogger,
      rateLimitMax: 5,
    });

    const sentinelPayload = "SECRET_RELAY_FRAME_PLAINTEXT_999";
    const sentinelB64 = Buffer.from(sentinelPayload, "utf8").toString("base64");
    const forwardedIp = "203.0.113.77";

    for (const targetUrl of [fastifyUrl, spyUrl]) {
      const { host } = await createHostRoom(
        targetUrl,
        "room-noleak",
        makeEd25519KeyPair(),
        { "x-forwarded-for": forwardedIp },
      );

      const { guest } = await joinGuest(targetUrl, "room-noleak", host, {
        admit: true,
        headers: { "x-forwarded-for": forwardedIp },
      });

      guest.send({
        type: "RELAY_FRAME",
        targetPeerId: "host",
        payloadB64: sentinelB64,
      });
      await host.nextMessage();

      // Trigger binary frame warning, invalid JSON warning, HTTP /health & /, and rate-limit 429 warning
      guest.ws.send(Buffer.from(sentinelPayload, "utf8"), { binary: true });
      await guest.nextMessage();
      guest.ws.send("{bad-json");
      await guest.nextMessage();

      const httpBase = targetUrl.replace(/^ws:/, "http:");
      await fetch(`${httpBase}/health`, {
        headers: { "x-forwarded-for": forwardedIp },
      });
      await fetch(`${httpBase}/`, {
        headers: { "x-forwarded-for": forwardedIp },
      });

      // Exhaust remaining upgrades.
      for (let i = 0; i < 3; i++) {
        const c = await connectClient(targetUrl, {
          "x-forwarded-for": forwardedIp,
        });
        await c.nextMessage();
        c.close();
      }
      await expect(
        connectClient(targetUrl, { "x-forwarded-for": forwardedIp }),
      ).rejects.toThrow(/429/);
    }

    const fastifyLogLines = fastifyLogChunks
      .join("")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .filter((line) => !line.includes("Server listening at "));
    const fastifyDump = fastifyLogLines.join("\n");
    const spyDump = JSON.stringify(relayLogEntries);

    expect(fastifyLogLines.length).toBeGreaterThan(0);
    expect(relayLogEntries.length).toBeGreaterThan(0);

    for (const dump of [fastifyDump, spyDump]) {
      expect(dump).not.toContain("127.0.0.1");
      expect(dump).not.toContain(forwardedIp);
      expect(dump).not.toContain(sentinelPayload);
      expect(dump).not.toContain(sentinelB64);
      expect(dump.toLowerCase()).not.toContain("x-forwarded-for");
    }
  });

  it("reaps unresponsive sockets via heartbeat sweep and expires rooms after grace/idle", async () => {
    const sent = new Map<RelaySocket, string[]>();
    const closed = new Map<RelaySocket, boolean>();
    let pingCount = 0;

    function createMockSocket(): RelaySocket {
      const sock: RelaySocket = {
        get isOpen(): boolean {
          return !(closed.get(sock) ?? false);
        },
        send(data: string): void {
          const arr = sent.get(sock) ?? [];
          arr.push(data);
          sent.set(sock, arr);
        },
        close(): void {
          closed.set(sock, true);
        },
        terminate(): void {
          closed.set(sock, true);
        },
        ping(): void {
          pingCount += 1;
        },
      };
      return sock;
    }

    const core = new BlindRelayCore({
      heartbeatIntervalMs: 60_000,
      hostGraceMs: 50,
      idleRoomTtlMs: 80,
    });

    try {
      const hostKeys = makeEd25519KeyPair();
      const hostSock = createMockSocket();
      const challenge = core.handleConnection(hostSock);
      core.handleMessage(
        hostSock,
        JSON.stringify({
          type: "HOST_CREATE",
          lookupId: "room-hb",
          hostPubKey: hostKeys.pubKeyB64,
          sig: signChallenge(hostKeys.privateKey, challenge),
        }),
      );

      const guestSock = createMockSocket();
      core.handleConnection(guestSock);
      core.handleMessage(
        guestSock,
        JSON.stringify({ type: "GUEST_JOIN", lookupId: "room-hb" }),
      );

      // First sweep sends ping; host responds with pong, guest does not.
      core.runHeartbeatSweep();
      expect(pingCount).toBe(2);
      core.handlePong(hostSock);

      // Second sweep terminates unresponsive guestSock while keeping hostSock.
      core.runHeartbeatSweep();
      expect(guestSock.isOpen).toBe(false);
      expect(hostSock.isOpen).toBe(true);
      expect(core.getRoomStats("room-hb")?.pendingCount).toBe(0);

      // Idle timer expires room when no host heartbeat arrives.
      await new Promise((r) => setTimeout(r, 120));
      expect(core.getRoomCount()).toBe(0);
      expect(hostSock.isOpen).toBe(false);
    } finally {
      core.dispose();
    }
  });

  it("creates and resolves short invite codes via HTTP /invites endpoints", async () => {
    const { url } = await startServer();
    const httpBase = url.replace(/^ws:/, "http:");

    const createRes = await fetch(`${httpBase}/invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteUrl: "ytmd://listen/v1/abc123" }),
    });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as {
      code: string;
      shortUrl: string;
    };
    expect(created.code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
    expect(created.shortUrl).toBe(`ytmd://join/${created.code}`);

    const getRes = await fetch(`${httpBase}/invites/${created.code}`);
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toEqual({
      inviteUrl: "ytmd://listen/v1/abc123",
    });

    const missingRes = await fetch(`${httpBase}/invites/AAAA-BBBB`);
    expect(missingRes.status).toBe(404);
  });
});
