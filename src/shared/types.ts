export type WindowsEventArguments = {
  minimized: boolean;
  maximized: boolean;
  fullscreen: boolean;
};

export enum YTMViewStatus {
  Loading,
  Hooking,
  Ready
}

export enum YTMViewSetupCompletionFlags {
  None = 0,
  Early = 1,
  Styles = 2,
  Navigation = 4,
  Chromecast = 8,
  Hooks = 16,
  ExtraControls = 32,
  Extras = 64,
  Remote = 128
}

export type Paths<T> = T extends object
  ? { [K in keyof T]: Exclude<K, symbol> extends string ? `${Exclude<K, symbol>}${"" | `.${Paths<T[K]>}`}` : never }[keyof T]
  : never;
export type ValueAtPath<T, P extends string> = P extends `${infer K}.${infer Rest}`
  ? K extends keyof T
    ? ValueAtPath<T[K], Rest>
    : never
  : P extends keyof T
    ? T[P]
    : never;
