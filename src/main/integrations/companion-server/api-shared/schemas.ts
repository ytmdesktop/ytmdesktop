import { Static, Type } from "@sinclair/typebox";
import { RepeatMode } from "../../../player-state-store";

export const APIV1CommandRequestBody = Type.Union([
  Type.Object({
    command: Type.Literal("playPause")
  }),
  Type.Object({
    command: Type.Literal("play")
  }),
  Type.Object({
    command: Type.Literal("pause")
  }),
  Type.Object({
    command: Type.Literal("volumeUp")
  }),
  Type.Object({
    command: Type.Literal("volumeDown")
  }),
  Type.Object({
    command: Type.Literal("setVolume"),
    data: Type.Number({
      minimum: 0,
      maximum: 100
    })
  }),
  Type.Object({
    command: Type.Literal("mute")
  }),
  Type.Object({
    command: Type.Literal("unmute")
  }),
  Type.Object({
    command: Type.Literal("seekTo"),
    data: Type.Number({
      minimum: 0
    })
  }),
  Type.Object({
    command: Type.Literal("next")
  }),
  Type.Object({
    command: Type.Literal("previous")
  }),
  Type.Object({
    command: Type.Literal("repeatMode"),
    data: Type.Enum(RepeatMode)
  }),
  Type.Object({
    command: Type.Literal("shuffle")
  }),
  Type.Object({
    command: Type.Literal("playQueueIndex"),
    data: Type.Number({
      minimum: 0
    })
  }),
  Type.Object({
    command: Type.Literal("changeVideo"),
    data: Type.Object({
      videoId: Type.Optional(Type.String()),
      playlistId: Type.Optional(Type.String())
    })
  }),
  Type.Object({
    command: Type.Literal("toggleLike")
  }),
  Type.Object({
    command: Type.Literal("toggleDislike")
  })
]);
export type APIV1CommandRequestBodyType = Static<typeof APIV1CommandRequestBody>;

export const APIV1RequestCodeBody = Type.Object({
  appId: Type.String({
    format: "regex",
    pattern: "^[a-z0-9_\\-]{2,32}$"
  }),
  appName: Type.String({
    format: "regex",
    pattern: "^[\\w\\W]{2,48}$"
  }),
  appVersion: Type.String({
    format: "regex",
    pattern:
      "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-((?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$"
  })
});
export type APIV1RequestCodeBodyType = Static<typeof APIV1RequestCodeBody>;

export const APIV1RequestTokenBody = Type.Object({
  appId: Type.String({
    format: "regex",
    pattern: "^[a-z0-9_\\-]{2,32}$"
  }),
  code: Type.String({
    format: "regex",
    pattern: "^[0-9]{4}$"
  })
});
export type APIV1RequestTokenBodyType = Static<typeof APIV1RequestTokenBody>;
