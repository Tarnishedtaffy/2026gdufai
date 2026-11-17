#!/bin/sh
# 仅在停服并完成离线备份后显式运行；不删除文件、不更改组/其他用户的访问位。
set -eu
if [ "$(id -u)" -ne 0 ]; then
  echo 'Run this maintenance command as root after stopping app and backing up both volumes.' >&2
  exit 1
fi
for directory in /app/data /app/uploads; do
  if [ ! -d "$directory" ] || [ -L "$directory" ]; then
    echo "Expected a mounted directory, not a symlink: $directory" >&2
    exit 1
  fi
done
for directory in /app/data /app/uploads; do
  # 不跟随符号链接；修复 SQLite 文件及 WAL/SHM 所需的属主读写权限。
  chown -hR node:node "$directory"
  find "$directory" -xdev -type d -exec chmod u+rwx {} +
  find "$directory" -xdev -type f -exec chmod u+rw {} +
done
