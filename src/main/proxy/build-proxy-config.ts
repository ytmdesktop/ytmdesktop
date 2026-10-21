import type { ProxyProtocol } from "../../shared/store/schema";

export const DEFAULT_PROXY_BYPASS_RULES = "<local>";

export type ProxySettingsInput = {
  enabled: boolean;
  protocol: ProxyProtocol;
  host: string;
  port: number;
};

export function isProxyConfigured(input: ProxySettingsInput): boolean {
  const host = (input.host ?? "").trim();
  const port = Number(input.port);
  return Boolean(input.enabled && host && Number.isInteger(port) && port > 0 && port <= 65535);
}

export function buildElectronProxyConfig(input: ProxySettingsInput): Electron.ProxyConfig {
  if (!isProxyConfigured(input)) {
    return { mode: "direct" };
  }
  const host = input.host.trim();
  const protocol = input.protocol;
  return {
    mode: "fixed_servers",
    proxyRules: `${protocol}://${host}:${Number(input.port)}`,
    proxyBypassRules: DEFAULT_PROXY_BYPASS_RULES
  };
}
