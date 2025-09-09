import { Socket } from "node:net";

export default class CompanionServerIpcClient {
  public socket;
  public version: string = null;

  constructor(socket: Socket) {
    this.socket = socket;
  }
}
