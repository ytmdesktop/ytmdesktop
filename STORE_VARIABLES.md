# Store variables

## App
| Key                                   | Type    | Values                       | Default                      | Description             |
| ------------------------------------- | ------- | ---------------------------- | ---------------------------- | ----------------------- |
| `uuid`                                | String  | `unique-id`                  | `unique-id`                  | Unique id for analytics |

## Settings
| Key                                        | Type    | Values                       | Default                      | Description                                                    |
| ------------------------------------------ | ------- | ---------------------------- | ---------------------------- | -------------------------------------------------------------- |
| `settings-page-zoom`                       | String  | `50` ~ `150`                 | `100`                        | Zoom of the main window                                        |
| `settings-keep-background`                 | Boolean | `true` or `false`            | `false`                      | When close main window, keep the player on background          |
| `settings-show-notifications`              | Boolean | `true` or `false`            | `false`                      | Show notifications on desktop when change music                |
| `settings-continue-where-left-of`          | Boolean | `true` or `false`            | `false`                      | When you close and open the app, will return where you stopped |
| `settings-app-language`                    | String  | `en`, `pt`, ...              | `en`                         | Language of the app                                            |
| `settings-discord-rich-presence`           | Boolean | `true` or `false`            | `false`                      | Integration with Discord Rich Presence                         |
| `settings-start-on-boot`                   | Boolean | `true` or `false`            | `false`                      | Open player when system starts                                 |
| `settings-start-minimized`                 | Boolean | `true` or `false`            | `false`                      | Open player minimized in tray                                  |
| `settings-clipboard-read`                  | Boolean | `true` or `false`            | `false`                      | Reads the clipboard for youtube links                          |
| `settings-companion-server`                | Boolean | `true` or `false`            | `false`                      | Companion Server to control the player remotely                |
| `settings-companion-server-protect`        | Boolean | `true` or `false`            | `true`                       | Enable or disable protection of companion                      |
| `settings-companion-server-token`          | String  | `String token`               | GENERATED_TOKEN              | Token to prevent anonymous control of the player               |
| `settings-enable-double-tapping-show-hide` | Boolean | `true` or `false`            | `true`                       | Enable or disable double-tapping to show/hide main window      |
| `settings-app-audio-output`                | String  | `Audio devices`              | DEFAULT_AUDIO_DEVICE         | Define default audio output                                    |
| `settings-custom-css-app`                  | Boolean | `true` or `false`            | `false`                      | Custom css for main app                                        |
| `settings-custom-css-page`                 | Boolean | `true` or `false`            | `false`                      | Custom css for web page                                        |
| `settings-volume`                          | String  | `0` ~ `100`                  | `100`                        | Playback volume                                                |
| `settings-volume-media-keys`               | Boolean | `true` or `false`            | `false`                      | Enable media volume keys for the playback volume               |

## Window
| Key                                   | Type    | Values                       | Default                      | Description                                   |
| ------------------------------------- | ------- | ---------------------------- | ---------------------------- | --------------------------------------------- |
| `window-url`                          | String  | `https://music.youtube.com/` | `https://music.youtube.com/` | YouTube Music Url                             |
| `window-position`                     | Object  | `width` and `heigth`         | `{ width: x, heigth: y }`    | Position of the main window                   |
| `window-maximized`                    | Boolean | `true` or `false`            | `false`                      | Value to define if window is maximized or not |
| `window-size`                         | Object  | `width` and `heigth`         | `{ width: x, heigth: y }`    | Sizes of the main window                      |
| `titlebar-type`                       | String  | `nice` or `system` or `none` | `nice`                       | Type of frame titlebar                        |
