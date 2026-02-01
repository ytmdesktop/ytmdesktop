import path from "path";
import fs from "fs/promises";
import { app } from "electron";
import log from "electron-log";
import os from "os";
// Importing Sentry as a type only to avoid a circular dependency
import type SentryIntegration from "../sentry";

export interface CrashReport {
  timestamp: string;
  type: "crash" | "unresponsive" | "error" | "freeze";
  error?: {
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
  };
  system: {
    platform: string;
    arch: string;
    version: string;
    memory: {
      total: number;
      free: number;
      used: number;
    };
    cpu: {
      model: string;
      cores: number;
      usage?: number;
    };
  };
  app: {
    version: string;
    electron: string;
    chrome: string;
    node: string;
  };
  process: {
    uptime: number;
    memoryUsage: NodeJS.MemoryUsage;
    pid: number;
    processType: string;
  };
  logs?: string[];
  additionalInfo?: Record<string, unknown>;
}

export default class CrashReporter {
  private crashReportsDir: string;
  private maxReports = 10;
  private maxLogLines = 500;
  private unresponsiveTimeout: NodeJS.Timeout | null = null;
  private lastHeartbeat = Date.now();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private sentryIntegration: SentryIntegration | null = null;

  constructor(sentryIntegration?: SentryIntegration) {
    this.crashReportsDir = path.join(app.getPath("userData"), "crash-reports");
    this.ensureCrashReportsDir();
    this.startHeartbeatMonitoring();
    this.sentryIntegration = sentryIntegration || null;
  }

  private async ensureCrashReportsDir() {
    try {
      await fs.mkdir(this.crashReportsDir, { recursive: true });
    } catch (error) {
      log.error("Failed to create crash reports directory:", error);
    }
  }

  private async getSystemInfo(): Promise<CrashReport["system"]> {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    return {
      platform: `${os.type()} ${os.release()}`,
      arch: os.arch(),
      version: os.version(),
      memory: {
        total: totalMem,
        free: freeMem,
        used: totalMem - freeMem
      },
      cpu: {
        model: cpus[0]?.model || "Unknown",
        cores: cpus.length,
        usage: await this.getCpuUsage()
      }
    };
  }

  private async getCpuUsage(): Promise<number> {
    return new Promise(resolve => {
      const startUsage = process.cpuUsage();
      const startTime = Date.now();

      setTimeout(() => {
        const endUsage = process.cpuUsage(startUsage);
        const endTime = Date.now();
        const totalTime = (endTime - startTime) * 1000; // Convert to microseconds
        const usage = ((endUsage.user + endUsage.system) / totalTime) * 100;
        resolve(Math.round(usage));
      }, 100);
    });
  }

  private async getRecentLogs(): Promise<string[]> {
    try {
      const logPath = log.transports.file.getFile().path;
      const logContent = await fs.readFile(logPath, "utf-8");
      const lines = logContent.split("\n");
      return lines.slice(-this.maxLogLines).filter(line => line.trim());
    } catch (error) {
      log.warn("Failed to read recent logs:", error);
      return [];
    }
  }

  public async generateCrashReport(type: CrashReport["type"], error?: Error, additionalInfo?: Record<string, unknown>): Promise<string> {
    const timestamp = new Date().toISOString();
    const filename = `crash-${type}-${timestamp.replace(/[:.]/g, "-")}.json`;
    const filepath = path.join(this.crashReportsDir, filename);

    const report: CrashReport = {
      timestamp,
      type,
      error: error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
            cause: error.cause
          }
        : undefined,
      system: await this.getSystemInfo(),
      app: {
        version: app.getVersion(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node
      },
      process: {
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        pid: process.pid,
        processType: process.type
      },
      logs: await this.getRecentLogs(),
      additionalInfo
    };

    try {
      await fs.writeFile(filepath, JSON.stringify(report, null, 2));
      log.info(`Crash report saved: ${filename}`);

      // Clean up old reports
      await this.cleanupOldReports();

      return filepath;
    } catch (writeError) {
      log.error("Failed to write crash report:", writeError);
      throw writeError;
    }
  }

