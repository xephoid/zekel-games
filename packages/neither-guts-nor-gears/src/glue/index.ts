// Neither Guts nor Gears, the screen half (`@zekel/neither-guts-nor-gears/glue`).
// Two things live here: the table screen (table/, moved from Zekel Universe's
// apps/web/src/glue/ngg/) with the glue module Universe's table loads, and the
// rulebook page (rulebook/). Like every screen, they import nothing from the
// rules half: they draw the views and reference data the game publishes.
//
// The rulebook was written here first with its own small copies of the
// table's parts (ui.tsx, ink.ts, icons.gen.ts beside this file); the table
// keeps its own under table/. Folding the two sets into one is still to do.

// This entry is what Zekel Universe loads: the table's glue module, and the
// rulebook with it. It needs react-dom (the table's layout uses a portal).
// For the rulebook alone, without react-dom, import ./rulebook instead
// (`@zekel/neither-guts-nor-gears/glue/rulebook`).
export { nggGlue } from './table/index.js';
export { NggRulebook, type NggRulebookProps, readRulebook, type RulebookData } from './rulebook/index.js';
