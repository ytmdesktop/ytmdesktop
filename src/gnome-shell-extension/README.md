# YTMDesktop mini player

A GNOME Shell panel mini player for YouTube Music Desktop App, and the D-Bus interface it speaks.

The extension is a client. All playback, search, and YouTube Music API work happens in the desktop
app's YTM view; the extension only renders panel UI and sends commands. Anything that can talk to
the D-Bus interface below can replace it.

## Requirements

- GNOME Shell 50 (`metadata.json` declares that version only)
- The desktop app running, so the D-Bus service is on the session bus

## Manual installation

This PR does not bundle or automatically install the GNOME extension. Distribution and reload
experiments remain the separate proposal in ytmdesktop/ytmdesktop#1805.

```sh
rsync -a --delete \
  src/gnome-shell-extension/ytmdesktop-miniplayer@ytmdesktop/ \
  ~/.local/share/gnome-shell/extensions/ytmdesktop-miniplayer@ytmdesktop/
gnome-extensions enable ytmdesktop-miniplayer@ytmdesktop
```

On Wayland, log out and back in after installing or updating this single-file extension.
The app and extension must use the same version. The app keeps an existing fallback tray until
the attached panel reports the expected version and current session through `ReportPanelReady`.
On startup, it waits up to ten seconds before creating a fallback tray, avoiding a transient icon
that GNOME may cache after its removal. A timeout or missing extension restores the tray.

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
| `GetPanelSession` | `() → s` | JSON containing the expected extension version and fresh readiness session. |
| `ReportPanelReady` | `(u version, s session) → b` | Called after panel attachment, state subscriptions and initial state; false on a stale version/session or timeout. |
| `GetState`         | `() → s`                | Current player snapshot, as JSON                                                                                          |
| `Command`          | `(s command, d value)`  | See the command table; `value` is ignored where unused                                                                    |
| `Search`           | `(s query)`             | Asynchronous; results arrive on `SearchResultsChanged`. Whitespace is collapsed and the query is capped at 200 characters |
| `SearchMusic` | `(s query, s category, s requestKey, s continuation)` | Dedicated Music categories; echoes request identity on `MusicSearchChanged`. |
| `StartResultMix` | `(s videoId)` | Start the cached result radio endpoint and report confirmation on `MixResultChanged`. |
| `AlbumBrowse` | `(s albumId, s continuation)` | Load album tracks in release order. Empty continuation requests the first page. |
| `OpenAlbum` | `(s albumId)` | Open the album in the main app. |
| `PlayNext` | `(s videoId)` | Use a trusted menu action saved by the page and confirm insertion after the current item. |
| `SearchByMode` | `(s query, s mode)` | `music` searches tracks and albums; `video` requests the Videos filter and returns video items only. |
| `PlayResult`       | `(s videoId, s action)` | `action` must be `now`; any other value is ignored                                                                              |
| `ArtistBrowse`     | `(s artistId, s section, s continuation)` | Asynchronous; pages arrive on `ArtistBrowseChanged`. `section` is `""` (the artist page), `songs` or `videos`; empty `continuation` fetches the page, `browse:<id>[:<params>]` / `token:<token>` page through a section's full list |
| `OpenArtist`       | `(s browseId)`          | Show the main window and navigate it to the artist page                                                                  |
| `ShowMainWindow`   | `()`                    | Restore, show, and focus the main window                                                                                  |
| `ToggleMainWindow` | `()`                    | Show or hide the main window                                                                                              |
| `OpenSettings`     | `()`                    | Open the settings window                                                                                                  |
| `Quit`             | `()`                    | Quit the application                                                                                                      |

### Signals

