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

The container starts as root only long enough to give the disk folder to the
`node` user, then runs the server as `node`.

## Which files go into the image

The image is built only from the files named in `docker-build-files.txt`.
That list is made from `git ls-files`. The list holds the workspace and
lockfile, each game's `package.json` and `tsconfig.json`, and every tracked
file in each game's `src/` except tests and hidden files.

What that keeps out: a file git doesn't track (an untracked note, key or
`.env` file) stays out of the image even if it sits inside a game's `src/`
with a normal-looking name. This holds as long as `docker-build-files.txt`
and `scripts/docker-copy-inputs.sh` are as committed.

What it does **not** keep out:

- **Anything git tracks, as it is on your disk.** A file you have `git add`ed
  counts as tracked (even before you commit), and a tracked file you have
  edited goes in with your edits. The build copies the bytes in your
  checkout; it does not check them against a commit. Don't build an image
  for sharing from a checkout with private edits.
- **A hand-edited list.** The build reads `docker-build-files.txt` as it is;
  it can't ask git. `pnpm test` fails if the list doesn't match git, but
  `docker build` alone does not run that check.

How the build uses the list:

- The build folder is mounted for one step only; the named files are copied
  out of it and nothing else from it is kept in any image layer.
- The build stops before copying anything if the list names a file that
  isn't there, a path that isn't a plain relative path, or a path that goes
  through a link anywhere along the way (the file itself or any folder above
  it). So a folder swapped for a link can't bring in other files.
- **Uploading is wider than copying.** Docker still sends the build folder,
  minus what `.dockerignore` leaves out, to the builder. Untracked files
  under a game's `src/` are part of that upload and sit in the builder's
  cache, though not in the image. With the normal local Docker that stays on
  your machine; with a remote builder (for example a cloud builder set by
  `docker buildx`) they are sent to that machine.
- **After adding, renaming or removing a game's source file**, add the change
  to git (`git add`), run `pnpm docker-files`, and commit the updated list
  with it. `pnpm test` fails while the list is out of date.
- The build needs BuildKit, Docker's default builder since version 23. The
  old builder (`DOCKER_BUILDKIT=0`) refuses the Dockerfile. Render's Docker
  builds need it too; that has not yet been tried on Render.
