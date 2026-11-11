# Production image: builds every game in this repo and serves them over HTTP
# with examples/serve.mjs, keeping game sessions in SQLite. See DEPLOY.md.
#
# The image is built only from the files named in docker-build-files.txt,
# a list made from `git ls-files` (scripts/docker-build-files.mjs; the tests
# fail if it is out of date). The build folder is mounted for one step, the
# listed files are copied out of it (never through a link), and nothing else
# from it is saved in any layer. So untracked files in a local checkout stay
# out of the image, whatever they are named, as long as the list and the copy
# script are as committed. Tracked files go in as they are on disk, edits
# included. DEPLOY.md has the details. Needs BuildKit (Docker's default
# builder since version 23) for the mount.

# Node 24 LTS (the server needs >= 22.13 for the built-in node:sqlite).
ARG NODE_IMAGE=node:24.16.0-bookworm-slim@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203

# ---- build: install from the lockfile exactly, then compile every game ----
FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.6.0 --activate
RUN --mount=type=bind,target=/ctx \
    sh /ctx/scripts/docker-copy-inputs.sh /ctx /app
RUN pnpm install --frozen-lockfile && pnpm build
# Keep only what the server runs: the installed packages, each game's
# package.json and dist/. Readable by the `node` user, writable only by root.
RUN mkdir /out \
 && cp -a node_modules package.json examples /out/ \
 && for p in packages/*/; do \
      mkdir -p "/out/$p" \
      && cp -a "$p/package.json" "$p/dist" "/out/$p" \
      && if [ -d "$p/node_modules" ]; then cp -a "$p/node_modules" "/out/$p"; fi; \
    done \
 && chmod -R a+rX,go-w /out

# ---- run ----
FROM ${NODE_IMAGE}
# tini passes Render's stop signal to Node so the server shuts down cleanly.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# The server and the games are root's devDependencies, so the whole installed
# workspace is kept (a --prod install would leave out @zekel/mcp itself).
COPY --from=build --chown=root:root /out /app
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    SESSION_STORE=sqlite \
    SESSION_DB_PATH=/var/data/sessions.db
# PORT is deliberately not set: Render supplies it (the server falls back to 3000).

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "examples/serve.mjs"]