| Signal                 | Signature         | Notes                                                                             |
| ---------------------- | ----------------- | --------------------------------------------------------------------------------- |
| `StateChanged`         | `(s stateJson)`   | Emitted on real changes, and at most once per second while the position advances  |
| `MusicSearchChanged` | `(s resultJson)` | Query, category, requestKey, append flag, status, results, sectionOrder and artistsNext. |
| `MixResultChanged` | `(s resultJson)` | Video ID and loading/ready/error status; title on confirmation, message on error. |
| `AlbumBrowseChanged` | `(s pageJson)` | Album ID, status, name, artworkUrl, items, continuation and optional error message. |
| `PlayNextChanged` | `(s resultJson)` | Video ID and loading/ready/error status; title on success, message on error. |
| `SearchResultsChanged` | `(s resultsJson)` | Emitted for the most recent `Search` or `SearchByMode` only; earlier in-flight searches are dropped |
| `ArtistBrowseChanged`  | `(s artistBrowseJson)` | Emitted for the most recent `ArtistBrowse` only; carries one page, the client appends |

### Commands

Unknown commands are ignored, as are out-of-range values.

| `command`                                        | `value`                    |
| ------------------------------------------------ | -------------------------- |
| `previous`, `playPause`, `next`                  | unused                     |
| `toggleLike`, `toggleDislike`, `shuffle`, `mute` | unused                     |
| `startMix`, `skipAd`                             | unused                     |
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
  "canSkipAd": false, // true once YouTube's own Skip Ad button is clickable
  "likeStatus": "indifferent",
  "repeatMode": "none", // none | all | one
  "volume": 51,
  "muted": false,
  "adPlaying": false,
  "ad": {
    // null unless adPlaying is true; track keeps the song the ad interrupted
    "title": "…", // "Advertisement" when the ad exposes nothing
    "advertiser": "…", // advertiser, else the badge ("Sponsored 1 of 2"); may be null
    "artworkUrl": null, // video ads carry no artwork
    "durationSeconds": 15,
    "skipHint": "You can skip to video in 4" // countdown text, null once skippable
  },
  "message": null // human-readable reason when status is not playable
}
```

`authenticated` reports whether a Google account is signed in. It gates only `canLike` — a
signed-out listener still gets ads and free playback, and every transport control stays live.

## Ad behavior

Ads are read off the page's real player element (`#movie_player`), not the YouTube Music player
API: during an ad that API reports no progress, no state change, and keeps returning the
interrupted song from `getPlayerResponse()`. A `MutationObserver` on the player's `class`
attribute catches the ad starting and ending, and a 500 ms poll runs only while one is showing.

While `adPlaying` is true:

- `progressSeconds` is the ad's progress, read against `ad.durationSeconds`.
- `status` follows the ad's own play state, not the interrupted song's.
- `track` still holds the song the ad interrupted, so playback resumes cleanly — but a client
  should render `ad`, not `track`, or the card will describe something the listener cannot hear.
- `canNext` stays true, and `canSkipAd` turns true once YouTube's Skip Ad button is clickable.
  The `skipAd` command clicks that button.

### `SearchResultsChanged` payload

```jsonc
{
  "version": 1,
  "query": "…",
  "mode": "music", // music | video; legacy Search defaults to music
  "status": "ready", // idle | loading | ready | error
  "results": [
    {
      "id": "dQw4w9WgXcQ",
      "title": "…",
      "artist": "…",
      "duration": "3:32", // display string, or null
      "artworkUrl": "https://…",
      "playlistId": "RDAMVM…", // null when the result has no mix
      "kind": "music", // music | video | artist | album | unknown
      "playCount": null, // parsed display count; approximate, not an exact analytics metric
      "canPlayNext": true, // only when the page supplied a matching menu action
      "albumId": null, // populated for albums
      "artistId": null // UC… browseId for artist results
    }
  ],
  "message": null
}
```

Music uses `SearchMusic(query, category, requestKey, continuation)` with All, Songs, Artists and
Albums. It requests each selected category separately and preserves each API's result order.
All orders sections by exact title/name match, full query inclusion, then partial inclusion;
ties use the mixed response's first matching type and finally Songs, Artists, Albums. Music
excludes videos, podcasts and unknown types. UI/status text is English; returned names are not
translated by the client. Videos retains its existing filtered request, classification and ranking.

