# The rulebook page

Vault task T27, widened by Zeke on 2026-11-11. The rules should read like a
printed rulebook: what's in the box, the map, setup, a round, worked examples
with pictures, and charts. Plain text alone was hard to find your way around.
Neither Guts nor Gears goes first; the other games follow it.

## Where the parts live

- **The words and the facts**: `src/rulebook.ts`, in the rules half. It is
  plain data with no React. It goes out with the reference data as
  `getReferenceData().rulebook`, next to the unit and treaty lists, the maps
  and the win numbers. Counts that change with the map (Surfs, robot
  collectors, Cores) come from the engine's own functions, one per layout.
- **The page**: `src/glue/rulebook/NggRulebook.tsx`, in the screen half,
  shipped as `@zekel/neither-guts-nor-gears/glue`. It only draws: every word
  and number comes from the reference data. Treaty break times and unit notes
  are printed exactly as the engine words them.
- **The look**: copied from the game's screen in Zekel Universe
  (`apps/web/src/glue/ngg/`). That covers the colors, fonts, tile and faction
  colors, and the icon set (`src/glue/icons.gen.ts`, `src/glue/ink.ts`).
  Wizard parts use the parchment style and robot parts the machined style.
  Until the table screen moves here too, the icons and colors exist in both
  repos: change both together. After the move, this copy is the only one.

## Checks

- `src/__tests__/rulebook.test.ts` compares the rulebook with the engine:
  - the treaty chart against `areMilitaryAllies` and `hasCollectionAccess`
  - the supply counts against the engine's caps
  - the player counts against the map layouts
  - the example's units, and its board corner against the real map.

  It also keeps the screen tests' captured reference data current: run it
  with `UPDATE_FIXTURES=1` after changing anything the reference data carries.
- `src/glue/__tests__/rulebook.test.tsx` draws the page from that captured
  data. It checks that the win numbers, map and counts follow the player
  picker, that treaty and unit text is the engine's, and that every name the
  page draws has an icon.

## Still to do

- Zekel Universe's rules page has to show this page when a game has one, and
  the plain text otherwise. Universe doesn't load any screen from this repo
  yet; that move is in progress on a Universe branch. The page takes the
  reference response Universe already fetches:
  `<NggRulebook reference={reference} />`.
- The worked examples here and the examples in `rulesSections.ts` (the AI's
  rules text) are written separately. When one changes, change the other.
- The other five games.
