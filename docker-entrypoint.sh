#!/bin/sh
# Start script for the container (see Dockerfile and DEPLOY.md).
# 1. Refuse to start without MCP_BEARER_TOKEN: without it the server accepts
#    every request to /mcp.
# 2. When started as root, make the folder that holds the SQLite file owned by
#    the unprivileged `node` user (a mounted disk may be owned by root), then
#    run the server as `node`.
set -eu

if [ -z "${MCP_BEARER_TOKEN:-}" ]; then
  echo "MCP_BEARER_TOKEN is not set; refusing to start a public server without it." >&2
  exit 1
fi

if [ "$(id -u)" = "0" ]; then
  if [ "${SESSION_STORE:-}" = "sqlite" ] && [ -n "${SESSION_DB_PATH:-}" ]; then
    db_dir=$(dirname "$SESSION_DB_PATH")
    if [ "$db_dir" = "/" ] || [ "$db_dir" = "." ]; then
      echo "SESSION_DB_PATH must be a file inside a folder, e.g. /var/data/sessions.db." >&2
      exit 1
    fi
    mkdir -p "$db_dir"
    chown node:node "$db_dir"
    for f in "$SESSION_DB_PATH" "$SESSION_DB_PATH-wal" "$SESSION_DB_PATH-shm"; do
      if [ -e "$f" ]; then chown node:node "$f"; fi
    done
  fi
  exec setpriv --reuid=node --regid=node --init-groups -- "$@"
fi

exec "$@"
