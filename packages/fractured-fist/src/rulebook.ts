// The rulebook: the words and facts a person reads on the rules page, beside
// the pictures the game's screen draws (src/glue/rulebook/). It rides the
// reference data (getReferenceData().rulebook) next to the card list the
// screen draws every card face from, so every card, cost and effect on the
// page is the engine's.
//
// The worked examples are written as the moves a player makes, with what the
// counters read after each one. src/__tests__/rulebook.test.ts plays each
// example through the real engine and checks those numbers, so an example
// can't drift from the rules.
//
// This is plain data: no React, nothing the server needs to run a game. The
// AI reads the rules through getRulesText (rulesSections.ts); this is the
// same rules laid out for a person at the table. When one changes, change
// the other.

import {
  CARDS, DEFAULT_LOADOUT, FACTIONS, FOCUS_RELOADS_PER_TURN, MAX_MISSTEPS, RESOURCE_SUPPLY_COUNT,
  STARTING_DECK, SUPPLY_RESOURCES, TECHNIQUE_SUPPLY_COUNT, getCard, type FactionId,
} from './cards.js';

/** The table's starting stamina and hand size when nobody changes them. */
export const USUAL_STAMINA = 7;
export const USUAL_HAND_SIZE = 5;

/** What a player's counters read: the numbers the screen shows. */
export interface RulebookCounters {
  actions?: number; damage?: number; defense?: number; spirit?: number; channels?: number; refine?: number;
  missteps?: number; stamina?: number;
}

/** One thing a player does in an example, and how the counters read after it. */
export interface RulebookExampleStep {
  /** What the player does, as a move the engine takes. */
  move: 'play' | 'buy' | 'refine' | 'next-phase' | 'end-turn';
  /** The card played, bought or refined (an engine card id). */
  card?: string;
  text: string;
  after: RulebookCounters;
}

export interface RulebookExample {
  title: string;
  /** The hand the example starts with (engine card ids). */
  hand: string[];
  /** The counters at the start, before the first step. */
  start: RulebookCounters;
  steps: RulebookExampleStep[];
  close: string;
}

/** One fighter in the strike example: what they queued, and their stamina before and after. */
export interface RulebookSide { name: string; damage: number; defense: number; stamina: number; after: number }

export interface RulebookCardGroup {
  id: string;
  title: string;
  text: string;
  cards: string[];
  /** A school's colour key on the card faces (the screen's palette). */
  school?: string;
}

export interface Rulebook {
  title: string;
  intro: string;
  facts: string[];
  win: { title: string; text: string; tie: string };
  components: {
    intro: string;
    items: Array<{ card: string | null; name: string; count: number; text: string }>;
    note: string;
  };
  setup: { steps: string[]; deck: string[]; deck_caption: string; loadout: string[]; loadout_caption: string };
  round: {
    intro: string;
    turn: Array<{ name: string; text: string }>;
    strike: { name: string; text: string };
    note: string;
  };
  technique: { intro: string; example: RulebookExample };
  effects: { intro: string; list: Array<{ key: string; word: string; text: string }> };
  channel: { intro: string; worth: Array<{ card: string; spirit: number }>; example: RulebookExample };
  refine: { intro: string; missteps: string; example: RulebookExample };
  reload: { title: string; text: string };
  cleanup: { intro: string; steps: string[] };
  strike: {
    intro: string;
    example: { title: string; you: RulebookSide; them: RulebookSide; steps: string[] };
    end: string;
  };
  cards: { intro: string; groups: RulebookCardGroup[] };
}

const name = (id: string) => getCard(id).name;
const techniques = CARDS.filter((c) => c.type === 'TECHNIQUE');
const ofSchool = (f: FactionId | null) => techniques.filter((c) => (c.faction ?? null) === f && !(f === null && DEFAULT_LOADOUT.includes(c.id))).map((c) => c.id);

