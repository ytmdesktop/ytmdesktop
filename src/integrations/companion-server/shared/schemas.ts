import { Static, Type } from "@sinclair/typebox";

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
    command: Type.Literal("next")
  }),
  Type.Object({
    command: Type.Literal("previous")
  }),
  Type.Object({
    command: Type.Literal("repeatMode"),
    data: Type.Union([Type.Literal("NONE"), Type.Literal("ALL"), Type.Literal("ONE")])
  })
]);

export type APIV1CommandRequestBodyType = Static<typeof APIV1CommandRequestBody>;
