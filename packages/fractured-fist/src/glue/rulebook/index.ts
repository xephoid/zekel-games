// The rulebook page on its own (`@zekel/fractured-fist/glue/rulebook`). It
// needs React and the card part, but nothing of the table screen, so it loads
// without react-dom, which the table's layout uses.

export { FfRulebook, type FfRulebookProps } from './FfRulebook.js';
export { readRulebook, type RulebookData } from './read.js';