/** The schools, as the game describes how each one fights. */
const SCHOOLS: Array<{ id: FactionId; title: string; text: string }> = [
  { id: FACTIONS.TITAN_ENTERTAINMENT, title: 'Titan Entertainment', text: 'Big damage in one burst.' },
  { id: FACTIONS.THE_AWAKENED, title: 'The Awakened', text: 'Spirit and healing: last longer and buy more.' },
  { id: FACTIONS.MASTERS_CIRCLE, title: "Masters' Circle", text: 'Defense and counters.' },
  { id: FACTIONS.UNCOUNTED, title: 'Uncounted', text: 'Fill the other player\'s deck with Missteps.' },
];

export function ffRulebook(): Rulebook {
  const focus = STARTING_DECK.filter((c) => c === 'focus').length;
  const missteps = STARTING_DECK.filter((c) => c === 'misstep').length;
  const loadoutSize = DEFAULT_LOADOUT.length;
  return {
    title: 'Fractured Fist',
    intro: 'Two fighters, two decks. Each turn you play techniques to queue damage and defense, then spend spirit to buy better cards. When both of you have had a turn, the blows land at the same time. Bring your opponent\'s stamina to 0.',
    facts: ['2 players', 'deck-building', `${loadoutSize} techniques a game`],
    win: {
      title: 'Bring their stamina to 0',
      text: 'Each player starts with the same stamina. Damage lands in the strike at the end of each round. A player at 0 stamina or less loses.',
      tie: 'If both players reach 0 in the same strike, the game is a tie.',
    },
    components: {
      intro: 'Each player has their own copy of everything below. Nothing is shared, not even the cards you buy from.',
      items: [
        { card: 'focus', name: 'Focus', count: RESOURCE_SUPPLY_COUNT + focus, text: `${focus} in your starting deck and ${RESOURCE_SUPPLY_COUNT} in your supply. Worth 1 spirit.` },
        { card: 'momentum', name: 'Momentum', count: RESOURCE_SUPPLY_COUNT, text: 'In your supply. Worth 2 spirit.' },
        { card: 'mastery', name: 'Mastery', count: RESOURCE_SUPPLY_COUNT, text: 'In your supply. Worth 3 spirit.' },
        { card: 'misstep', name: 'Missteps', count: MAX_MISSTEPS, text: `${missteps} in your starting deck. Keep the rest within reach: your opponent can push more into your discard pile.` },
        { card: 'attack', name: 'Technique cards', count: TECHNIQUE_SUPPLY_COUNT * loadoutSize, text: `${TECHNIQUE_SUPPLY_COUNT} copies of each of the game's ${loadoutSize} techniques, one pile per card.` },
        { card: null, name: 'Stamina tracker', count: 1, text: 'A die, a dial or a counter.' },
      ],
      note: `You can never hold more than ${MAX_MISSTEPS} Missteps across your deck, hand and discard pile. Missteps sent past that are not added.`,
    },
    setup: {
      steps: [
        `Choose the ${loadoutSize} techniques for this game. Both players use the same ones. For a first game, use the starter set shown below.`,
        `Each player makes their own supply: ${TECHNIQUE_SUPPLY_COUNT} copies of each technique, and ${RESOURCE_SUPPLY_COUNT} each of Focus, Momentum and Mastery.`,
        `Each player shuffles a starting deck of ${focus} Focus and ${missteps} Missteps, then draws a hand of ${USUAL_HAND_SIZE}.`,
        `Set both stamina trackers to ${USUAL_STAMINA}.`,
        'Choose who goes first. That order stays for the whole game.',
      ],
      deck: STARTING_DECK,
      deck_caption: `Your starting deck: ${focus} Focus and ${missteps} Missteps.`,
      loadout: DEFAULT_LOADOUT,
      loadout_caption: `The starter set. Between them they do everything: ${DEFAULT_LOADOUT.map(name).join(', ')}.`,
    },
    round: {
      intro: 'In each round, both players take one turn, in seat order. Then the strike settles the round.',
      turn: [
        { name: 'Technique', text: 'Play technique cards. Each one uses 1 action, and you start with 1.' },
        { name: 'Channel', text: 'Play resource cards for spirit. Spend it to buy cards into your discard pile.' },
        { name: 'Cleanup', text: `Discard the rest of your hand and draw ${USUAL_HAND_SIZE} new cards.` },
      ],
      strike: { name: 'Strike', text: 'Both players\' damage and defense land at the same time.' },
      note: 'You can skip the Channel phase by ending your turn straight from the Technique phase. You can\'t go back to the Technique phase once you are channeling.',
    },
    technique: {
      intro: 'You start each turn with 1 action. Playing a technique uses 1 action, and its effects happen right away, in the order you play. A card that gives more Tech lets you play more techniques this turn. Played cards stay face up in front of you until the strike. A card\'s cost is only what it takes to buy it.',
      example: {
        title: 'Example: one action becomes three',
        hand: ['react', 'attack', 'block', 'focus', 'focus'],
        start: { actions: 1, damage: 0, defense: 0 },
        steps: [
          { move: 'play', card: 'react', text: 'Play React. It uses your 1 action and gives you 2 more.', after: { actions: 2, damage: 0, defense: 0 } },
          { move: 'play', card: 'attack', text: 'Play Attack: 1 damage queued.', after: { actions: 1, damage: 1, defense: 0 } },
          { move: 'play', card: 'block', text: 'Play Block: 1 defense queued.', after: { actions: 0, damage: 1, defense: 1 } },
        ],
        close: 'With no actions left, move on to the Channel phase. The two Focus cards will pay for something there.',
      },
    },
    effects: {
      intro: 'Every technique is a list of these effects, printed on the card.',
      list: [
        { key: 'damage', word: 'Damage', text: 'Added to the damage you deal in this round\'s strike.' },
        { key: 'defense', word: 'Defense', text: 'Taken off the damage your opponent deals you in this round\'s strike.' },
        { key: 'actions', word: 'Tech', text: 'That many more actions this turn.' },
        { key: 'draw', word: 'Draw', text: 'Draw that many cards right now.' },
        { key: 'spirit', word: 'Spirit', text: 'That much spirit to spend in this turn\'s Channel phase.' },
        { key: 'channels', word: 'Channel', text: 'You may buy that many more cards this turn.' },
        { key: 'refine', word: 'Refine', text: 'Remove up to that many cards in your hand from the game, right now.' },
        { key: 'add_misstep', word: 'Missteps', text: `Put that many Missteps into your opponent's discard pile (never past ${MAX_MISSTEPS}).` },
        { key: 'heal', word: 'Heal', text: 'Get back that much stamina, never above what you started with.' },
      ],
    },
    channel: {
      intro: 'In the Channel phase, play resource cards for spirit. Spirit from techniques you played this turn adds to it. To buy a card, spend spirit equal to its cost; it goes into your discard pile. You may buy 1 card a turn, plus 1 more for each Channel effect you played. Leftover spirit can pay for another buy, and is lost when your turn ends.',
      worth: SUPPLY_RESOURCES.map((id) => ({ card: id, spirit: getCard(id).value ?? 0 })),
      example: {
        title: 'Example: buying an Attack',
        hand: ['focus', 'focus', 'momentum', 'misstep', 'block'],
        start: { spirit: 0, channels: 1 },
        steps: [
          { move: 'next-phase', text: 'Move on to the Channel phase.', after: { spirit: 0, channels: 1 } },
          { move: 'play', card: 'focus', text: 'Play Focus: 1 spirit.', after: { spirit: 1, channels: 1 } },
          { move: 'play', card: 'focus', text: 'Play the other Focus: 2 spirit.', after: { spirit: 2, channels: 1 } },
          { move: 'play', card: 'momentum', text: 'Play Momentum: 4 spirit.', after: { spirit: 4, channels: 1 } },
          { move: 'buy', card: 'attack', text: `Buy Attack for ${getCard('attack').cost}. It goes into your discard pile, and that is your one buy this turn.`, after: { spirit: 0, channels: 0 } },
        ],
        close: 'The Misstep and the Block are still in your hand. They are discarded at cleanup.',
      },
    },
    refine: {
      intro: 'A card with Refine lets you remove up to that many cards in your hand from the game, one at a time. They are gone for good, not discarded. You must finish refining, or skip the rest, before you do anything else.',
      missteps: `Missteps do nothing and can never be played. Your starting deck has ${missteps}. Refining is the only way to get rid of them.`,
      example: {
        title: 'Example: clearing out two Missteps',
        hand: ['assess', 'misstep', 'misstep', 'focus', 'focus'],
        start: { actions: 1, refine: 0, missteps: missteps },
        steps: [
          { move: 'play', card: 'assess', text: 'Play Assess: Refine 2.', after: { actions: 0, refine: 2, missteps } },
          { move: 'refine', card: 'misstep', text: 'Remove a Misstep from the game.', after: { actions: 0, refine: 1, missteps: missteps - 1 } },
          { move: 'refine', card: 'misstep', text: 'Remove the other one.', after: { actions: 0, refine: 0, missteps: missteps - 2 } },
        ],
        close: `Only ${missteps - 2} Misstep is left in your deck now, so your future hands are stronger.`,
      },
    },
    reload: {
      title: 'Focus reload: the catch-up rule',
      text: `If your stamina is lower than your opponent's, you may discard every Focus card in your hand and draw that many new cards. You may do this up to ${FOCUS_RELOADS_PER_TURN} times a turn, in either phase, but not while you still have refines to use.`,
    },
    cleanup: {
      intro: 'When you end your turn:',
      steps: [
        'Discard the rest of your hand.',
        `Draw ${USUAL_HAND_SIZE} new cards. If your deck runs out, draw what is left, shuffle your discard pile into a new deck, and draw the rest.`,
        'The cards you played stay in front of you until the strike.',
      ],
    },
    strike: {
      intro: 'After both players have had a turn, both deal damage at the same time. You deal your damage minus your opponent\'s defense, never less than 0.',
      example: {
        title: 'Example: both fighters land a blow',
        you: { name: 'You', damage: 3, defense: 1, stamina: USUAL_STAMINA, after: USUAL_STAMINA - 1 },
        them: { name: 'Opponent', damage: 2, defense: 2, stamina: USUAL_STAMINA, after: USUAL_STAMINA - 1 },
        steps: [
          'You deal 3 − 2 = 1, so your opponent loses 1 stamina.',
          'They deal 2 − 1 = 1, so you lose 1 stamina.',
          'Had they queued 4 defense, you would deal 0, not a negative amount.',
        ],
      },
      end: 'Then every played card goes to its owner\'s discard pile, actions, buys and spirit reset, and the next round starts with the first player.',
    },
    cards: {
      intro: 'Every card in the game. Each game uses seven techniques; the resources and Missteps are always in play.',
      groups: [
        { id: 'resources', title: 'Resources', text: 'Played in the Channel phase for spirit.', cards: [...SUPPLY_RESOURCES] },
        { id: 'misstep', title: 'Misstep', text: 'Can never be played. Refine it to remove it.', cards: ['misstep'] },
        { id: 'starter', title: 'The starter set', text: 'One technique for each kind of effect.', cards: [...DEFAULT_LOADOUT] },
        ...SCHOOLS.map((s) => ({ id: s.id, title: s.title, text: s.text, cards: ofSchool(s.id), school: s.id.replace(/_/g, '-') })),
        { id: 'general', title: 'Other techniques', text: 'Belong to no school.', cards: ofSchool(null) },
      ],
    },
  };
}
