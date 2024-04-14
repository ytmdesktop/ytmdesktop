export type WindowsEventArguments = {
  minimized: boolean;
  maximized: boolean;
  fullscreen: boolean;
};

export type YTMExperimentOverride = {
  [experiment: string]: string;
};
