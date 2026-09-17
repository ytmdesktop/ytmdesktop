import { app, dialog, shell, Notification, BrowserWindow, WebContents } from "electron";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import Conf from "conf";
import log from "electron-log";
import { StoreSchema } from "~shared/store/schema";

export interface TrackDownloadInfo {
  videoId: string;
  title?: string;
  artist?: string;
}

export default class Downloader {
  private store: Conf<StoreSchema>;
  private getWebContentsList: () => (WebContents | null)[];
  private activeDownloads = new Set<string>();
  private completedVideoIds = new Set<string>();

  constructor(store: Conf<StoreSchema>, getWebContentsList: () => (WebContents | null)[]) {
    this.store = store;
    this.getWebContentsList = getWebContentsList;
  }

  /**
   * Get the directory where downloaded music is saved
   */
  public getDownloadDir(): string {
    const customPath = this.store.get("downloader.downloadPath");
    if (customPath && customPath.trim().length > 0 && fs.existsSync(customPath)) {
      return customPath;
    }
    const defaultDir = path.join(app.getPath("downloads"), "YouTube Music");
    if (!fs.existsSync(defaultDir)) {
      fs.mkdirSync(defaultDir, { recursive: true });
    }
    return defaultDir;
  }

  /**
   * Resolve yt-dlp executable path
   */
  public getYtDlpPath(): string {
    const userBin = path.join(app.getPath("userData"), "bin", "yt-dlp.exe");
    if (fs.existsSync(userBin)) return userBin;

    const resourceBin = path.join(process.resourcesPath || "", "bin", "yt-dlp.exe");
    if (fs.existsSync(resourceBin)) return resourceBin;

    const ffmpegDirBin = "C:\\ffmpeg\\bin\\yt-dlp.exe";
    if (fs.existsSync(ffmpegDirBin)) return ffmpegDirBin;

    return "yt-dlp";
  }

  /**
   * Resolve ffmpeg directory or executable
   */
  public getFfmpegDir(): string | null {
    const userBin = path.join(app.getPath("userData"), "bin", "ffmpeg.exe");
    if (fs.existsSync(userBin)) return path.dirname(userBin);

    const resourceBin = path.join(process.resourcesPath || "", "bin", "ffmpeg.exe");
    if (fs.existsSync(resourceBin)) return path.dirname(resourceBin);

    const cFfmpeg = "C:\\ffmpeg\\bin\\ffmpeg.exe";
    if (fs.existsSync(cFfmpeg)) return "C:\\ffmpeg\\bin";

    return null;
  }

  /**
   * Open the download folder in Windows Explorer
   */
  public async openFolder(): Promise<void> {
    const folder = this.getDownloadDir();
    await shell.openPath(folder);
  }

