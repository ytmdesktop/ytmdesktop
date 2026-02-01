import { LastfmRequestBody, LastfmSessionResponse } from "./schemas";
import crypto from "crypto";

/**
 * Creates a request body for Last.fm API
 * @param params Data to be sent to the API
 * @returns URLSearchParams object ready to be sent
 */
export function createBody(params: Partial<LastfmRequestBody>) {
  const data = new URLSearchParams();
  for (const key in params) {
    const value = params[key as keyof LastfmRequestBody];
    if (value === null || value === undefined) {
      continue;
    }

    data.append(key, value.toString());
  }
  return data;
}

/**
 * Create a Signature for the Last.fm API
 * @see {@link https://www.last.fm/api/authspec#_8-signing-calls} for details on how to create the signature
 * @param params Data to be signed
 * @param secret Secret key
 * @returns Signature for the data
 */
export function createApiSig(params: Partial<LastfmRequestBody>, secret: string) {
  const keys = Object.keys(params).sort();
  const data = [];

  for (const key of keys) {
    // Ignore format and callback parameters
    if (key === "format" || key === "callback") {
      continue;
    }

    const value = params[key as keyof LastfmRequestBody];
    if (!value) {
      continue;
    }

    data.push(`${key}${value.toString()}`);
  }

  data.push(secret);
  return md5(data.join(""));
}

/**
 * Format the data to be sent to the Last.fm API as a query string
 * @param params data to send
 * @param api_sig signature to append to the data
 * @returns URL encoded query string to be used in the request
 */
export function createQueryString(params: LastfmRequestBody, api_sig: string) {
  const data = [];
  params.api_sig = api_sig;

  for (const key in params) {
    const value = params[key as keyof LastfmRequestBody];
    if (!value) {
      continue;
    }

    data.push(`${encodeURIComponent(key)}=${encodeURIComponent(value.toString())}`);
  }
  return data.join("&");
}

/**
 * Get a session from Last.fm API
 * @param params API parameters
 * @param secret Secret key
 * @returns The response from the API
 */
export async function getSession(params: LastfmRequestBody, secret: string) {
  const api_sig = createApiSig(params, secret);
  const response = await fetch(`https://ws.audioscrobbler.com/2.0/?${createQueryString(params, api_sig)}`);
  return (await response.json()) as LastfmSessionResponse;
}

function md5(string: string): string {
  return crypto.createHash("md5").update(string).digest("hex");
}
