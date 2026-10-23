# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Write in plain words — no invented shorthand

Zeke, who owns this repo, can't follow replies full of jargon, much of it made
up on the spot. Treat this as a requirement. It applies to everything he
reads: chat replies, summaries, commit messages and the notes written beside
each game.

- **Use everyday words.** "step" not "work order", "review" not "gate",
  "sent back for fixes" not "fold-back".
- **Never coin a label and then lean on it.** If a thing needs referring to,
  say the plain thing every time.
- **Real names are fine** (files, commands, the runbook steps such as
  post-port, desync, balance). Say what one does the first time it comes up.
- **Say what happened, not what category it belongs to.**
- **Short sentences. Answer first.** What happened, what it means, what's
  next. Detail after.
- **If he asks again, re-say it differently.** A second question means the
  words failed.

## What this repo is

Zekel Games' own games, one npm package each under `packages/<game-id>/`,
for the Zekel MCP server. This repo is **public**.

| Package | Where |
|---|---|
| A game: rules, AI, views, tests | `packages/<game>/src/` |
| The game's extra parts for the tools (balance settings, the rules checker's files) | `packages/<game>/src/dev/`, shipped as `@zekel/<game>/dev` |
| The game's development notes (`PORT-PLAN.md`, `POST-PORT.md`, …) | `packages/<game>/` |

The server, the game interface and the tools live in
[zekel-mcp](https://github.com/xephoid/zekel-mcp) and come from npm:
`@zekel/game-kit` (the `Game` interface and shared game helpers),
`@zekel/mcp` (the server) and `@zekel/dev` (the tools and the runbooks). A
change to one of those is made there and released, then this repo moves to
the new version.

## Commands

- `pnpm install`, `pnpm build` (every game, into each `dist/`), `pnpm test`,
  `pnpm smoke` (serves all games and plays each through the real MCP tools).
- One test file: `pnpm test packages/fractured-fist/src/__tests__/ai.test.ts`.
- The tools, from `@zekel/dev`: `pnpm harness -- --game=<id> --n=<N> --players=<n>[,<n>…]`,
  `pnpm desync-bot`, `pnpm relay-bot`, `pnpm integration-bot`,
  `pnpm verify-hunt`, `pnpm verify-lint`, `pnpm check-summaries`,
  `pnpm choice-catalog`, `pnpm human-seat-sweep`, `pnpm balance-dashboard`,
  `pnpm engine-bot`, `pnpm assistant-bot`, `pnpm llm-bot`, or
  `pnpm tool <command> [args]`. The ones that play games start
  `examples/serve.mjs`, which serves the **built** games: run `pnpm build`
  after changing a game.
- The bots that drive a language model need a local Ollama; the integration
  bot needs LibreChat.

TypeScript is `NodeNext` ESM: imports use `.js` endings though the source is
`.ts`. `strict` and `noUncheckedIndexedAccess` are on.

## Building a game: read the runbooks first

The rules every game follows, and the step-by-step guides from rulebook to
finished game, are `@zekel/dev`'s docs:
`node_modules/@zekel/dev/docs/` (the copy matching the installed tools), also
at [zekel-mcp/packages/dev/docs](https://github.com/xephoid/zekel-mcp/tree/main/packages/dev/docs).

- **`building-a-game.md`** — the rules: physical-first design (sort every
  piece of state by who holds the truth and who may see it, declared at the top
  of `types.ts`), shared decks, `next_step` and its hooks, setup choices belong
  to the player, plain reporting, accepting printed names, the move menu,
  rules teaching (every new game must have it), the game log, pending state
  hygiene, faithful simulation, porting rules, and what "fully playable"
  means. Read it before writing a game.
- **The runbooks**, in order: port-planning → port → post-port →
  ai-development → desync, relay and balance → integration; viz is optional.
  `docs/README.md` there has the order and what each checks. Read the one for
  the step before doing it. A later step run before an earlier one is
  finished mostly reports problems the earlier step would have fixed.

A game is done only when every step except the optional one has passed.

## Rules for this repo

- **A game imports shared code only from `@zekel/game-kit`** (and Node's
  `node:` modules). Never from `@zekel/mcp`, `@zekel/dev`, another game, or
  `scripts/`. Tests may use anything.
- **A game's own code never loads its `src/dev/` folder**, so someone who only
  plays a game doesn't need `@zekel/dev`. `tests/devBoundary.test.ts` checks
  this.
- **This repo is public. Nothing here may copy another publisher's game:** no
  rules text, card or board data, faction or character names, or art. A
  brief mention of another game's title with a one-line lesson is fine.
  Zekel Games' own rulebook texts may be published (the rules checker's pinned
  copies live in `src/dev/verify/`).
- **Adding a game:** a new `packages/<game>/` with its own `package.json`
  (`@zekel/<game>`), then add it to `examples/serve.mjs`, `scripts/dev.ts`
  and, if it has dev hooks, `scripts/devHooks.ts`. Its notes go in its folder.
- **Releasing:** a changed game gets a new version in its `package.json`.
  Zeke publishes to npm.
- **Saved sessions outlive code changes.** Changing a game's state types can
  break sessions people have saved. Add fields with a default on load; anything
  else needs a migration in the server (`building-a-game.md`, "Saved sessions
  outlive code changes").
- **After changing a game's `engine.ts` or `legalMoves.ts`**, if it has a
  rules checker (`src/dev/verify/`), re-run it:
  `pnpm verify-hunt -- --game=<id> --mode=random --games=1000` must report
  nothing, then a hunter batch. A ruling that changes the rules also updates
  the pinned rules text in the same change.
- **AI-vs-AI batches are bug-finders.** A clean batch has zero errored games;
  any `ERR:` is a real bug to look at. Run a batch after changing an AI.
