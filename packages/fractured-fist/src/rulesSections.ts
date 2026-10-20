// Sectioned rules for Fractured Fist (docs/rules-teaching.md). getRulesText()
// derives from these (renderRulesText), so the blob and the sections are one
// source. Every move type in the moveSchema is governed by at least one
// section — locked by __tests__/rulesTeaching.test.ts.
//
// The rules describe THIS implementation, which follows the React app
// (antigravity-fist-and-form, the designer's current version). Where the
// older written rules document (FRACTURED-FIST-RULES.md, 2025-12-15) differs,
// POST-PORT.md §11 records each difference and which version this follows.
// Session-dependent numbers (starting stamina, hand size, the loadout) are
// never recited here — they are read from this session's get_state.

import type { RuleSection } from '@zekel/game-kit';
import { FOCUS_RELOADS_PER_TURN, MAX_MISSTEPS, RESOURCE_SUPPLY_COUNT, TECHNIQUE_SUPPLY_COUNT } from './cards.js';

export const FF_RULE_SECTIONS: RuleSection[] = [
  {
    id: 'overview',
    title: 'Fractured Fist: the goal',
    text:
      'A two-player deck-building fight. Reduce your opponent\'s stamina to 0 or less. The game is ' +
      'played in rounds: each player takes one turn, in seat order, and then both players\' queued ' +
      'damage and defense resolve at once in the strike. get_legal_moves is the only authority on ' +
      'what is legal right now; when a move you expect is missing, its reason is listed under ' +
      'unavailable_moves.',
    tags: {},
  },
  {
    id: 'setup',
    title: 'Setup',
    text:
      `Each player has their OWN supply: ${TECHNIQUE_SUPPLY_COUNT} copies of each technique in this ` +
      `game's loadout, plus ${RESOURCE_SUPPLY_COUNT} each of Focus, Momentum and Mastery. Buying from ` +
      'your supply never touches your opponent\'s. Each player shuffles a starting deck of 7 Focus and ' +
      '3 Missteps and draws a hand. Starting stamina and hand size are set per session — read ' +
      'max_stamina and starting_hand_size from get_state.',
    tags: {},
  },
  {
    id: 'turn-structure',
    title: 'A turn: Technique phase, then Channel phase, then cleanup',
    text:
      'Your turn has three parts in order. Technique phase: play technique cards. Channel phase: play ' +
      'resource cards for spirit and buy cards. Cleanup: when you end your turn, discard the rest of ' +
      'your hand and draw a new hand. You may move on from the Technique phase to the Channel phase ' +
      '(advance_phase), or end your turn straight from the Technique phase and skip channeling. You ' +
      'cannot go back to the Technique phase once you are channeling.',
    tags: { move_types: ['advance_phase', 'end_turn'], phases: ['technique', 'channel'] },
  },
  {
    id: 'technique-phase',
    title: 'Technique phase and actions',
    text:
      'You start each turn with 1 action. Playing a technique card uses 1 action, and techniques can ' +
      'only be played in the Technique phase. A technique\'s effects happen immediately, in the order ' +
      'you play them, so a card that grants more actions (printed "+N Tech") lets you play more ' +
      'techniques this turn. Played cards stay face up in front of you until the strike, then go to ' +
      'your discard pile. Misstep cards can never be played. Example: with 1 action you play React ' +
      '(+2 Tech) — that uses your 1 action and gives you 2 more. You then play Attack (+1 Damage) and ' +
      'Block (+1 Defense), using both, so you have queued 1 damage and 1 defense for the strike. With ' +
      'no actions left, you advance_phase to the Channel phase. (A card\'s printed cost is only what ' +
      'it takes to buy it; playing any technique costs 1 action.)',
    tags: { move_types: ['play_card'], phases: ['technique'] },
  },
  {
    id: 'card-effects',
    title: 'What each card effect means',
    text:
      'Damage: added to the damage you deal in this round\'s strike. Defense: subtracted from the ' +
      'damage your opponent deals you in this round\'s strike. Tech: that many more actions this turn. ' +
      'Draw: draw that many cards right now. Spirit: that much spirit to spend in this turn\'s Channel ' +
      'phase. Channel: you may buy that many more cards this turn. Refine: you may remove that many ' +
      'cards from your hand from the game, right now. Missteps: put that many Misstep cards into your ' +
      `opponent's discard pile (never more than ${MAX_MISSTEPS} Missteps in any player's deck, hand and ` +
      'discard pile combined). Heal: regain that much stamina, never above your starting stamina.',
    tags: { move_types: ['play_card'] },
  },
  {
    id: 'channel-phase',
    title: 'Channel phase: spirit and buying',
    text:
      'In the Channel phase you play resource cards from your hand for spirit: Focus is worth 1, ' +
      'Momentum 2, Mastery 3. Spirit from techniques played this turn adds to it. To buy (channel) a ' +
      'card, spend spirit equal to its cost; it goes into your discard pile. Leftover spirit stays ' +
      'available for another buy this turn, and is lost when your turn ends. You may buy 1 card per ' +
      'turn, plus 1 more for each Channel effect you played. Resource cards can only be played in the ' +
      'Channel phase.',
    tags: { move_types: ['play_card', 'buy_card'], phases: ['channel'] },
  },
  {
    id: 'refine',
    title: 'Refining',
    text:
      'When you play a card with Refine, you may immediately remove up to that many cards from your ' +
      'hand from the game, one at a time — they are gone for good, not discarded. This is how you get ' +
      'rid of Missteps. You must finish refining, or skip the rest (skip_refine), before you do ' +
      'anything else. A player holding physical cards says whether each refined card was a Misstep, ' +
      'so the server can keep their Misstep count right.',
    tags: { move_types: ['refine_card', 'skip_refine'] },
  },
  {
    id: 'missteps',
    title: 'Missteps',
    text:
      'Misstep cards do nothing and can never be played. Your starting deck has 3. Your opponent adds ' +
      'more to your discard pile with cards like Distract. The only way to get rid of a Misstep is to ' +
      `refine it. A player can never have more than ${MAX_MISSTEPS} Missteps in their deck, hand and ` +
      'discard pile combined; extra Missteps sent past that limit are not added.',
    tags: { move_types: ['refine_card'] },
  },
  {
    id: 'focus-reload',
    title: 'Focus reload (the catch-up rule)',
    text:
      'If your stamina is LOWER than your opponent\'s, you may discard every Focus card in your hand ' +
      `and draw that many cards. You may do this up to ${FOCUS_RELOADS_PER_TURN} times per turn, in ` +
      'either phase, but not while you still have refines to use. A player holding physical cards ' +
      'says how many Focus cards they discarded.',
    tags: { move_types: ['focus_reload'] },
  },
  {
    id: 'cleanup',
    title: 'Ending your turn (cleanup)',
    text:
      'When you end your turn, discard the rest of your hand and draw a new hand. If your deck runs ' +
      'out while drawing, draw what is left, shuffle your discard pile to make a new deck, and draw ' +
      'the rest. Cards you played stay in front of you until the strike. You cannot end your turn ' +
      'while you still have refines to use or skip. Example: you played Attack and Focus and still ' +
      'hold a Misstep and a Momentum. Ending your turn puts the Misstep and Momentum in your discard ' +
      'pile and you draw a new hand; Attack and Focus stay face up in front of you, and go to your ' +
      'discard pile after the strike.',
    tags: { move_types: ['end_turn'] },
  },
  {
    id: 'strike',
    title: 'The strike (end of round)',
    text:
      'After both players have taken a turn, both players deal damage at the same time. Each player ' +
      'deals their queued damage minus the opponent\'s queued defense (never below 0), and loses the ' +
      'damage dealt to them from their stamina. A player at 0 stamina or less is defeated and the ' +
      'other player wins; if both reach 0 or less together, the game is a tie. Otherwise all played ' +
      'cards go to their owners\' discard piles, actions, channels and spirit reset, and the next ' +
      'round starts with the first player. Example: you queued 3 damage and 1 defense; your opponent ' +
      'queued 2 damage and 2 defense. You deal 3 - 2 = 1, so they lose 1 stamina; they deal 2 - 1 = 1, ' +
      'so you lose 1 stamina. Had they queued 4 defense, you would deal 0, not a negative amount.',
    tags: { move_types: ['end_turn'] },
  },
];
