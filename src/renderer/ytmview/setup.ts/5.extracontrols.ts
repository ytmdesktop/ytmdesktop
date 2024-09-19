import { webFrame } from "electron";
import playerBarControlsScript from "../scripts/playerbarcontrols.script";

export async function createAdditionalPlayerBarControls() {
  (await webFrame.executeJavaScript(playerBarControlsScript))();
}
