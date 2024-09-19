import { webFrame } from "electron";
import hookPlayerApiEventsScript from "../scripts/hookplayerapievents.script";

export async function hookPlayerApiEvents() {
  (await webFrame.executeJavaScript(hookPlayerApiEventsScript))();
}

export async function waitForReady() {
  await new Promise<void>(resolve => {
    const interval = setInterval(async () => {
      const playerApiReady: boolean = (
        await webFrame.executeJavaScript(`
        (function() {
          return document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi.isReady();
        })
      `)
      )();

      if (playerApiReady) {
        clearInterval(interval);
        resolve();
      }
    }, 250);
  });
}