`MusicSearchChanged` echoes the query, category and request key. Stale responses are ignored.
Artists initially shows five results; See more reveals ten already fetched items before requesting
continuation. Browse IDs deduplicate artists, and errors preserve the list and continuation for retry.
Category controls remain available during loading, errors and empty results, and survive Back.

Clients should reject responses whose query or mode differs from their current selection. Switching
modes reruns the query, including when the previous result was empty or failed. `Search(query)` is
kept for older clients and uses `music`. Deploy the updated app and extension together: older apps
do not implement `SearchByMode`.

Live signed-out API checks for `Okasian` and `Okasian Spread the Word` returned video results;
the latter included the official upload `Hd3PbHNA98Q`. These API checks do not establish installed
mini-player interaction or playback correctness; those still need an on-device pass.

An artist's `id` is a radio videoId when YouTube Music offers one, otherwise a display-only
`artist:<browseId>` key that must not be sent to `PlayResult`.

### Album browsing and next-track insertion

Album rows open in the panel with the existing Back/Escape navigation, cover, title, track list,
and Open in YTMusic action. Tracks retain release order, including continuation pages; search
ranking never reorders an album. Missing track artwork uses the currently browsed album cover,
including continuation tracks. A thumbnail plays an individual track immediately.

Individual tracks expose Start mix and Play next SVG buttons. Unsupported actions are disabled
with an explanation; a separate scrollbar gutter protects the buttons. `StartResultMix(videoId)`
uses the cached radio endpoint and emits `MixResultChanged` only after confirming its target.
Play next is offered on individual tracks with a page-supplied menu action. The endpoint stays
inside the YTM page in a bounded cache; the panel only sends the video ID. Expired IDs require
searching again. The app serializes requests and rejects duplicates while one is pending.

Calling generic service handlers did not change the queue in the browser reproduction. Using a
connected `ytmusic-menu-service-item-renderer` and its normal `onTap` path did insert a searched
track immediately after the current track; Next then selected that track. The temporary hidden
menu component is removed after dispatch, and the queue itself is never edited directly.

Success requires an observed insertion, unchanged current item and playback state, and a bounded
position change. The panel then shows a single-line, ellipsized `“Title” added to next` message for
three seconds in a reserved status row. Failures are shown as failures, never success toasts. Empty
queues, advertisements, unready playback and stale actions are rejected. The internal YouTube Music
menu API may change; absence of the handler or a five-second confirmation timeout is an error.

The signed-out browser check covered live song insertion and Next selection. Video insertion was
observed, but an advertisement interrupted the paused-state test. The later logged-in song checks
are recorded below; the complete playback matrix, panel controls and layout remain pending. Run
`node scripts/test-mini-player.cjs` for focused parser/ranking/album/queue failure-path checks.

### `ArtistBrowseChanged` payload

```jsonc
{
  "version": 1,
  "artistId": "UC…",
  "section": "", // "" for the artist page, else the section this page belongs to
  "status": "ready", // loading | ready | error
  "name": "…", // artist page only
  "artworkUrl": "https://…", // artist page only
  "songs": [ /* same shape as search results; YouTube Music's own popularity order */ ],
  "videos": [ /* music videos, kind "video" */ ],
  "songsNext": "browse:VL…", // pass back as `continuation` with section "songs"; null at the end
  "videosNext": "browse:MPAD…:params", // same, with section "videos"
  "message": null
}
```

The artist page fills every field. A section page fills only that section's list and its
`…Next` pointer (a `token:` value once paging has started). Each signal carries one page; the
client appends and deduplicates on `id`. Only the most recent `ArtistBrowse` call is answered, and
a new `Search` is expected to drop the artist view on the client side.

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
- **Edits to `extension.js` do nothing.** Reinstall the extension, then log out and back in.
  This PR keeps the single-file entry module. Package updates do not replace the user extension.
  Match its version to the app's expected version and check the Shell log for readiness errors.
