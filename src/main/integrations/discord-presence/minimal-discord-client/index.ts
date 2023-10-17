import EventEmitter from "events";
import IPCClient, { OPCode } from "./ipc";
import { DiscordActivity } from "./types";
import { randomUUID } from "crypto";
import log from "electron-log";

function getIPCPath(id: number): string {
  if (process.platform === "win32") {
    return `\\\\?\\pipe\\discord-ipc-${id}`;
  }

  const prefix = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || "/tmp";
  return `${prefix.replace(/\/$/, "")}/discord-ipc-${id}`;
}

export default class DiscordClient extends EventEmitter {
  private clientId: string | null = null;
  private connectionPromise: Promise<void> | null = null;
  private ipcClient = new IPCClient();
  private connected = false;

  constructor(clientId: string) {
    super();

    this.clientId = clientId;
  }

  public connect() {
    if (this.connectionPromise) return this.connectionPromise;
    this.ipcClient.removeAllListeners();

    // Promise chaining is OK here, we're looping through different IPC paths and seeing which one works
    // eslint-disable-next-line no-async-promise-executor
    this.connectionPromise = new Promise(async (resolve, reject) => {
      log.debug("dipc: initiated connection loop over 10 ids");
      let id = 0;
      while (id < 10) {
        try {
          await new Promise<void>((ipcResolve, ipcReject) => {
            const ipcPath = getIPCPath(id);
            log.debug("dipc: connecting to discord at", ipcPath);
            this.ipcClient.once("close", () => {
              this.ipcClient.removeAllListeners();
              log.debug("dipc: failed to connect to discord at", ipcPath);
              ipcReject();
            });
            this.ipcClient.once("error", error => {
              log.error("dipc: socket error connecting to discord", error);
            });
            this.ipcClient.once("connect", () => {
              log.debug("dipc: connected to discord at", ipcPath);
              this.ipcClient.removeAllListeners();
              ipcResolve();
            });
            this.ipcClient.connect(getIPCPath(id));
          });

          this.connected = true;
          this.ipcClient.send(
            {
              v: 1,
              client_id: this.clientId
            },
            OPCode.HANDSHAKE
          );
          this.emit("connect");

          this.ipcClient.on("close", () => {
            this.connected = false;
            this.emit("close");
          });
          this.ipcClient.on("data", (op: OPCode, json: unknown) => {
            switch (op) {
              case OPCode.PING: {
                this.ipcClient.send(json, OPCode.PONG);
                break;
              }

              default: {
                break;
              }
            }
          });

          this.connectionPromise = null;
          resolve();

          return;
        } catch {
          id++;
        }
      }

      this.connectionPromise = null;
      reject();
    });

    return this.connectionPromise;
  }

  public close() {
    if (this.connected) {
      this.ipcClient.once("close", () => {
        this.ipcClient.removeAllListeners();
      });
      this.ipcClient.close();
    }
  }

  public destroy() {
    this.connected = false;
    this.removeAllListeners();
    this.ipcClient.destroy();
  }

  public setActivity(activity: DiscordActivity) {
    this.ipcClient.send({
      cmd: "SET_ACTIVITY",
      args: {
        pid: process.pid,
        activity
      },
      nonce: randomUUID()
    });
  }

  public clearActivity() {
    this.ipcClient.send({
      cmd: "SET_ACTIVITY",
      args: {
        pid: process.pid
      },
      nonce: randomUUID()
    });
  }
}
