import createError, { FastifyError } from "@fastify/error";
import { RepeatMode } from "../../../player-state-store";

const errorCodes = [
  "INVALID_VOLUME",
  "INVALID_REPEAT_MODE",
  "INVALID_SEEK_POSITION",
  "INVALID_QUEUE_INDEX",
  "INVALID_CHANGE_REQUEST",
  "UNAUTHENTICATED",
  "AUTHORIZATION_DISABLED",
  "AUTHORIZATION_INVALID",
  "AUTHORIZATION_TIME_OUT",
  "AUTHORIZATION_DENIED",
  "AUTHORIZATION_TOO_MANY",
  "YOUTUBE_MUSIC_UNVAILABLE",
  "YOUTUBE_MUSIC_TIME_OUT"
];

// When adding an error make sure to include its code in the errorCodes array above so the API can return it to the client
export const InvalidVolumeError = createError<[number]>("INVALID_VOLUME", "Volume '%s' is invalid", 400);
export const InvalidRepeatModeError = createError<[RepeatMode]>("INVALID_REPEAT_MODE", "Repeat mode '%s' cannot be set", 400);
export const InvalidPositionError = createError<[number]>("INVALID_SEEK_POSITION", "Seek position '%s' is invalid", 400);
export const InvalidQueueIndexError = createError<[number]>("INVALID_QUEUE_INDEX", "'%s' is an invalid queue index for the current queue", 400);
export const InvalidChangeVideoRequestError = createError<[]>("INVALID_CHANGE_REQUEST", "'videoId', 'playlistId', or both must be provided", 400);
export const UnauthenticatedError = createError<[]>("UNAUTHENTICATED", "Authentication not provided or invalid", 401);
export const AuthorizationDisabledError = createError<[]>("AUTHORIZATION_DISABLED", "Authorization requests are disabled", 403);
export const AuthorizationInvalidError = createError<[]>("AUTHORIZATION_INVALID", "Authorization invalid", 400);
export const AuthorizationTimeOutError = createError<[]>("AUTHORIZATION_TIME_OUT", "Authorization timed out", 504);
export const AuthorizationDeniedError = createError<[]>("AUTHORIZATION_DENIED", "Authorization request denied", 403);
export const AuthorizationTooManyError = createError<[]>("AUTHORIZATION_TOO_MANY", "Too many authorization requests currently active", 503);
export const YouTubeMusicUnavailableError = createError<[]>("YOUTUBE_MUSIC_UNVAILABLE", "YouTube Music is currently unvailable", 503);
export const YouTubeMusicTimeOutError = createError<[]>("YOUTUBE_MUSIC_TIME_OUT", "Response from YouTube Music took too long", 504);

export function isDefinedAPIError(error: FastifyError): boolean {
  if (errorCodes.includes(error.code)) return true;
  return false;
}
