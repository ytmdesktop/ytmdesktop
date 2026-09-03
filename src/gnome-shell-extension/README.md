# YTMDesktop mini player

A GNOME Shell panel mini player for YouTube Music Desktop App, and the D-Bus interface it speaks.

The extension is a client. All playback, search, and YouTube Music API work happens in the desktop
app's YTM view; the extension only renders panel UI and sends commands. Anything that can talk to
the D-Bus interface below can replace it.

## Requirements

- GNOME Shell 50 (`metadata.json` declares that version only)
- The desktop app running, so the D-Bus service is on the session bus

## Install

The `.deb` does not install the extension. Install it from a checkout:

```sh
rsync -a --delete \
  src/gnome-shell-extension/ytmdesktop-miniplayer@ytmdesktop/ \
  ~/.local/share/gnome-shell/extensions/ytmdesktop-miniplayer@ytmdesktop/
gnome-extensions enable ytmdesktop-miniplayer@ytmdesktop
```

On Wayland, log out and back in after installing or updating. Disabling and re-enabling the
extension does not reload changed JavaScript.

```sh
gnome-extensions disable ytmdesktop-miniplayer@ytmdesktop     # stop using it
rm -rf ~/.local/share/gnome-shell/extensions/ytmdesktop-miniplayer@ytmdesktop   # remove it
```

## Tray fallback

The app asks GNOME Shell whether this extension is actually enabled, and follows
`ExtensionStateChanged` and `NameOwnerChanged` for as long as it runs.

| Session                              | Panel mini player | Electron tray |
| ------------------------------------ | ----------------- | ------------- |
| GNOME, extension enabled             | yes               | no            |
| GNOME, extension missing or disabled | no                | yes           |
| Non-GNOME Linux                      | no                | yes           |
| Windows, macOS                       | no                | yes           |

A session always ends up with exactly one of the two, and enabling or removing the extension swaps
them without restarting the app. See `src/main/gnome-shell-extension-watcher.ts`.

## D-Bus interface

|             |                                    |
| ----------- | ---------------------------------- |
| Bus         | session                            |
| Name        | `io.github.ytmdesktop.MiniPlayer`  |
| Object path | `/io/github/ytmdesktop/MiniPlayer` |
| Interface   | `io.github.ytmdesktop.MiniPlayer`  |

Implemented in `src/main/linux-mini-player-service.ts`.

### Methods

| Method             | Signature               | Notes                                                                                                                     |
| ------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `GetState`         | `() → s`                | Current player snapshot, as JSON                                                                                          |
| `Command`          | `(s command, d value)`  | See the command table; `value` is ignored where unused                                                                    |
| `Search`           | `(s query)`             | Asynchronous; results arrive on `SearchResultsChanged`. Whitespace is collapsed and the query is capped at 200 characters |
| `PlayResult`       | `(s videoId, s action)` | `action` is `now` or `next`; any other value is ignored                                                                   |
| `ShowMainWindow`   | `()`                    | Restore, show, and focus the main window                                                                                  |
| `ToggleMainWindow` | `()`                    | Show or hide the main window                                                                                              |
| `OpenSettings`     | `()`                    | Open the settings window                                                                                                  |
| `Quit`             | `()`                    | Quit the application                                                                                                      |

### Signals

| Signal                 | Signature         | Notes                                                                             |
| ---------------------- | ----------------- | --------------------------------------------------------------------------------- |
| `StateChanged`         | `(s stateJson)`   | Emitted on real changes, and at most once per second while the position advances  |
| `SearchResultsChanged` | `(s resultsJson)` | Emitted for the most recent `Search` only; earlier in-flight searches are dropped |

### Commands

Unknown commands are ignored, as are out-of-range values.

| `command`                                        | `value`                    |
| ------------------------------------------------ | -------------------------- |
| `previous`, `playPause`, `next`                  | unused                     |
| `toggleLike`, `toggleDislike`, `shuffle`, `mute` | unused                     |
| `startMix`                                       | unused                     |
| `seekTo`                                         | seconds, finite and `>= 0` |
| `setVolume`                                      | `0`–`100`                  |
| `repeatMode`                                     | `0` none, `1` all, `2` one |

