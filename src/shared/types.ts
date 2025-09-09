export type WindowsEventArguments = {
  minimized: boolean;
  maximized: boolean;
  fullscreen: boolean;
  alwaysOnTop: boolean;
};

export enum YTMViewStatus {
  Loading,
  Hooking,
  Ready
}

export enum YTMViewSetupCompletionFlags {
  /**
   * This is an exclusive flag which when set will make all other flags ignored
   */
  LocationNotApplicable = 1,
  Early = 2,
  Styles = 4,
  Navigation = 8,
  Hooks = 16,
  Remote = 32,
  Extras = 64
}
export const AllYTMViewSetupCompletionFlags = (Object.values(YTMViewSetupCompletionFlags) as YTMViewSetupCompletionFlags[]).reduce(
  (prev, curr) => prev | curr,
  0
);
export const YTMViewSetupCompletionFlagsNames = Object.keys(YTMViewSetupCompletionFlags).filter(key => isNaN(Number(key))) as Array<
  keyof typeof YTMViewSetupCompletionFlags
>;

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

export type Constructor<T> = new (...args: unknown[]) => T;
export type DependencyConstructor<T> = Constructor<T> & {
  dependencies: DependencyConstructor<T>[];
};
