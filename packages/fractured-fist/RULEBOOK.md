# The rulebook page

Vault task T27, widened by Zeke on 2026-11-11: the rules should read like a
printed rulebook, with what you need, setup, a round, worked examples with
pictures, and the cards. Neither Guts nor Gears went first; this is the
second game.

## Where the parts live

- **The words and the facts**: `src/rulebook.ts`, in the rules half. It is
  plain data with no React. It goes out with the reference data as
  `getReferenceData().rulebook`, next to the card list. Counts (supply sizes,
  the starting deck, the Misstep limit, reloads a turn) come from `cards.ts`.
- **The worked examples** are written as the moves a player makes, with what
  the counters read after each one (actions, damage, defense, spirit, buys,
  refine, Missteps). The strike example gives each side's stamina before and
  after.
- **The page**: `src/glue/rulebook/FfRulebook.tsx`, in the screen half. It is
  in `@zekel/fractured-fist/glue`, and on its own, without react-dom, in
  `@zekel/fractured-fist/glue/rulebook`. It only draws: every word, number and
  card comes from the reference data.
- **The look** is the table's. Card faces use the table's own code
  (`printedCard` in `src/glue/read.ts`) and styles (`ff.css`), and the
  slanted tags, counters, damage and defense chips and VS burst are the
  table's classes. `rulebook.css` only lays the page out. Card pictures are
  named by address (`/cards/fractured-fist/<card>.svg`); the site serves them.

## Checks

- `src/__tests__/rulebook.test.ts` plays each worked example through the real
  engine from its starting hand and checks every counter the page prints. It
  also checks the strike example, the setup numbers and supply counts against
  a new game, that every card is in exactly one group of the card list, and
  that every effect a card can have is explained. It keeps the screen tests'
  captured reference data current: run it with `UPDATE_FIXTURES=1` after
  changing anything the reference data carries.
- `src/glue/__tests__/rulebook.test.tsx` draws the page from that captured
  data: every card once in the list with its printed name and cost, school
  colours, the examples' counters, the strike's stamina, and the effects.

## Still to do

- Zekel Universe's rules page has to show this page when a game has one, and
  the plain text otherwise: `<FfRulebook reference={reference} />`.
- The rulebook's words and `rulesSections.ts` (the AI's rules text) are
  written separately. When one changes, change the other.
- The schools' one-line descriptions come from the AI's notes on how each
  school plays (`ai.ts`). If the designer has printed wording, use that.