  private async cleanupOldReports() {
    try {
      const files = await fs.readdir(this.crashReportsDir);
      const crashFiles = files
        .filter(file => file.startsWith("crash-") && file.endsWith(".json"))
        .map(file => ({
          name: file,
          path: path.join(this.crashReportsDir, file)
        }));

      if (crashFiles.length > this.maxReports) {
        // Sort by creation time (embedded in filename) and remove oldest
        crashFiles.sort((a, b) => a.name.localeCompare(b.name));
        const filesToDelete = crashFiles.slice(0, crashFiles.length - this.maxReports);

        for (const file of filesToDelete) {
          try {
            await fs.unlink(file.path);
            log.info(`Cleaned up old crash report: ${file.name}`);
          } catch (error) {
            log.warn(`Failed to delete old crash report ${file.name}:`, error);
          }
        }
      }
    } catch (error) {
      log.error("Failed to cleanup old crash reports:", error);
    }
  }

  public async reportCrash(error: Error, additionalInfo?: Record<string, unknown>) {
    log.error("Application crash detected:", error);
    try {
      // Send crash to Sentry if available
      if (this.sentryIntegration) {
        this.sentryIntegration.captureException(error, {
          ...additionalInfo,
          crash_report_type: "crash"
        });
      }

      const reportPath = await this.generateCrashReport("crash", error, additionalInfo);
      return reportPath;
    } catch (reportError) {
      log.error("Failed to generate crash report:", reportError);
      return null;
    }
  }

  public async reportUnresponsive(duration: number) {
    log.warn(`Application unresponsive for ${duration}ms`);
    try {
      const additionalInfo = {
        unresponsiveDuration: duration,
        lastHeartbeat: new Date(this.lastHeartbeat).toISOString()
      };

      // Report to Sentry if available
      if (this.sentryIntegration) {
        this.sentryIntegration.captureMessage(`Application unresponsive for ${duration}ms`, "warning", additionalInfo);
      }

      const reportPath = await this.generateCrashReport("unresponsive", undefined, additionalInfo);
      return reportPath;
    } catch (error) {
      log.error("Failed to generate unresponsive report:", error);
      return null;
    }
  }

  public async reportError(error: Error, context: string) {
    log.error(`Application error in ${context}:`, error);
    try {
      // Send error to Sentry if available
      if (this.sentryIntegration) {
        this.sentryIntegration.captureException(error, {
          context,
          crash_report_type: "error"
        });
      }

      const reportPath = await this.generateCrashReport("error", error, { context });
      return reportPath;
    } catch (reportError) {
      log.error("Failed to generate error report:", reportError);
      return null;
    }
  }

  public startUnresponsiveTimer(timeoutMs = 30000) {
    this.clearUnresponsiveTimer();
    this.unresponsiveTimeout = setTimeout(async () => {
      const duration = Date.now() - this.lastHeartbeat;
      await this.reportUnresponsive(duration);
    }, timeoutMs);
  }

  public clearUnresponsiveTimer() {
    if (this.unresponsiveTimeout) {
      clearTimeout(this.unresponsiveTimeout);
      this.unresponsiveTimeout = null;
    }
  }

  public heartbeat() {
    this.lastHeartbeat = Date.now();
    this.clearUnresponsiveTimer();
    this.startUnresponsiveTimer();
  }

  private startHeartbeatMonitoring() {
    // Monitor main process heartbeat every 5 seconds
    this.heartbeatInterval = setInterval(() => {
      this.heartbeat();
    }, 5000);
  }

  public async getCrashReports(): Promise<Array<{ filename: string; timestamp: string; type: string }>> {
    try {
      const files = await fs.readdir(this.crashReportsDir);
      const crashFiles = files
        .filter(file => file.startsWith("crash-") && file.endsWith(".json"))
        .map(file => {
          const parts = file.replace("crash-", "").replace(".json", "").split("-");
          const type = parts[0];
          const timestamp = parts.slice(1).join("-");
          return {
            filename: file,
            timestamp,
            type
          };
        })
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

      return crashFiles;
    } catch (error) {
      log.error("Failed to list crash reports:", error);
      return [];
    }
  }

  public async getCrashReport(filename: string): Promise<CrashReport | null> {
    try {
      const filepath = path.join(this.crashReportsDir, filename);
      const content = await fs.readFile(filepath, "utf-8");
      return JSON.parse(content) as CrashReport;
    } catch (error) {
      log.error(`Failed to read crash report ${filename}:`, error);
      return null;
    }
  }

  public async deleteCrashReport(filename: string): Promise<boolean> {
    try {
      const filepath = path.join(this.crashReportsDir, filename);
      await fs.unlink(filepath);
      log.info(`Deleted crash report: ${filename}`);
      return true;
    } catch (error) {
      log.error(`Failed to delete crash report ${filename}:`, error);
      return false;
    }
  }

  public dispose() {
    this.clearUnresponsiveTimer();
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
}
