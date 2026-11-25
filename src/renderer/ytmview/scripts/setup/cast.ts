// Runs in YTM's own world, where Google's Cast SDK lives. YTM uses the SDK's chrome.cast API directly (not
// cast.framework), and these scripts run after YTM has called chrome.cast.initialize, so its session listener can't
// be wrapped. What YTM does with every session it adopts, whether from requestSession or from its session listener, is
// call addUpdateListener on it, so that is where this watches. The session is reported to the preload (which hands it
// to main to keep), and once per app start the session a previous run left playing is rejoined with
// chrome.cast.requestSessionById. The SDK delivers a joined session to YTM's session listener, as Chrome's does.

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
  let adopted = false;

  const report = (session: SavedCastSession | null) => {
    saved = session;
    postToPreload({ op: "ytmd-cast-session", session });
  };

  const whenSdkReady = (callback: (cast: any) => void) => {
    const started = Date.now();
    const interval = setInterval(() => {
      const cast = w.chrome?.cast;
      if (cast?.Session?.prototype && cast.requestSessionById) {
        clearInterval(interval);
        callback(cast);
      } else if (Date.now() - started > GIVE_UP_WAITING_MS) {
        clearInterval(interval);
      }
    }, POLL_MS);
  };

  whenSdkReady(cast => {
    const proto = cast.Session.prototype;
    const addUpdateListener = proto.addUpdateListener;
    const seen = new WeakSet<object>();

    proto.addUpdateListener = function (this: any, ...args: unknown[]) {
      try {
        if (!seen.has(this) && typeof this.sessionId === "string" && this.sessionId) {
          seen.add(this);
          adopted = true;
          const session = this;
          report({ sessionId: session.sessionId, appId: session.appId ?? "", deviceName: session.receiver?.friendlyName ?? null });
          // Forget it only when the cast was ended on purpose (Stop). A dropped connection, as when the app quits or
          // is killed, keeps it so the next start rejoins.
          addUpdateListener.call(session, (isAlive: boolean) => {
            if (!isAlive && session.status === cast.SessionStatus.STOPPED && saved?.sessionId === session.sessionId) report(null);
          });
        }
      } catch (err) {
        console.error("[ytmd-err(cast session)]", err);
      }
      return addUpdateListener.apply(this, args);
    };

    window.addEventListener("message", event => {
      if (event.source !== window || event.data?.op !== "ytmd-cast-saved-session" || !event.data.session) return;
      if (adopted) return;
      saved = event.data.session;
      const sessionId = saved!.sessionId;

      // The SDK reports a failed join to no one, so a session that never arrives is how it shows. Clear it only if it
      // is still the one we tried and no session has been adopted since.
      setTimeout(() => {
        if (!adopted && saved?.sessionId === sessionId) report(null);
      }, JOIN_TIMEOUT_MS);

      cast.requestSessionById(sessionId);
    });

    // Asked once the hook is in place, so the joined session is never missed. The preload only answers when casting
    // is enabled.
    postToPreload({ op: "ytmd-cast-request-saved-session" });
  });
}
