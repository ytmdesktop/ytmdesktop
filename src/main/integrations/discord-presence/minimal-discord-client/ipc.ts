import EventEmitter from "events";
import { Socket } from "net";

export enum OPCode {
  HANDSHAKE = 0,
  FRAME = 1,
  CLOSE = 2,
  PING = 3,
  PONG = 4
}

export default class IPCClient extends EventEmitter {
  private socket: Socket;

  constructor() {
    super();

    this.createSocket();
  }

  private createSocket() {
    this.socket = new Socket();
    this.socket.on("connect", () => {
      this.emit("connect");
    });
    this.socket.on("close", (hadError: boolean) => {
      this.emit("close", hadError);
    });
    this.socket.on("error", error => {
      this.emit("error", error);
    });
    this.socket.on("data", (buffer: Buffer) => {
      try {
        const op = buffer.readInt32LE(0);
        const length = buffer.readInt32LE(4);
        const json = JSON.parse(buffer.toString("utf-8", 8, 8 + length));

        this.emit("data", {
          op,
          json
        });
      } catch {
        /* invalid json provided, ignore */
      }
    });
  }

  public connect(ipcPath: string) {
    if (this.socket.destroyed) {
      this.createSocket();
    }
    this.socket.connect(ipcPath);
  }

  public send(data: unknown, op = OPCode.FRAME) {
    const json = JSON.stringify(data);
    const length = Buffer.byteLength(json);
    const buffer = Buffer.alloc(8 + length);
    buffer.writeInt32LE(op, 0);
    buffer.writeInt32LE(length, 4);
    buffer.write(json, 8, length);

    if (this.socket.writable) {
      this.socket.write(buffer);
    } else {
      this.socket.end();
      this.createSocket();
    }
  }

  public close() {
    if (!this.socket.closed) {
      this.send({}, OPCode.CLOSE);
      this.socket.end();
    }
  }

  public destroy() {
    this.removeAllListeners();
    this.socket.destroy();
  }
}
