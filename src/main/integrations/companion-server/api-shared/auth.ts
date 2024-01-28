import crypto from "crypto";
import { safeStorage } from "electron";
import Conf from "conf";
import { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from "fastify";
import { StoreSchema } from "../../../../shared/store/schema";
import { AuthToken } from "../../../../shared/integrations/companion-server/types";

const temporaryCodeMap: { [code: string]: { appId: string; appVersion: string; appName: string } } = {};

async function getUnusedCode() {
  return new Promise<string>(resolve => {
    let code;
    const generateStart = Date.now();
    // Because of this setInterval it does take 250ms before it executes which delays everything by 250ms
    const interval = setInterval(() => {
      // Failsafe timeout bail. It could be that every code is exhausted or we simply didn't find a code fast enough
      if (Date.now() - generateStart > 3 * 1000) {
        clearInterval(interval);
        resolve(null);
      }

      code = `${crypto.randomInt(0, 9)}${crypto.randomInt(0, 9)}${crypto.randomInt(0, 9)}${crypto.randomInt(0, 9)}`;
      if (!temporaryCodeMap[code]) {
        clearInterval(interval);
        resolve(code);
      }
    }, 250);
  });
}

export async function getTemporaryAuthCode(appId: string, appVersion: string, appName: string) {
  const code = await getUnusedCode();
  if (code) {
    temporaryCodeMap[code] = {
      appId,
      appVersion,
      appName
    };
    setTimeout(() => {
      delete temporaryCodeMap[code];
    }, 60 * 1000);
  }
  return code;
}

export function getIsTemporaryAuthCodeValidAndRemove(appId: string, code: string) {
  if (temporaryCodeMap[code]) {
    if (temporaryCodeMap[code].appId === appId) {
      const data = temporaryCodeMap[code];
      delete temporaryCodeMap[code];
      return data;
    }
  }

  return false;
}

export function createAuthToken(store: Conf<StoreSchema>, appId: string, appVersion: string, appName: string) {
  let authTokens: AuthToken[] = [];
  try {
    authTokens = JSON.parse(safeStorage.decryptString(Buffer.from(store.get("integrations").companionServerAuthTokens, "hex")));
  } catch {
    /* authTokens will just be an empty array */
  }

  const currentTokenIndex = authTokens.findIndex(token => token.appId === appId);
  if (currentTokenIndex > -1) {
    authTokens.splice(currentTokenIndex, 1);
  }

  const token = crypto.randomBytes(256).toString("hex");
  const tokenId = crypto.randomUUID();
  authTokens.push({
    appId,
    appName,
    appVersion,
    id: tokenId,
    token: crypto.createHash("sha256").update(token).digest("hex"),
    metadata: {
      version: 1
    }
  });

  store.set("integrations.companionServerAuthTokens", safeStorage.encryptString(JSON.stringify(authTokens)).toString("hex"));

  return token;
}

export function isAuthValid(store: Conf<StoreSchema>, authToken: string): [boolean, string] {
  if (!authToken) return [false, null];

  const authTokenHash = crypto.createHash("sha256").update(authToken).digest("hex");

  let authTokens: AuthToken[] = [];
  try {
    const decryptedAuthTokens = safeStorage.decryptString(Buffer.from(store.get("integrations").companionServerAuthTokens, "hex"));
    authTokens = JSON.parse(decryptedAuthTokens);
  } catch {
    /* authTokens will just be an empty array */
  }

  let validSession = false;
  let id = null;
  for (const authSession of authTokens) {
    if (authSession.token == authTokenHash) {
      id = authSession.id;
      validSession = true;
      break;
    }
  }

  if (validSession) {
    return [true, id];
  }

  return [false, null];
}

export function isAuthValidMiddleware(store: Conf<StoreSchema>, request: FastifyRequest, response: FastifyReply, next: HookHandlerDoneFunction) {
  const authToken = request.headers.authorization;
  if (!authToken) {
    response.code(401);
    response.send({
      error: "UNAUTHORIZED"
    });
    return;
  }

  const [validSession, tokenId] = isAuthValid(store, authToken);

  if (validSession) {
    request.authId = tokenId;
    next();
  } else {
    response.code(401);
    response.send({
      error: "UNAUTHORIZED"
    });
  }
}