### `StateChanged` / `GetState` payload

```jsonc
{
  "version": 1,
  "authenticated": true,
  "status": "playing", // idle | loading | paused | playing | needs-main-app
  "track": {
    // null when nothing is loaded
    "id": "dQw4w9WgXcQ",
    "title": "…",
    "artist": "…",
    "durationSeconds": 213,
    "artworkUrl": "https://…",
    "likeStatus": "indifferent" // like | dislike | indifferent
  },
  "progressSeconds": 41.2,
  "canPlay": true,
  "canPrevious": true,
  "canNext": true,
  "canLike": true, // false when signed out or during an ad; playback is never gated on sign-in
  "likeStatus": "indifferent",
  "repeatMode": "none", // none | all | one
  "volume": 51,
  "muted": false,
  "adPlaying": false,
  "ad": {
    // null unless adPlaying is true; track keeps the song the ad interrupted
    "title": "…", // "Advertisement" when YTM exposes nothing
    "advertiser": "…", // may be null
    "artworkUrl": "https://…", // may be null
    "durationSeconds": 15
  },
  "message": null // human-readable reason when status is not playable
}
```

`authenticated` reports whether a Google account is signed in. It gates only `canLike` — a
signed-out listener still gets ads and free playback, and every transport control stays live.

While `adPlaying` is true, `progressSeconds` is the ad's progress and should be read against
`ad.durationSeconds`. `canNext` stays true — skipping works during ads.

### `SearchResultsChanged` payload

```jsonc
{
  "version": 1,
  "query": "…",
  "status": "ready", // idle | loading | ready | error
  "results": [
    {
      "id": "dQw4w9WgXcQ",
      "title": "…",
      "artist": "…",
      "duration": "3:32", // display string, or null
      "artworkUrl": "https://…",
      "playlistId": "RDAMVM…", // null when the result has no mix
      "kind": "music" // music | video | unknown
    }
  ],
  "message": null
}
```

`kind` is what drives the Music-first and Video-first orderings; the sort is stable, so results
within a group keep the order YouTube Music returned them in.

### Talking to it by hand

```sh
gdbus call --session \
  --dest io.github.ytmdesktop.MiniPlayer \
  --object-path /io/github/ytmdesktop/MiniPlayer \
  --method io.github.ytmdesktop.MiniPlayer.GetState

gdbus call --session \
  --dest io.github.ytmdesktop.MiniPlayer \
  --object-path /io/github/ytmdesktop/MiniPlayer \
  --method io.github.ytmdesktop.MiniPlayer.Command "playPause" 0

gdbus monitor --session --dest io.github.ytmdesktop.MiniPlayer
```

## Start Mix behavior

`startMix` is deliberately not a plain "play the mix" command:

- From a paused state, the mix starts at `0:00`.
- While playing and not already in the mix, the current track keeps its position; the next track
  starts at `0:00`.
- While playing and already in the mix, it does nothing.
- The radio endpoint comes from YouTube Music itself, so a mix started from a song stays on songs
  rather than switching to music videos. Starting one from a music video seeds it from that track's
  song counterpart when there is one.

## Troubleshooting

- **Panel icon missing.** Check that the extension is enabled and that the app is running:
  `gnome-extensions info ytmdesktop-miniplayer@ytmdesktop`, then
  `gdbus introspect --session --dest io.github.ytmdesktop.MiniPlayer --object-path /io/github/ytmdesktop/MiniPlayer`.
- **A tray icon appears instead.** The app could not confirm the extension is enabled, so it fell
  back to the tray. Enabling the extension removes the tray without an app restart.
- **Edits to `extension.js` do nothing.** On Wayland, log out and back in.
- **Extension errors.** `journalctl --user -f -o cat /usr/bin/gnome-shell`, or
  `gnome-extensions info ytmdesktop-miniplayer@ytmdesktop` for the recorded error.
- **App-side logs.** The main process logs through `electron-log`; look for
  `Initialized GNOME mini-player integration` or `Created tray icon` at startup.
