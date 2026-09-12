# Companion Remote protocol v3

The server listens on `ws://<iina-mac>:19190` by default. Frames sent by the IINA API may be exposed to clients as binary UTF-8 data; clients must accept both text and binary WebSocket frames.

Authenticate immediately after connecting:

```json
{"type":"auth","token":"TOKEN_FROM_IINA_SETTINGS","requestId":"1"}
```

Commands use this envelope:

```json
{"type":"command","command":"seek_relative","args":{"seconds":10},"requestId":"2"}
```

Supported commands:

- `play`, `pause`, `toggle_play_pause`, `stop`
- `select_player` (`playerId`, handled by the global controller)
- `controller_visibility` (`operation`: `show`, `hide`, or `toggle`)
- `controller_mode` (`operation`: `full`, `compact`, or `toggle`)
- `set_playback_mode` (`mode`: `none`, `single`, `auto_next`, `playlist_loop`, or `shuffle`)
- `close_window`, `frame_step`, `frame_back_step`, `screenshot` (`mode`)
- `seek_relative` (`seconds`, optional `exact`), `seek_absolute` (`seconds`)
- `set_position_percent` (`percent`)
- `set_volume` (`volume`), `set_mute` (`muted`), `toggle_mute`
- `set_speed` (`speed`)
- `playlist_next`, `playlist_previous`
- `playlist_play` (`index`), `playlist_add` (`url`), `playlist_remove` (`index`), `playlist_clear`, `playlist_shuffle`
- `play_chapter` (`chapter`), `set_loop_file` (`mode`), `set_loop_playlist` (`mode`), `ab_loop`
- `set_track` (`trackType`, `id`), `set_delay` (`trackType`, `seconds`), `set_subtitle_visibility` (`enabled`)
- `set_rotation` (`degrees`), `set_aspect` (`aspect`), `set_video_adjustment` (`property`, `value`)
- `set_minimized` (`enabled`), `show_sidebar` (`sidebar`), `show_osd` (`message`)
- `set_auto_close_on_end` (`enabled`)
- `set_fullscreen` (`enabled`), `toggle_fullscreen`
- `fullscreen_on_screen` (`screen`, one-based display number)
- `set_pip` (`enabled`), `set_ontop` (`enabled`)
- `open` (`url`, optional `startFromBeginning`)

After authentication, the server sends a `library` message containing media files from the folder configured in IINA. A client can request a fresh scan with:

```json
{"type":"refresh_library","requestId":"3"}
```

The server pushes `state` messages. State includes integer `remainingSeconds` and `playbackFinished`. At natural EOF, the plugin publishes `remainingSeconds: 0` and `playbackFinished: true` before optionally closing the player window.

The global server manages multiple IINA playback windows. `state`, `command_result`, and `players`
messages include player identity. Add `playerId` to command args to target a specific window; otherwise
the currently selected/most recently active player is used.
