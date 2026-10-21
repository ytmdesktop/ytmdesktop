import { app, net, safeStorage } from "electron";
import type { WebContents } from "electron";
import type Conf from "conf";
import log from "electron-log";

import { proxyProtocolSupportsHttpAuth } from "../../shared/proxy";
import type { StoreSchema } from "../../shared/store/schema";
import { getYtmSession } from "../ytm-session";
import { buildElectronProxyConfig, isProxyConfigured } from "./build-proxy-config";
import type { ProxySettingsInput } from "./build-proxy-config";

export type ProxyTestResult = {
  ok: boolean;
  message: string;
};

function decryptPassword(passwordEncrypted: string | null): string {
  if (!passwordEncrypted || !safeStorage.isEncryptionAvailable()) {
    return "";
  }

  try {
    return safeStorage.decryptString(Buffer.from(passwordEncrypted, "hex"));
  } catch (error) {
    log.error("Failed to decrypt proxy password", error);
    return "";
  }
}

export function syncYtmWebRtcForProxy(webContents: WebContents, proxy: ProxySettingsInput): void {
  webContents.setWebRTCIPHandlingPolicy(isProxyConfigured(proxy) ? "disable_non_proxied_udp" : "default");
}

export async function applyYtmProxyFromStore(store: Conf<StoreSchema>): Promise<boolean> {
  const ytmSession = getYtmSession(app.isPackaged);
  const config = buildElectronProxyConfig(store.get("proxy"));

  try {
    await ytmSession.setProxy(config);
    await ytmSession.closeAllConnections();
    await ytmSession.clearHostResolverCache();
    log.info(`YTM proxy mode=${config.mode}${config.proxyRules ? ` rules=${config.proxyRules}` : ""}`);
    return true;
  } catch (error) {
    log.error("Failed to apply YTM proxy configuration", error);
    return false;
  }
}

export function resolveProxyCredentials(store: Conf<StoreSchema>): { username: string; password: string } | null {
  const proxy = store.get("proxy");
  if (!isProxyConfigured(proxy) || !proxyProtocolSupportsHttpAuth(proxy.protocol)) {
    return null;
  }

  const username = (proxy.username ?? "").trim();
  const password = decryptPassword(proxy.passwordEncrypted);
  if (!username && !password) {
    return null;
  }

  return { username, password };
}

function requestMusicThroughYtmSession(store: Conf<StoreSchema>, testUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = net.request({
      method: "GET",
      url: testUrl,
      session: getYtmSession(app.isPackaged),
      redirect: "manual"
    });

    const timeout = setTimeout(() => {
      request.abort();
      reject(new Error("Timed out after 15s"));
    }, 15000);

    const finish = (handler: () => void) => {
      clearTimeout(timeout);
      handler();
    };

    request.on("login", (authInfo, callback) => {
      if (!authInfo.isProxy) {
        callback();
        return;
      }

      const credentials = resolveProxyCredentials(store);
      if (!credentials) {
        callback();
        return;
      }

      callback(credentials.username, credentials.password);
    });

    request.on("response", response => {
      response.on("data", () => {
        // Drain so the request can complete
      });
      response.on("error", error => {
        finish(() => reject(error));
      });
      response.on("end", () => {
        finish(() => resolve(response.statusCode));
      });
    });

    request.on("error", error => {
      finish(() => reject(error));
    });

    request.end();
  });
}

export async function testYtmProxyFromStore(store: Conf<StoreSchema>): Promise<ProxyTestResult> {
  const proxy = store.get("proxy");
  if (!proxy.enabled) {
    return { ok: false, message: "Enable the proxy before testing." };
  }
  if (!isProxyConfigured(proxy)) {
    return { ok: false, message: "Host or port is invalid." };
  }

  if (!(await applyYtmProxyFromStore(store))) {
    return { ok: false, message: "Proxy settings could not be applied." };
  }

  const ytmSession = getYtmSession(app.isPackaged);
  const testUrl = "https://music.youtube.com/";
  let resolved: string;
  try {
    resolved = await ytmSession.resolveProxy(testUrl);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `Could not resolve proxy for Music: ${detail}` };
  }

  if (!resolved || resolved.toUpperCase() === "DIRECT") {
    return { ok: false, message: "Proxy is configured but Music would still use a direct connection." };
  }

  try {
    const status = await requestMusicThroughYtmSession(store, testUrl);
    return {
      ok: true,
      message: `Proxy OK (${resolved}). Music responded HTTP ${status}.`
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `Request through proxy failed (${resolved}): ${detail}` };
  }
}

let proxyAuthAttached = false;

export function attachProxyAuthHandler(store: Conf<StoreSchema>): void {
  if (proxyAuthAttached) {
    return;
  }

  proxyAuthAttached = true;
  app.on("login", (event, webContents, _details, authInfo, callback) => {
    if (!authInfo.isProxy || webContents?.session !== getYtmSession(app.isPackaged)) {
      return;
    }

    event.preventDefault();
    const credentials = resolveProxyCredentials(store);
    if (!credentials) {
      callback();
      return;
    }

    callback(credentials.username, credentials.password);
  });
}
