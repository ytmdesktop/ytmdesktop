import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildElectronProxyConfig, DEFAULT_PROXY_BYPASS_RULES, isProxyConfigured } from "./build-proxy-config.ts";
import type { ProxySettingsInput } from "./build-proxy-config.ts";

function base(overrides: Partial<ProxySettingsInput> = {}): ProxySettingsInput {
  return {
    enabled: true,
    protocol: "socks5",
    host: "127.0.0.1",
    port: 1080,
    ...overrides
  };
}

describe("isProxyConfigured", () => {
  it("requires enabled, non-empty host, and a valid port", () => {
    assert.equal(isProxyConfigured(base()), true);
    assert.equal(isProxyConfigured(base({ enabled: false })), false);
    assert.equal(isProxyConfigured(base({ host: "" })), false);
    assert.equal(isProxyConfigured(base({ host: "   " })), false);
    assert.equal(isProxyConfigured(base({ port: 0 })), false);
    assert.equal(isProxyConfigured(base({ port: 65536 })), false);
    assert.equal(isProxyConfigured(base({ port: 1.5 })), false);
  });
});

describe("buildElectronProxyConfig", () => {
  it("returns direct mode when the proxy is not configured", () => {
    assert.deepEqual(buildElectronProxyConfig(base({ enabled: false })), { mode: "direct" });
    assert.deepEqual(buildElectronProxyConfig(base({ host: "" })), { mode: "direct" });
  });

  it("builds fixed_servers rules for each protocol", () => {
    for (const protocol of ["socks5", "socks4", "http", "https"] as const) {
      assert.deepEqual(buildElectronProxyConfig(base({ protocol, host: "proxy.example", port: 8080 })), {
        mode: "fixed_servers",
        proxyRules: `${protocol}://proxy.example:8080`,
        proxyBypassRules: DEFAULT_PROXY_BYPASS_RULES
      });
    }
  });

  it("trims host and always uses the default bypass rules", () => {
    assert.deepEqual(buildElectronProxyConfig(base({ host: "  10.0.0.1  " })), {
      mode: "fixed_servers",
      proxyRules: "socks5://10.0.0.1:1080",
      proxyBypassRules: DEFAULT_PROXY_BYPASS_RULES
    });
  });
});
