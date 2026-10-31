#!/usr/bin/env bash
set -euo pipefail

version="$(tr -d '\r\n' < .deno-version)"
case "$version" in
  2.9.8) checksum='e890975bc2549807bbcc0b584ffafda72cc7c93349dd99c80483dd784f6c4609' ;;
  *) echo 'Update the reviewed official release digest when changing .deno-version.' >&2; exit 1 ;;
esac
# Source: the digest of deno-x86_64-unknown-linux-gnu.zip in
# https://api.github.com/repos/denoland/deno/releases/tags/v2.9.8
install_dir="$GITHUB_WORKSPACE/.ci-bin"
archive="$RUNNER_TEMP/deno-linux.zip"
mkdir -p "$install_dir"
curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --location \
  --retry 3 --connect-timeout 20 --max-time 180 \
  --output "$archive" \
  "https://github.com/denoland/deno/releases/download/v$version/deno-x86_64-unknown-linux-gnu.zip"
printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check --strict
unzip -oq "$archive" -d "$install_dir"
chmod +x "$install_dir/deno"
printf '%s\n' "$install_dir" >> "$GITHUB_PATH"
"$install_dir/deno" --version
