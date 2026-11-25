// Runs in YTM's own world, where Google's Cast SDK lives. It reports the SDK's session to the preload (which hands it
// to main to keep) and, once per app start, rejoins the session a previous run left playing. Google's SDK adopts a
// session joined with chrome.cast.requestSessionById through the sessionListener CastContext registered, so it
// arrives as SESSION_RESUMED and YTM's own UI picks it up.

const POLL_MS = 500;
const GIVE_UP_WAITING_MS = 2 * 60 * 1000;
const JOIN_TIMEOUT_MS = 15 * 1000;

type SavedCastSession = { sessionId: string; appId: string; deviceName: string | null };

function postToPreload(message: object) {
  window.postMessage({ ...message }, "/");
}

export function initCastSessionPersistence() {
  const w = window as any;
  let saved: SavedCastSession | null = null;
  let rejoinPending = false;

  const whenContextReady = (callback: (context: any) => void) => {
    const started = Date.now();
    const interval = setInterval(() => {
      try {
        const context = w.cast?.framework?.CastContext?.getInstance?.();
        if (context && w.chrome?.cast?.requestSessionById) {
          clearInterval(interval);
          callback(context);
        } else if (Date.now() - started > GIVE_UP_WAITING_MS) {
          clearInterval(interval);
        }
      } catch (err) {
        console.error("[ytmd-err(cast)]", err);
      }
    }, POLL_MS);
  };

  const attemptRejoin = (context: any) => {
    if (!rejoinPending || !saved || context.getCurrentSession()) return;
    rejoinPending = false;
    const sessionId = saved.sessionId;

    // The SDK swallows a failed join, so a session that never arrives is how it shows. Only clear if it is still
    // the one we tried, and nothing else has been joined since.
    setTimeout(() => {
      if (!context.getCurrentSession() && saved?.sessionId === sessionId) postToPreload({ op: "ytmd-cast-session", session: null });
    }, JOIN_TIMEOUT_MS);

    w.chrome.cast.requestSessionById(sessionId);
  };

  window.addEventListener("message", event => {
    if (event.source !== window || event.data?.op !== "ytmd-cast-saved-session" || !event.data.session) return;
    saved = event.data.session;
    rejoinPending = true;

    whenContextReady(context => {
      const states = w.cast.framework.CastState;
      const tryNow = () => {
        if (context.getCastState() !== states.NO_DEVICES_AVAILABLE) attemptRejoin(context);
      };
      context.addEventListener(w.cast.framework.CastContextEventType.CAST_STATE_CHANGED, tryNow);
      tryNow();
    });
  });

  whenContextReady(context => {
    const sessionStates = w.cast.framework.SessionState;
    context.addEventListener(w.cast.framework.CastContextEventType.SESSION_STATE_CHANGED, (event: any) => {
      try {
        switch (event.sessionState) {
          case sessionStates.SESSION_STARTED:
          case sessionStates.SESSION_RESUMED: {
            const session = event.session ?? context.getCurrentSession();
            const sessionObj = session?.getSessionObj?.();
            const sessionId = session?.getSessionId?.();
            if (!sessionId) return;
            const appId = sessionObj?.appId ?? "";
            const deviceName = sessionObj?.receiver?.friendlyName ?? null;
            saved = { sessionId, appId, deviceName };
            rejoinPending = false;
            postToPreload({ op: "ytmd-cast-session", session: saved });
            break;
          }
          case sessionStates.SESSION_ENDED:
            saved = null;
            rejoinPending = false;
            postToPreload({ op: "ytmd-cast-session", session: null });
            break;
        }
      } catch (err) {
        console.error("[ytmd-err(cast session)]", err);
      }
    });
  });

  // Asked after the listener is set up so a SESSION_RESUMED from the rejoin is never missed. The preload only
  // answers when casting is enabled.
  postToPreload({ op: "ytmd-cast-request-saved-session" });
}
