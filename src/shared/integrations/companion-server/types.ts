export type AuthToken = {
  appId: string;
  appVersion: string;
  appName: string;
  id: string;
  token: string;
  metadata: {
    version: number;
  };
};
