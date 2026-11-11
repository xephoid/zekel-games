#!/bin/sh
# Start script for the container (see Dockerfile and DEPLOY.md).
# 1. Refuse to start without a usable MCP_BEARER_TOKEN: without one the server
#    accepts every request to /mcp. The token must be at least 32 characters
#    on one line, using only letters, digits and - . _ ~ + / = (what fits in
#    an HTTP Authorization header; `openssl rand -hex 32` gives 64 such
#    characters). Length is not proof the token is random: make it with a
#    random generator. The token's value is never printed.
# 2. When started as root, make the folder that holds the SQLite file owned by
#    the unprivileged `node` user (a mounted disk may be owned by root), then
#    run the server as `node`.
set -eu

MIN_TOKEN_LENGTH=32
token_chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._~+/=-'
token_help="Make one with: openssl rand -hex 32"
if [ -z "${MCP_BEARER_TOKEN:-}" ]; then
  echo "MCP_BEARER_TOKEN is not set; refusing to start a public server without it. $token_help" >&2
  exit 1
fi
case "$MCP_BEARER_TOKEN" in
  *[!"$token_chars"]*)
    echo "MCP_BEARER_TOKEN has a character that is not allowed (a space, a line break, or something other than letters, digits and - . _ ~ + / =); refusing to start. $token_help" >&2
    exit 1
    ;;
esac
if [ "${#MCP_BEARER_TOKEN}" -lt "$MIN_TOKEN_LENGTH" ]; then
  echo "MCP_BEARER_TOKEN is shorter than $MIN_TOKEN_LENGTH characters; refusing to start. $token_help" >&2
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
