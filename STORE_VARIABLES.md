# Store variables

## App
| Key                                   | Type    | Values                       | Default                      | Description             |
| ------------------------------------- | ------- | ---------------------------- | ---------------------------- | ----------------------- |
| `uuid`                                | String  | `unique-id`                  | `unique-id`                  | Unique id for analytics |

## Settings
| Key                                        | Type    | Values                       | Default                      | Description                                                                          |
| ------------------------------------------ | ------- | ---------------------------- | ---------------------------- | -------------------------------------------------------------------------------------|
| `settings-app-audio-output`                | String  | `Audio devices`              | DEFAULT_AUDIO_DEVICE         | Define default audio output                                                          |
| `settings-app-language`                    | String  | `en`, `pt`, ...              | `en`                         | Language of the app                                                                  |
| `settings-clipboard-read`                  | Boolean | `true` or `false`            | `false`                      | Reads the clipboard for youtube links                                                |
| `settings-custom-css-app`                  | Boolean | `true` or `false`            | `false`                      | Custom css for main app                                                              |
| `settings-companion-server`                | Boolean | `true` or `false`            | `false`                      | Companion Server to control the player remotely                                      |
| `settings-companion-server-protect`        | Boolean | `true` or `false`            | `true`                       | Enable or disable protection of companion                                            |
| `settings-companion-server-token`          | String  | `String token`               | GENERATED_TOKEN              | Token to prevent anonymous control of the player                                     |
| `settings-continue-where-left-of`          | Boolean | `true` or `false`            | `false`                      | When you close and open the app, will return where you stopped                       |
| `settings-custom-css-page`                 | Boolean | `true` or `false`            | `false`                      | Custom css for web page                                                              |
| `settings-decibel-volume`                  | Boolean | `true` or `false`            | `true`                       | Replace the volume control with a decibel based system                               |
| `settings-disable-analytics`               | Boolean | `true` or `false`            | `false`                      | Disables the Analytics which the Application sends to Google Analytics               |
| `settings-discord-rich-presence`           | Boolean | `true` or `false`            | `false`                      | Integration with Discord Rich Presence                                               |
| `settings-enable-double-tapping-show-hide` | Boolean | `true` or `false`            | `true`                       | Enable or disable double-tapping to show/hide main window                            |
| `settings-enable-player-bgcolor`           | Boolean | `true` or `false`            | `false`                      | Enable or disable setting the background of the player to the color of the cover art |
| `settings-genius-auth-server`              | Boolean | `true` or `false`            | `false`                      | Turns off the authentication server & Genius lyrics provider                         |
| `settings-lyrics-always-top`               | Boolean | `true` or `false`            | `false`                      | Always show lyrics window on top                                                     |
| `settings-lyrics-provider`                 | String  | ?                            | 1                            | Lyrics provider - Not entirely sure how this is implemented                          |
| `settings-miniplayer-always-top`           | Boolean | `true` or `false`            | `false`                      | Always show miniplayer on top                                                        |
| `settings-miniplayer-resizeable`           | Boolean | `true` or `false`            | `false`                      | Make miniplayer resizable or not                                                     |
| `settings-miniplayer-show-task`            | Boolean | `true` or `false`            | `false`                      | Hide from task bar                                                                   |
| `settings-miniplayer-size`                 | String  |  Value represented by px     | `200`                        | Size of miniplayer                                                                   |
| `settings-page-zoom`                       | String  | `50` ~ `150`                 | `100`                        | Zoom of the main window                                                              |
| `settings-keep-background`                 | Boolean | `true` or `false`            | `false`                      | When close main window, keep the player on background                                |
| `settings-show-notifications`              | Boolean | `true` or `false`            | `false`                      | Show notifications on desktop when change music                                      |
| `settings-start-minimized`                 | Boolean | `true` or `false`            | `false`                      | Open player minimized in tray                                                        |
| `settings-start-on-boot`                   | Boolean | `true` or `false`            | `false`                      | Open player when system starts                                                       |
| `settings-volume`                          | String  | `0` ~ `100`                  | `100`                        | Playback volume                                                                      |
| `settings-volume-media-keys`               | Boolean | `true` or `false`            | `false`                      | Enable media volume keys for the playback volume                                     |
| `settings-pause-on-suspend`                | Boolean | `true` or `false`            | `false`                      | Pause media playback on `suspend` event triggered                                    |
| `settings-surround-sound`                  | Boolean | `true` or `false`            | `false`                      | Enable Chromium Flag "try-supported-channel-layouts" for surround sound/Speaker Fill |

## Window
| Key                                   | Type    | Values                       | Default                      | Description                                   |
| ------------------------------------- | ------- | ---------------------------- | ---------------------------- | --------------------------------------------- |
| `titlebar-type`                       | String  | `nice` or `system` or `none` | `nice`                       | Type of frame titlebar                        |
| `window-url`                          | String  | `https://music.youtube.com/` | `https://music.youtube.com/` | YouTube Music Url                             |
| `window-position`                     | Object  | `width` and `heigth`         | `{ width: x, heigth: y }`    | Position of the main window                   |
| `window-maximized`                    | Boolean | `true` or `false`            | `false`                      | Value to define if window is maximized or not |
| `window-size`                         | Object  | `width` and `heigth`         | `{ width: x, heigth: y }`    | Sizes of the main window                      |

## Variables
| Key                                   | Type    | Values                         | Default                      | Description                                   |
| ------------------------------------- | ------- | ------------------------------ | ---------------------------- | --------------------------------------------- |
| `genius-auth`                         | Object  | `access_token` and `token_type`| empty                        | Authorization token & type to make requests   |
