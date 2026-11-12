// Neither Guts nor Gears, the screen half (`@zekel/neither-guts-nor-gears/glue`).
// So far this holds the rulebook page only: the game's table screen is still
// in Zekel Universe (apps/web/src/glue/ngg/) and moves here later. Like every
// screen, it imports nothing from the rules half: it draws the reference data
// the game publishes.

export { NggRulebook, type NggRulebookProps } from './rulebook/NggRulebook.js';
export { readRulebook, type RulebookData } from './rulebook/read.js';
