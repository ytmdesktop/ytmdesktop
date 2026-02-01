export type LastfmRequestBody = {
  method: string;
  timestamp?: number | null;

  artist?: string;
  track?: string;
  album?: string;
  duration?: number;

  format: "json" | "xml";
  api_key: string;
  sk?: string;
  api_sig?: string | null;
  token?: string;
};

export type LastfmErrorResponse = {
  error: number;
  message?: string;
};

export type LastfmSessionResponse = {
  error?: number;
  message?: string;
  session?: {
    name: string;
    key: string;
    subscriber: number;
  };
};

export type LastfmTokenResponse = {
  error?: number;
  message?: string;
  token: string;
};