- **App-side logs.** The main process logs through `electron-log`; look for
  `Initialized GNOME mini-player integration` or `Created tray icon` at startup.

### Validation (2026-09-05)

The installed-package observations below used the local distribution experiment, not an automatic
installer in this PR. Search, playback and panel behavior use the same feature implementation.

- Local parser/state regression tests cover dedicated filters, strict song types, section ranking,
  API order, hidden artists, continuation, deduplication, stale replies and retry.
- In the connected **logged-in installed Electron session**, current source scripts confirmed
  song insertion while playing and paused, unchanged current track/state/position, and actual Next
  selection. At startup, player API state was -1 with paused media at zero and no ad; the real Play
  button moved both into playback. Unstarted/cued states now explicitly request pressing Play once.
  This observation does not establish the cause of every earlier readiness error.
- Live Music searches returned 20 songs and 20 albums for `소문내`, with Songs first; `Okasian`
  put Artists first and returned seven artists. Its album returned nine ordered tracks without
  track art and a valid album cover. Live artist continuation was unavailable for this example.
- A different-track Start mix confirmed the requested RD playlist. Starting a mix from the current
  track in a QP queue timed out, and is still unresolved; no success is reported in that case.
- Earlier signed-out browser checks are separate evidence, not equivalent login-state coverage.
- After user installation, logs confirmed v42 → v43 and UI readiness at 09:03:55. No GNOME
  JavaScript errors were found in the startup interval. Installed D-Bus search round trips returned
  40 All results for `소문내` (songs/albums only), then 8 Artists, 20 Songs and 10 Albums for
  `Okasian`, each with only its selected type. The user subsequently accepted the panel features and
  limited the remaining work to the stale fallback tray and Dock icon.

### v44 desktop icon fixes

The initial fallback tray is deferred while an enabled panel is waiting for readiness. A readiness
timeout or unavailable extension still creates the fallback. This avoids registering and immediately
destroying a startup StatusNotifierItem, which was observed to leave a cached GNOME icon/menu after
the D-Bus object stopped responding. Existing fallback icons remain until a panel is ready.

`package.json` explicitly sets `desktopName` to `youtube-music-desktop-app.desktop`, matching the
installed launcher and pinned Dock entry. Electron 40.4.0 otherwise derives its Wayland app ID from
the product name, which does not match that file. These two changes do not alter search or playback.
The user confirmed that v44 removed the stale tray and that the rebuilt Debian package restored
the correct Dock icon. The remaining Electron logo was the actual installed pixmap, not merely a window
matching failure: invoking Forge with `--targets=@electron-forge/maker-deb` bypasses this repository's
configured maker instance (named `deb`) and falls back to Electron's default icon.

Build with `yarn make --platform=linux --arch=x64 --targets=deb`. Use `--skip-package` only when the
existing packaged app is known to match current source. Verify the deb's
`usr/share/pixmaps/youtube-music-desktop-app.png` against `src/assets/icons/ytmd.png` before delivery.
Focused startup/timeout tests pass; unrelated features are unchanged.

### v45 reactivation recovery

An extension disabled for longer than the readiness window could later report the correct version
but remain invisible because its app session had expired. Reopening an already-running app did
not replace that session. `GetPanelSession` now starts a fresh bounded handshake when the previous
window has expired, including when timer delivery was delayed during suspension. Pending and ready
sessions remain stable; reports carrying an old session or wrong version still fail. Regression
checks cover hours-late reactivation, delivered timeouts, stale reports and the D-Bus handler.

The local installed-package log confirmed v44 → v45 and UI readiness at 14:16:42 on
2026-09-05 after the user reinstalled and restarted. Long-delay reactivation and stale reports
are covered by the regression harness; a complete lock/unlock cycle was not rerun in this check.
