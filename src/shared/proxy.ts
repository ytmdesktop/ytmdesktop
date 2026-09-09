import type { ProxyProtocol } from "./store/schema";

export function proxyProtocolSupportsHttpAuth(protocol: ProxyProtocol): boolean {
  return protocol === "http" || protocol === "https";
}
