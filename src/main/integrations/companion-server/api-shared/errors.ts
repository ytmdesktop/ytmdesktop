import createFastifyError, { FastifyError } from "@fastify/error";
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
  "YOUTUBE_MUSIC_TIME_OUT",
  // New error codes
  "NETWORK_ERROR",
  "API_RATE_LIMIT",
  "INTERNAL_SERVER_ERROR",
  "SERVICE_UNAVAILABLE",
  "INVALID_REQUEST_FORMAT",
  "UNSUPPORTED_MEDIA_TYPE",
  "RESOURCE_NOT_FOUND"
];

// When adding an error make sure to include its code in the errorCodes array above so the API can return it to the client
export const InvalidVolumeError = createFastifyError<[number]>("INVALID_VOLUME", "Volume '%s' is invalid", 400);
export const InvalidRepeatModeError = createFastifyError<[RepeatMode]>("INVALID_REPEAT_MODE", "Repeat mode '%s' cannot be set", 400);
export const InvalidPositionError = createFastifyError<[number]>("INVALID_SEEK_POSITION", "Seek position '%s' is invalid", 400);
export const InvalidQueueIndexError = createFastifyError<[number]>("INVALID_QUEUE_INDEX", "'%s' is an invalid queue index for the current queue", 400);
export const InvalidChangeVideoRequestError = createFastifyError<[]>("INVALID_CHANGE_REQUEST", "'videoId', 'playlistId', or both must be provided", 400);
export const UnauthenticatedError = createFastifyError<[]>("UNAUTHENTICATED", "Authentication not provided or invalid", 401);
export const AuthorizationDisabledError = createFastifyError<[]>("AUTHORIZATION_DISABLED", "Authorization requests are disabled", 403);
export const AuthorizationInvalidError = createFastifyError<[]>("AUTHORIZATION_INVALID", "Authorization invalid", 400);
export const AuthorizationTimeOutError = createFastifyError<[]>("AUTHORIZATION_TIME_OUT", "Authorization timed out", 504);
export const AuthorizationDeniedError = createFastifyError<[]>("AUTHORIZATION_DENIED", "Authorization request denied", 403);
export const AuthorizationTooManyError = createFastifyError<[]>("AUTHORIZATION_TOO_MANY", "Too many authorization requests currently active", 503);
export const YouTubeMusicUnavailableError = createFastifyError<[]>("YOUTUBE_MUSIC_UNVAILABLE", "YouTube Music is currently unvailable", 503);
export const YouTubeMusicTimeOutError = createFastifyError<[]>("YOUTUBE_MUSIC_TIME_OUT", "Response from YouTube Music took too long", 504);

// New error types
export const NetworkError = createFastifyError<[string]>("NETWORK_ERROR", "Network error: %s", 503);
export const ApiRateLimitError = createFastifyError<[]>("API_RATE_LIMIT", "API rate limit exceeded, please try again later", 429);
export const InternalServerError = createFastifyError<[string]>("INTERNAL_SERVER_ERROR", "Internal server error: %s", 500);
export const ServiceUnavailableError = createFastifyError<[string]>("SERVICE_UNAVAILABLE", "Service unavailable: %s", 503);
export const InvalidRequestFormatError = createFastifyError<[string]>("INVALID_REQUEST_FORMAT", "Invalid request format: %s", 400);
export const UnsupportedMediaTypeError = createFastifyError<[]>("UNSUPPORTED_MEDIA_TYPE", "Unsupported media type", 415);
export const ResourceNotFoundError = createFastifyError<[string]>("RESOURCE_NOT_FOUND", "Resource not found: %s", 404);

export function isDefinedAPIError(error: FastifyError): boolean {
  if (errorCodes.includes(error.code)) return true;
  return false;
}

// Helper to get a standardized error based on error type
export function getStandardizedError(error: unknown): FastifyError {
  if (error instanceof Error) {
    // Network errors
    if (error.message.includes("ECONNREFUSED") || error.message.includes("ENOTFOUND")) {
      return new NetworkError(error.message);
    }

    // Rate limiting
    if (error.message.includes("rate limit") || error.message.includes("429")) {
      return new ApiRateLimitError();
    }

    // General server error
    return new InternalServerError(error.message);
  }

  // Unknown error type
  return new InternalServerError("Unknown error");
}
