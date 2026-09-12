# IINA Companion Remote

An IINA plugin that exposes authenticated playback control and live state over WebSocket, intended for a Bitfocus Companion connection module.

## Install

1. Use IINA 1.4.4 or newer on macOS 10.15 or newer.
2. Open the latest `iina-companion-remote-*.iinaplgz` release with IINA.
3. In IINA Settings → Plugins → Companion Remote → Preferences, copy the pairing token.
4. Allow incoming connections for IINA in the macOS firewall prompt.
5. Connect to `ws://<Mac IP address>:19190` from a machine on the same trusted LAN or VPN.

Clients should ask users for the host and port separately. They must add the `ws://` scheme, colon, and IPv6 brackets internally.

Changing the port requires restarting IINA. This release uses unencrypted `ws://`; do not expose the port directly to the public internet.

Version 0.2 can scan a configured media folder and send its file list to Companion. Set **Media Folder** in the plugin preferences, then refresh the media library from Companion.

Version 0.2.1 adds full-screen playback on a selected display. Display numbering follows the order reported by macOS to IINA.

Version 0.3 adds an integer countdown, a reliable playback-finished state, optional close-window-on-finish, and broader playlist, chapter, track, subtitle, video, window, loop, frame, and screenshot controls.

Version 0.4 adds a global controller for multiple IINA player windows. Companion can create or select a
player window, choose its target display, start from the beginning, and select what happens at the end:
keep the window, close it, or loop the file.

## Browser smoke test

Open `tools/test-client.html` in a browser on the IINA Mac, enter the pairing token, connect, and try the buttons. Some browsers expose IINA's UTF-8 response frames as binary blobs; the future Companion module will handle both binary and text frames.

## Development

With IINA installed:

```sh
/Applications/IINA.app/Contents/MacOS/iina-plugin link .
/Applications/IINA.app/Contents/MacOS/iina-plugin pack .
```

See `PROTOCOL.md` for the wire protocol.
