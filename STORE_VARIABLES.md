# Store variables

## App
| Key                                   | Type    | Values                       | Default                      | Description             |
| ------------------------------------- | ------- | ---------------------------- | ---------------------------- | ----------------------- |
| `uuid`                                | String  | `unique-id`                  | `unique-id`                  | Unique id for analytics |

## Settings
| Key                                   | Type    | Values                       | Default                      | Description                                                    |
| ------------------------------------- | ------- | ---------------------------- | ---------------------------- | -------------------------------------------------------------- |
| `settings-page-zoom`                  | String  | `50` ~ `150`                 | `100`                        | Zoom of the main window                                        |
| `settings-keep-background`            | Boolean | `true` or `false`            | `false`                      | When close main window, keep the player on background          |
| `settings-show-notifications`         | Boolean | `true` or `false`            | `false`                      | Show notifications on desktop when change music                |
| `settings-continue-where-left-of`     | Boolean | `true` or `false`            | `false`                      | When you close and open the app, will return where you stopped |
| `settings-app-language`               | String  | `en`, `pt`                   | `en`                         | Language of the app                                            |
| `settings-discord-rich-presence`      | Boolean | `true` or `false`            | `false`                      | Integration with Discord Rich Presence                         |
| `settings-start-on-boot`              | Boolean | `true` or `false`            | `false`                      | Open player when system starts                                 |
| `settings-companion-server`           | Boolean | `true` or `false`            | `false`                      | Companion Server to control the player remotely                |

## Window
| Key                                   | Type    | Values                       | Default                      | Description                                   |
| ------------------------------------- | ------- | ---------------------------- | ---------------------------- | --------------------------------------------- |
| `window-url`                          | String  | `https://music.youtube.com/` | `https://music.youtube.com/` | YouTube Music Url                             |
| `window-position`                     | Object  | `width` and `heigth`         | `{ width: x, heigth: y }`    | Position of the main window                   |
| `window-maximized`                    | Boolean | `true` or `false`            | `false`                      | Value to define if window is maximized or not |
| `window-size`                         | Object  | `width` and `heigth`         | `{ width: x, heigth: y }`    | Sizes of the main window                      |
| `titlebar-type`                       | String  | `nice` or `system` or `none` | `nice`                       | Type of frame titlebar                        |
