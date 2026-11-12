// Neither Guts nor Gears, the screen half (`@zekel/neither-guts-nor-gears/glue`).
// Two things live here: the table screen (table/, moved from Zekel Universe's
// apps/web/src/glue/ngg/) with the glue module Universe's table loads, and the
// rulebook page (rulebook/). Like every screen, they import nothing from the
// rules half: they draw the views and reference data the game publishes.
//
// The rulebook was written here first with its own small copies of the
// table's parts (ui.tsx, ink.ts, icons.gen.ts beside this file); the table
// keeps its own under table/. Folding the two sets into one is still to do.

export { NggRulebook, type NggRulebookProps } from './rulebook/NggRulebook.js';
export { readRulebook, type RulebookData } from './rulebook/read.js';
export { nggGlue } from './table/index.js';
