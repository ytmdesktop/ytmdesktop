import { MemoryStoreSchema, StoreSchema } from "~shared/store/schema";

/** Valid configurable shortcut from the schema. */
export type ShortcutId = keyof StoreSchema["shortcuts"];

/**
 * Shortcuts Definitions
 * Defines the shortcuts.
 * @author Akiisqt <aki@devours.rocks>
 */
export default class ShortcutDefinitions {
  /** Play/pause the current track. */
  public static readonly PLAYPAUSE = new ShortcutDefinitions("playPause", "playPause", "shortcutsPlayPauseRegisterFailed", "media-play-pause");

  /** Play the next track. */
  public static readonly NEXT = new ShortcutDefinitions("next", "next", "shortcutsNextRegisterFailed", "media-track-next");

  /** Play the previous track. */
  public static readonly PREVIOUS = new ShortcutDefinitions("previous", "previous", "shortcutsPreviousRegisterFailed", "media-track-previous");

  /** Toggle like of current track. */
  public static readonly THUMBS_UP = new ShortcutDefinitions("thumbsUp", "toggleLike", "shortcutsThumbsUpRegisterFailed", "media-track-like");

  /** Toggle dislike of current track. */
  public static readonly THUMBS_DOWN = new ShortcutDefinitions("thumbsDown", "toggleDislike", "shortcutsThumbsDownRegisterFailed", "media-track-dislike");

  /** Increase the media volume. */
  public static readonly VOLUME_UP = new ShortcutDefinitions("volumeUp", "volumeUp", "shortcutsVolumeUpRegisterFailed", "media-volume-up");

  /** Decrease the media volume. */
  public static readonly VOLUME_DOWN = new ShortcutDefinitions("volumeDown", "volumeDown", "shortcutsVolumeDownRegisterFailed", "media-volume-down");

  /**
   * All shortcut definitions.
   */
  public static readonly all: readonly ShortcutDefinitions[] = [
    ShortcutDefinitions.PLAYPAUSE,
    ShortcutDefinitions.NEXT,
    ShortcutDefinitions.PREVIOUS,
    ShortcutDefinitions.THUMBS_UP,
    ShortcutDefinitions.THUMBS_DOWN,
    ShortcutDefinitions.VOLUME_UP,
    ShortcutDefinitions.VOLUME_DOWN
  ];

  /**
   * Creates a shortcut definition.
   * @param id - The shortcut's identifier in the configuration store
   * @param command - The command sent to the webContents
   * @param key - The memory-store key used to track failures with registrating
   * @param v1Name  - The shortcut's legacy v1 configuration name
   */
  private constructor(
    public readonly id: ShortcutId,
    public readonly command: string,
    public readonly key: keyof MemoryStoreSchema,
    public readonly v1Name: string
  ) {}
}
