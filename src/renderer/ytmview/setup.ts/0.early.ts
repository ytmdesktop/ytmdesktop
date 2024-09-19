import { webFrame } from "electron";

export function hookYTMObjects() {
  // This function helps hook YTM
  (async function () {
    (
      await webFrame.executeJavaScript(`
      (function() {
        let ytmdHookedObjects = [];
        
        let decorate = null;
        Object.defineProperty(Reflect, "decorate", {
          set: (value) => {
            decorate = value;
          },
          get: () => {
            return (...args) => {
              if (!window.__YTMD_HOOK__) {
                let obj = args[1];
                if (typeof obj === "object") {
                  ytmdHookedObjects.push(obj);
                }
              }

              return decorate(...args);
            }
          }
        });

        window.__YTMD_HOOK_OBJS__ = ytmdHookedObjects;
      })
    `)
    )();
  })();
}

export async function waitForYTMObjectHooks() {
  await new Promise<void>(resolve => {
    const interval = setInterval(async () => {
      const hooked = (
        await webFrame.executeJavaScript(`
      (function() {
        for (const hookedObj of window.__YTMD_HOOK_OBJS__) {
          if (hookedObj.is) {
            if (hookedObj.is === "ytmusic-app") {
              if (hookedObj.provide) {
                for (const provider of hookedObj.provide) {
                  if (provider.useValue) {
                    if (provider.useValue.store) {
                      let ytmdHook = {
                        ytmStore: provider.useValue.store
                      };
                      Object.freeze(ytmdHook);
                      window.__YTMD_HOOK__ = ytmdHook;
                      break;
                    }
                  }
                }
              }

              if (window.__YTMD_HOOK__) {
                delete window.__YTMD_HOOK_OBJS__;
                return true;
              }
            }
          }
        }
        
        return false;
      })
    `)
      )();

      if (hooked) {
        clearInterval(interval);
        resolve();
      }
    }, 250);
  });
}