  /**
   * Select a new download folder
   */
  public async selectFolder(parentWindow?: BrowserWindow): Promise<string | null> {
    const result = await dialog.showOpenDialog(parentWindow || null, {
      title: "Pilih Folder Penyimpanan Lagu",
      defaultPath: this.getDownloadDir(),
      properties: ["openDirectory", "createDirectory"]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const selected = result.filePaths[0];
    this.store.set("downloader.downloadPath", selected);
    return selected;
  }

  /**
   * Send downloader status update to all renderer windows
   */
  private broadcastStatus(data: { videoId: string; status: "downloading" | "completed" | "error"; title?: string; filePath?: string; error?: string }) {
    for (const wc of this.getWebContentsList()) {
      if (wc && !wc.isDestroyed()) {
        wc.send("downloader:status", data);
      }
    }
  }

  /**
   * Download a track given its videoId, title, and artist
   */
  public async downloadTrack(track: TrackDownloadInfo): Promise<string> {
    const { videoId, title = "Lagu", artist = "YouTube Music" } = track;
    if (!videoId) {
      throw new Error("Video ID tidak valid");
    }

    if (this.activeDownloads.has(videoId)) {
      log.info(`[Downloader] Video ${videoId} is already being downloaded.`);
      return "";
    }

    this.activeDownloads.add(videoId);
    this.broadcastStatus({ videoId, status: "downloading", title });

    const downloadDir = this.getDownloadDir();
    const ytDlpPath = this.getYtDlpPath();
    const ffmpegDir = this.getFfmpegDir();

    log.info(`[Downloader] Starting download for ${videoId} (${title} - ${artist})`);
    log.info(`[Downloader] Using yt-dlp: ${ytDlpPath}, ffmpeg: ${ffmpegDir}, output: ${downloadDir}`);

    const args: string[] = [
      "-x",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "0",
      "--embed-thumbnail",
      "--embed-metadata",
      "--no-playlist",
      "-o",
      path.join(downloadDir, "%(title)s - %(artist)s.%(ext)s"),
      `https://music.youtube.com/watch?v=${videoId}`
    ];

    if (ffmpegDir) {
      args.unshift("--ffmpeg-location", ffmpegDir);
    }

    return new Promise((resolve, reject) => {
      let finalFilePath = "";
      const proc = spawn(ytDlpPath, args, { windowsHide: true });

      proc.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        log.info(`[yt-dlp] ${text.trim()}`);

        const matchDest =
          text.match(/\[(?:ExtractAudio|Merger|download)\] Destination:\s+(.+\.mp3)/i) ||
          text.match(/\[ExtractAudio\] Destination:\s+(.+)/i) ||
          text.match(/\[Merger\] Merging formats into "(.+\.mp3)"/i);
        if (matchDest && matchDest[1]) {
          finalFilePath = matchDest[1].trim();
        }
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        log.warn(`[yt-dlp err] ${chunk.toString().trim()}`);
      });

      proc.on("error", err => {
        this.activeDownloads.delete(videoId);
        log.error(`[Downloader] Process error:`, err);
        this.broadcastStatus({ videoId, status: "error", title, error: err.message });
        reject(err);
      });

      proc.on("close", code => {
        this.activeDownloads.delete(videoId);

        if (code === 0) {
          this.completedVideoIds.add(videoId);

          if (!finalFilePath || !fs.existsSync(finalFilePath)) {
            try {
              const files = fs
                .readdirSync(downloadDir)
                .filter(f => f.endsWith(".mp3"))
                .map(f => ({ name: f, fullPath: path.join(downloadDir, f), time: fs.statSync(path.join(downloadDir, f)).mtimeMs }))
                .sort((a, b) => b.time - a.time);
              if (files.length > 0) {
                finalFilePath = files[0].fullPath;
              }
            } catch (e) {
              log.warn("[Downloader] Error finding recent mp3 file:", e);
            }
          }

          log.info(`[Downloader] Download completed for ${videoId}. Saved at: ${finalFilePath}`);
          this.broadcastStatus({ videoId, status: "completed", title, filePath: finalFilePath });

          try {
            const notif = new Notification({
              title: "Lagu Berhasil Diunduh 🎵",
              body: `${title} - ${artist}\nTersimpan di folder YouTube Music. Klik untuk membuka.`
            });
            notif.on("click", () => {
              if (finalFilePath && fs.existsSync(finalFilePath)) {
                shell.showItemInFolder(finalFilePath);
              } else {
                shell.openPath(downloadDir);
              }
            });
            notif.show();
          } catch (notifErr) {
            log.warn("[Downloader] Could not show notification:", notifErr);
          }

          resolve(finalFilePath);
        } else {
          const errMsg = `yt-dlp proses keluar dengan kode ${code}`;
          log.error(`[Downloader] ${errMsg}`);
          this.broadcastStatus({ videoId, status: "error", title, error: errMsg });
          reject(new Error(errMsg));
        }
      });
    });
  }

  /**
   * Check if a video has already been downloaded
   */
  public isTrackAlreadyDownloaded(videoId: string, title?: string): boolean {
    if (this.completedVideoIds.has(videoId)) return true;
    if (!title) return false;

    try {
      const downloadDir = this.getDownloadDir();
      const files = fs.readdirSync(downloadDir);
      const cleanTitle = title.toLowerCase().replace(/[^a-z0-9]/g, "");
      return files.some(f => {
        const cleanFile = f.toLowerCase().replace(/[^a-z0-9]/g, "");
        return cleanFile.includes(cleanTitle);
      });
    } catch {
      return false;
    }
  }

  /**
   * Hook into track playback for automatic download
   */
  public async handleAutoDownload(videoDetails: { videoId?: string; title?: string; author?: string }): Promise<void> {
    const isAutoDownloadEnabled = this.store.get("downloader.autoDownload");
    if (!isAutoDownloadEnabled) return;

    const videoId = videoDetails?.videoId;
    if (!videoId) return;

    if (this.activeDownloads.has(videoId)) return;

    if (this.isTrackAlreadyDownloaded(videoId, videoDetails.title)) {
      log.info(`[Downloader] Auto-download: Track ${videoDetails.title} (${videoId}) already downloaded.`);
      return;
    }

    log.info(`[Downloader] Auto-downloading track: ${videoDetails.title} (${videoId})`);
    try {
      await this.downloadTrack({
        videoId,
        title: videoDetails.title,
        artist: videoDetails.author
      });
    } catch (err) {
      log.error(`[Downloader] Auto-download failed for ${videoId}:`, err);
    }
  }
}
