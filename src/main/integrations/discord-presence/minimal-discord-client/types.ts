export enum DiscordActivityType {
  Game = 0,
  Streaming = 1,
  Listening = 2,
  Watching = 3,
  Custom = 4,
  Competing = 5
}

export enum DiscordActivityStatusDisplayType {
  Name = 0,
  State = 1,
  Details = 2
}

export type DiscordActivity = {
  type?: DiscordActivityType;
  status_display_type: DiscordActivityStatusDisplayType;
  state?: string;
  state_url?: string;
  details?: string;
  details_url?: string;
  timestamps?: {
    start?: number;
    end?: number;
  };
  assets?: {
    large_image?: string;
    large_text?: string;
    large_url?: string;
    small_image?: string;
    small_text?: string;
    small_url?: string;
  };
  instance?: boolean;
  buttons?: {
    label: string;
    url: string;
  }[];
};
