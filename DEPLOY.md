# Running the games server on Render (staging)

The `Dockerfile` at the top of this repo builds every game and serves all of
them over HTTP with `examples/serve.mjs`. Game sessions are kept in a SQLite
file, so they survive restarts and redeploys as long as that file sits on a
Render persistent disk.

## What the image sets

| Setting | Value in the image | What it does |
|---|---|---|
| `MCP_TRANSPORT` | `http` | Serve MCP over HTTP at `/mcp` (instead of stdin/stdout). |
| `SESSION_STORE` | `sqlite` | Keep sessions in a SQLite file (instead of MongoDB). |
| `SESSION_DB_PATH` | `/var/data/sessions.db` | Where that file lives. Must be on the disk. |
| `PORT` | not set | Render sets it; the server listens on it. Without it the server uses 3000. |

The container will not start unless `MCP_BEARER_TOKEN` is set to a token of
at least 32 characters on one line, using only letters, digits and
`- . _ ~ + / =`. Without a token the server lets anyone use `/mcp`. The
length check cannot tell whether a token is random, so always make it with a
random generator (below). The start script never prints the token.
`/healthz` stays open so Render can check the server is up.

## Setting up the Render service

1. New **Web Service** from this GitHub repo. Language: **Docker**. Dockerfile
   path: `./Dockerfile`. Build context: the repo root.
2. **Disk:** add a persistent disk. Mount path: `/var/data`. 1 GB is plenty.
   (A disk ties the service to one running copy. Keep it at one: only one
   server process may use the SQLite file.)
3. **Environment:** add `MCP_BEARER_TOKEN` as a secret. Make a long random
   value yourself, for example with `openssl rand -hex 32`, and paste it only
   into Render and into the MCP client that connects. Never commit it.
   Nothing else needs setting. If you mount the disk somewhere other than
   `/var/data`, also set `SESSION_DB_PATH` to a file inside that folder.
4. **Health check path:** `/healthz`.

## Checking it works

- `https://<service>.onrender.com/healthz` returns
  `{"ok":true,"name":"zekel-games",...}`.
- The deploy log shows `session store: sqlite (/var/data/sessions.db)` and
  `listening on http://0.0.0.0:<port>/mcp (auth=on)`.
- MCP clients connect to `https://<service>.onrender.com/mcp` with the header
  `Authorization: Bearer <the token>`. Without it `/mcp` answers 401.

## Running the image yourself

```sh
docker build -t zekel-games .
# A fresh random token, kept in this shell only. `-e MCP_BEARER_TOKEN` with
# no value passes it from the shell, so it is not typed on the command line.
export MCP_BEARER_TOKEN="$(openssl rand -hex 32)"
docker run --rm -p 3000:3000 -e MCP_BEARER_TOKEN \
  -v zekel-sessions:/var/data zekel-games
```

The build only sees the files `.dockerignore` lets in: the manifests, the
lockfile, each game's `tsconfig.json` and its `src/` (`.ts`, `.md` and `.txt`
files, no tests or hidden files), and the few scripts the build and server
run. Other files in your checkout, tracked or not, stay out of the image. A
stray `.md`, `.txt` or `.ts` file you leave inside a game's `src/` would still
go in, as it would into the npm package. To build from exactly the files git
tracks, ignoring anything untracked:

```sh
git ls-files -z | tar --null -cf - -T - | docker build -t zekel-games -
```

The container starts as root only long enough to give the disk folder to the
`node` user, then runs the server as `node`.
