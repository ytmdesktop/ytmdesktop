import fs from "fs/promises";
import path from "path";
import { LyricsResult } from "./types";

type CacheRecord = {
  value: LyricsResult;
  expiresAt: number;
};

type DiskPayload = {
  entries: Record<string, CacheRecord>;
};

export default class LyricsCache {
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly diskPath: string;
  private readonly map = new Map<string, CacheRecord>();
  private loaded = false;
  private diskWriteTimeout: NodeJS.Timeout | null = null;

  constructor(userDataPath: string, maxEntries = 300, ttlMs = 1000 * 60 * 60 * 24 * 7) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.diskPath = path.join(userDataPath, "lyrics-cache.json");
  }

  public async get(key: string): Promise<LyricsResult | null> {
    await this.ensureLoaded();

    const record = this.map.get(key);
    if (!record) {
      return null;
    }

    if (record.expiresAt < Date.now()) {
      this.map.delete(key);
      this.scheduleWriteToDisk();
      return null;
    }

    this.map.delete(key);
    this.map.set(key, record);
    return record.value;
  }

  public async set(key: string, value: LyricsResult) {
    await this.ensureLoaded();

    this.map.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs
    });

    while (this.map.size > this.maxEntries) {
      const oldestKey = this.map.keys().next().value as string | undefined;
      if (!oldestKey) {
        break;
      }
      this.map.delete(oldestKey);
    }

    this.scheduleWriteToDisk();
  }

  public async clear() {
    await this.ensureLoaded();
    this.map.clear();

    if (this.diskWriteTimeout) {
      clearTimeout(this.diskWriteTimeout);
      this.diskWriteTimeout = null;
    }

    await this.writeToDisk();
  }

  public async getStats() {
    await this.ensureLoaded();

    const now = Date.now();
    let validEntries = 0;
    for (const record of this.map.values()) {
      if (record.expiresAt >= now) {
        validEntries++;
      }
    }

    let diskBytes = 0;
    try {
      const stat = await fs.stat(this.diskPath);
      diskBytes = stat.size;
    } catch {
      diskBytes = 0;
    }

    return {
      entries: validEntries,
      diskBytes
    };
  }

  private async ensureLoaded() {
    if (this.loaded) {
      return;
    }
    this.loaded = true;

    try {
      const raw = await fs.readFile(this.diskPath, { encoding: "utf-8" });
      const payload = JSON.parse(raw) as DiskPayload;
      const now = Date.now();
      for (const [key, record] of Object.entries(payload.entries ?? {})) {
        if (!record || !record.value || typeof record.expiresAt !== "number") {
          continue;
        }
        if (record.expiresAt < now) {
          continue;
        }
        this.map.set(key, record);
      }
    } catch {
      // Ignored intentionally; cache file is optional.
    }
  }

  private scheduleWriteToDisk() {
    if (this.diskWriteTimeout) {
      clearTimeout(this.diskWriteTimeout);
    }

    this.diskWriteTimeout = setTimeout(async () => {
      this.diskWriteTimeout = null;
      await this.writeToDisk();
    }, 500);
  }

  private async writeToDisk() {
    const payload: DiskPayload = {
      entries: Object.fromEntries(this.map.entries())
    };

    try {
      await fs.writeFile(this.diskPath, JSON.stringify(payload), { encoding: "utf-8" });
    } catch {
      // Ignored intentionally; cache persistence is best-effort.
    }
  }
}
