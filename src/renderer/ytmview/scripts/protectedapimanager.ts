import { ProtectedAPIOpCode } from "~shared/types";

class ProtectedAPIManager {
  private channel = new MessageChannel();
  private apis = new Map<string, ProtectedAPI>();

  public init() {
    window.postMessage("ytmd-protected-api-port", "/", [this.channel.port2]);
  }

  public createOrGetAPI(name: string): ProtectedAPI {
    if (this.apis.has(name)) return this.apis.get(name)!;

    const apiChannel = new MessageChannel();

    const protectedApi = new ProtectedAPI(name, apiChannel.port1);
    this.apis.set(name, protectedApi);

    this.channel.port1.postMessage(
      {
        op: ProtectedAPIOpCode.ProvideAPIPort,
        name
      },
      [apiChannel.port2]
    );

    return protectedApi;
  }
}

export interface ProtectedAPIMessageEvent {
  args: unknown[];
}

class ProtectedAPI extends EventTarget {
  private port: MessagePort;
  private invokeHandlers = new Map<string, (event: Event) => Promise<unknown[]>>();

  public readonly name;

  constructor(name: string, port: MessagePort) {
    super();
    this.name = name;
    this.port = port;

    this.port.onmessage = async event => {
      if (event.data.op === ProtectedAPIOpCode.Message) {
        this.dispatchEvent(
          new CustomEvent<ProtectedAPIMessageEvent>(event.data.name, {
            detail: {
              args: event.data.args
            }
          })
        );
      }

      if (event.data.op === ProtectedAPIOpCode.Invoke) {
        const response = await this.dispatchHandleEvent(
          new CustomEvent<ProtectedAPIMessageEvent>(event.data.name, {
            detail: {
              args: event.data.args
            }
          })
        );
        this.port.postMessage({
          op: ProtectedAPIOpCode.InvokeResponse,
          id: event.data.id,
          name: event.data.name,
          args: response
        });
      }
    };
  }

  public postMessage(name: string, ...args: unknown[]) {
    this.port.postMessage({
      op: ProtectedAPIOpCode.Message,
      name,
      args
    });
  }

  public handleMessage(name: string, callback: (event: Event) => Promise<unknown[]>) {
    this.invokeHandlers.set(name, callback);
  }

  private async dispatchHandleEvent(event: Event) {
    if (this.invokeHandlers.has(event.type)) {
      return await this.invokeHandlers.get(event.type)!(event);
    }
  }
}

export default new ProtectedAPIManager();
