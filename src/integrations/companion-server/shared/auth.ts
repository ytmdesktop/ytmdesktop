import crypto from 'crypto';
import { safeStorage } from 'electron';
import ElectronStore from 'electron-store';
import { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify';
import { StoreSchema } from '../../../shared/store/schema';

const temporaryCodeMap: { [code: string]: any } = {};

async function getUnusedCode() {
    return new Promise<string>((resolve) => {
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
    })
}

export async function getTemporaryAuthCode(appName: string) {
    const code = await getUnusedCode();
    if (code) {
        temporaryCodeMap[code] = {
            appName
        }
        setTimeout(() => {
            delete temporaryCodeMap[code];
        }, 60 * 1000);
    }
    return code;
}

export function getIsTemporaryAuthCodeValidAndRemove(appName: string, code: string) {
    if (temporaryCodeMap[code]) {
        if (temporaryCodeMap[code].appName === appName) {
            delete temporaryCodeMap[code];
            return true;
        }
    }

    return false;
}

export function createAuthToken(store: ElectronStore<StoreSchema>, appName: string) {
    let authTokens: object[] = [];
    try {
        authTokens = JSON.parse(safeStorage.decryptString(Buffer.from(store.get('integrations').companionServerAuthTokens, 'hex')));
    } catch { /* authTokens will just be an empty array */ }

    const token = crypto.randomBytes(256).toString('hex');
    const tokenId = crypto.randomUUID();
    authTokens.push({
        appName: appName,
        id: tokenId,
        token: crypto.createHash('sha256').update(token).digest('hex')
    });

    store.set('integrations.companionServerAuthTokens', safeStorage.encryptString(JSON.stringify(authTokens)).toString('hex'));

    return token;
}

export function isAuthValid(store: ElectronStore<StoreSchema>, authToken: string) {
    if (!authToken)
        return false;

    const authTokenHash = crypto.createHash('sha256').update(authToken).digest('hex')

    let authTokens: any[] = [];
    try {
        const decryptedAuthTokens = safeStorage.decryptString(Buffer.from(store.get('integrations').companionServerAuthTokens, 'hex'));
        authTokens = JSON.parse(decryptedAuthTokens);
    } catch { /* authTokens will just be an empty array */ }

    let validSession = false;
    for (const authSession of authTokens) {
        if (authSession.token == authTokenHash) {
            validSession = true;
            break;
        }
    }

    if (validSession) {
        return true;
    }

    return false;
}

export function isAuthValidMiddleware(store: ElectronStore<StoreSchema>, request: FastifyRequest, response: FastifyReply, next: HookHandlerDoneFunction) {
    const authToken = request.headers.authorization;
    if (!authToken) {
        response.code(401);
        response.send({
            error: 'UNAUTHORIZED'
        });
        return;
    }

    const validSession = isAuthValid(store, authToken);

    if (validSession) {
        next();
    } else {
        response.code(401);
        response.send({
            error: 'UNAUTHORIZED'
        });
    }
}