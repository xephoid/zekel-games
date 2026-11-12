// The rulebook page on its own (`@zekel/neither-guts-nor-gears/glue/rulebook`).
// It needs React and nothing of the table screen, so it loads without
// react-dom, which the table's layout uses.

export { NggRulebook, type NggRulebookProps } from './NggRulebook.js';
export { readRulebook, type RulebookData } from './read.js';
