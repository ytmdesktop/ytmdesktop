export enum DiscordActivityType {
  Game = 0,
  Streaming = 1,
  Listening = 2,
  Watching = 3,
  Custom = 4,
  Competing = 5
}

export type DiscordActivity = {
  type?: DiscordActivityType;
  state?: string;
  details?: string;
  timestamps?: {
    start?: number;
    end?: number;
  };
  assets?: {
    large_image?: string;
    large_text?: string;
    small_image?: string;
    small_text?: string;
  };
  instance?: boolean;
  buttons?: {
    label: string;
    url: string;
  }[];
};
