# Production image: builds every game in this repo and serves them over HTTP
# with examples/serve.mjs, keeping game sessions in SQLite. See DEPLOY.md.

# Node 24 LTS (the server needs >= 22.13 for the built-in node:sqlite).
ARG NODE_IMAGE=node:24.16.0-bookworm-slim@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203

# ---- build: install from the lockfile exactly, then compile every game ----
FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.6.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build
# Readable by the `node` user that runs the server, whatever permissions the
# checkout had; writable by nobody but root.
RUN chmod -R a+rX,go-w /app

# ---- run ----
FROM ${NODE_IMAGE}
# tini passes Render's stop signal to Node so the server shuts down cleanly.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# The server and the games are root's devDependencies, so the whole installed
# workspace is kept (a --prod install would leave out @zekel/mcp itself).
COPY --from=build --chown=root:root /app /app
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
