#!/bin/sh
set -eu

plugin_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
parent_dir=$(dirname -- "$plugin_dir")
output="$parent_dir/iina-companion-remote-0.5.3.iinaplgz"
temporary_zip="$parent_dir/iina-companion-remote-0.5.3.zip"

rm -f "$output" "$temporary_zip"
if [ -x /Applications/IINA.app/Contents/MacOS/iina-plugin ]; then
  (
    cd "$parent_dir"
    /Applications/IINA.app/Contents/MacOS/iina-plugin pack "$(basename -- "$plugin_dir")"
  )
else
  (
    cd "$plugin_dir"
    zip -qr "$temporary_zip" Info.json entries controller.html preferences.html PROTOCOL.md README.md tools
  )
  mv "$temporary_zip" "$output"
fi
echo "$output"
