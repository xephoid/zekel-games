// Transition rules for Fractured Fist, authored from the pinned rules text
// (rules-v1.txt, next to this file — FRACTURED-FIST-RULES.md from the
// React app repo, 2025-12-15). Every rule cites its licensing sentence
// verbatim; __tests__/oracleCitations.test.ts string-searches the pinned text
// for each quote.
//
// Only rules where the written rules and the implementation AGREE are checked
// here. Where the port deliberately follows the newer React app instead
// (played cards held until the strike, leftover spirit kept between buys,
// card prices, the Misstep cap, refining at once rather than at cleanup), the
// difference is recorded in the game's development notes rather
// than checked — a rule that fires on every game would drown real findings.
//
// Card effect values come from the module's card table (a known blind spot:
// these rules inherit the data they read).

import { getCard, resolveCardId } from '../../cards.js';
import type { OracleRule, RuleViolation, VerifyEvent } from '@zekel/dev/verify/exec/types';
import type { FFVerifyPlayer, FFVerifyState } from './project.js';

const fmt = (v: unknown): string => JSON.stringify(v);
const SECTION = 'FRACTURED-FIST-RULES.md';

function other(s: FFVerifyState, pid: string): string {
  return s.playerOrder.find((p) => p !== pid)!;
}

function cardOf(e: VerifyEvent): ReturnType<typeof getCard> | null {
  const id = typeof e.move.card_id === 'string' ? resolveCardId(e.move.card_id) : undefined;
  return id ? getCard(id) : null;
}

function totalCards(p: FFVerifyPlayer): number {
  return p.deckSize + p.handSize + p.discardSize + p.playedSize;
}

/** True when this end_turn was the last turn of the round (the strike ran). */
function strikeRan(prev: FFVerifyState): boolean {
  return prev.playersDone.length === prev.playerOrder.length - 1;
}

function check(field: string, predicted: unknown, actual: unknown): RuleViolation[] {
  return fmt(predicted) === fmt(actual) ? [] : [{ field, predicted: fmt(predicted), actual: fmt(actual) }];
}

export const FRACTURED_FIST_ORACLE_RULES: OracleRule<FFVerifyState>[] = [
  {
    id: 'turn-order',
    on: ['end_turn'],
    citation: {
      section: `${SECTION} The Game`,
      quote: 'The game is played over several rounds where each player takes a turn.',
    },
    check: (prev, e, next) => {
      if (next.phase === 'game_over') return [];
      if (!strikeRan(prev)) {
        return [...check('activePlayerId', other(prev, e.actor), next.activePlayerId), ...check('round', prev.round, next.round)];
      }
      return [...check('activePlayerId', prev.playerOrder[0], next.activePlayerId), ...check('round', prev.round + 1, next.round)];
    },
  },
  {
    id: 'one-technique-by-default',
    on: ['end_turn'],
    citation: { section: `${SECTION} How to Play`, quote: 'By default the player can play one technique card.' },
    check: (_prev, _e, next) => {
      if (next.phase === 'game_over') return [];
      const p = next.players[next.activePlayerId]!;
      return [...check('actions at turn start', 1, p.actions), ...check('channels at turn start', 1, p.channels)];
    },
  },
  {
    id: 'techniques-in-technique-phase',
    on: ['play_card'],
    citation: {
      section: `${SECTION} How to Play`,
      quote: 'The Technique Phase is where the player may play technique cards from their hand.',
    },
    check: (prev, e) => {
      const card = cardOf(e);
      if (card?.type !== 'TECHNIQUE') return [];
      return [...check('phase when a technique is played', 'technique', prev.phase)];
    },
  },
  {
    id: 'technique-uses-an-action',
    on: ['play_card'],
    citation: {
      section: `${SECTION} How to Play`,
      quote: 'However, the card may allow them to increase the number of technique cards they can play.',
    },
    check: (prev, e, next) => {
      const card = cardOf(e);
      if (card?.type !== 'TECHNIQUE') return [];
      const before = prev.players[e.actor]!.actions;
      return [
        ...(before >= 1 ? [] : [{ field: 'actions before playing', predicted: '>= 1', actual: fmt(before) }]),
        ...check('actions', before - 1 + (card.effects?.actions ?? 0), next.players[e.actor]!.actions),
      ];
    },
  },
  {
    id: 'resources-in-channel-phase',
    on: ['play_card'],
    citation: {
      section: `${SECTION} How to Play`,
      quote:
        'The Channel Phase is where the player may use resource cards to pay for additional cards from the Available Techniques.',
    },
    check: (prev, e, next) => {
      const card = cardOf(e);
      if (card?.type !== 'RESOURCE') return [];
      const me = e.actor;
      return [
        ...check('phase when a resource is played', 'channel', prev.phase),
        ...check('spirit', prev.players[me]!.spirit + (card.value ?? 0), next.players[me]!.spirit),
      ];
    },
  },
  {
    id: 'missteps-cannot-be-played',
    on: ['play_card'],
    citation: {
      section: `${SECTION} Misstep Cards`,
      quote: 'They cannot be played or discarded during the Technique or Channel Phase.',
    },
    check: (_prev, e) => check('card type played', 'not MISSTEP', cardOf(e)?.type === 'MISSTEP' ? 'MISSTEP' : 'not MISSTEP'),
  },
  {
    id: 'draw-effect',
    on: ['play_card'],
    citation: {
      section: `${SECTION} How to Play`,
      quote: 'Some technique cards allow you to draw more cards which can be useful to play more cards or gain more spirit.',
    },
    check: (prev, e, next) => {
      const card = cardOf(e);
      const draw = card?.effects?.draw ?? 0;
      const p = prev.players[e.actor]!;
      const drawn = Math.min(draw, p.deckSize + p.discardSize);
      return check('handSize', p.handSize - 1 + drawn, next.players[e.actor]!.handSize);
    },
  },
  {
    id: 'channel-in-channel-phase',
    on: ['buy_card'],
    citation: {
      section: `${SECTION} How to Play`,
      quote:
        'The Channel Phase is where the player may use resource cards to pay for additional cards from the Available Techniques.',
    },
    check: (prev) => check('phase when a card is channeled', 'channel', prev.phase),
  },
  {
    id: 'channel-limit',
    on: ['buy_card'],
    citation: {
      section: `${SECTION} How to Play`,
      quote:
        'By default the player may only channel one card during their Channel Phase, however there are technique cards which may increase the number of cards a player can channel.',
    },
    check: (prev, e, next) => {
      const before = prev.players[e.actor]!.channels;
      return [
        ...(before >= 1 ? [] : [{ field: 'channels before buying', predicted: '>= 1', actual: fmt(before) }]),
        ...check('channels', before - 1, next.players[e.actor]!.channels),
      ];
    },
  },
  {
    id: 'channel-price',
    on: ['buy_card'],
    citation: {
      section: `${SECTION} How to Play`,
      quote: 'Each card has a price and the player can combine resources to add up to the price of the card.',
    },
    check: (prev, e, next) => {
      const cost = cardOf(e)!.cost;
      const before = prev.players[e.actor]!.spirit;
      return [
        ...(before >= cost ? [] : [{ field: 'spirit before buying', predicted: `>= ${cost}`, actual: fmt(before) }]),
        ...check('spirit', before - cost, next.players[e.actor]!.spirit),
      ];
    },
  },
  {
    id: 'channel-to-discard',
    on: ['buy_card'],
    citation: {
      section: `${SECTION} Glossary`,
      quote: 'Channel - To channel a card is to remove it from the Available Techniques and put it in your discard pile.',
    },
    check: (prev, e, next) => {
      const id = cardOf(e)!.id;
      const a = prev.players[e.actor]!;
      const b = next.players[e.actor]!;
      const out = [
        ...check(`supply.${id}`, (a.supply[id] ?? 0) - 1, b.supply[id] ?? 0),
        ...check('discardSize', a.discardSize + 1, b.discardSize),
      ];
      if (a.discard && b.discard) out.push(...check('discard', [...a.discard, id].sort(), b.discard));
      return out;
    },
  },
  {
    id: 'refine-removes-from-game',
    on: ['refine_card'],
    citation: { section: `${SECTION} Glossary`, quote: 'Refine - To refine a card is to remove it from the game.' },
    check: (prev, e, next) => {
      const a = prev.players[e.actor]!;
      const b = next.players[e.actor]!;
      return [...check('handSize', a.handSize - 1, b.handSize), ...check('total cards owned', totalCards(a) - 1, totalCards(b))];
    },
  },
  {
    id: 'cleanup-discard-and-draw',
    on: ['end_turn'],
    citation: {
      section: `${SECTION} How to Play`,
      quote: 'At this point they will discard any cards left in their hand. Then draw a new set of 5 cards from their deck.',
    },
    check: (prev, e, next) => {
      const a = prev.players[e.actor]!;
      const b = next.players[e.actor]!;
      const available = a.deckSize + a.discardSize + a.handSize;
      return check('handSize after cleanup', Math.min(a.startingHandSize, available), b.handSize);
    },
  },
  {
    id: 'spirit-lost-at-end-of-channel',
    on: ['end_turn'],
    citation: {
      section: `${SECTION} How to Play`,
      quote: 'Once the Channel Phase ends the additional spirit is lost if it is not spent.',
    },
    check: (_prev, e, next) => check('spirit after the turn ends', 0, next.players[e.actor]!.spirit),
  },
  {
    id: 'strike-damage',
    on: ['end_turn'],
    citation: {
      section: `${SECTION} How to Play`,
      quote: 'Both players calculate damage simultaneously and reduce their stamina.',
    },
    check: (prev, _e, next) => {
      if (!strikeRan(prev)) return [];
      const out: RuleViolation[] = [];
      for (const pid of prev.playerOrder) {
        const me = prev.players[pid]!;
        const opp = prev.players[other(prev, pid)]!;
        const taken = Math.max(0, opp.damageQueued - me.defenseQueued);
        out.push(...check(`${pid}.stamina`, me.stamina - taken, next.players[pid]!.stamina));
      }
      return out;
    },
  },
  {
    id: 'defeat',
    on: ['end_turn'],
    citation: {
      section: `${SECTION} How to Play`,
      quote: 'If a player has 0 or less stamina they have been defeated and their opponent wins!',
    },
    check: (prev, _e, next) => {
      // Defeat is only ever decided by the strike.
      if (!strikeRan(prev)) return check('game over', false, next.phase === 'game_over');
      const down = prev.playerOrder.filter((pid) => next.players[pid]!.stamina <= 0);
      if (down.length !== 1) return [];
      return [...check('phase', 'game_over', next.phase), ...check('winners', [other(prev, down[0]!)], next.winners)];
    },
  },
  {
    id: 'tie',
    on: ['end_turn'],
    citation: {
      section: `${SECTION} How to Play`,
      quote: 'If both have been reduced to 0 or less at the same time then the game ends in a tie.',
    },
    check: (prev, _e, next) => {
      if (!strikeRan(prev)) return [];
      const down = prev.playerOrder.filter((pid) => next.players[pid]!.stamina <= 0);
      if (down.length !== 2) return [];
      return [...check('phase', 'game_over', next.phase), ...check('winners', [], next.winners)];
    },
  },
  {
    id: 'round-ends-with-discards',
    on: ['end_turn'],
    citation: {
      section: `${SECTION} How to Play`,
      quote: 'If neither has been reduced to 0 all damage and defense cards are discarded and the next round begins.',
    },
    check: (prev, _e, next) => {
      if (!strikeRan(prev) || next.phase === 'game_over') return [];
      const out: RuleViolation[] = [];
      for (const pid of next.playerOrder) {
        const p = next.players[pid]!;
        out.push(
          ...check(`${pid}.played`, [], p.played),
          ...check(`${pid}.damageQueued`, 0, p.damageQueued),
          ...check(`${pid}.defenseQueued`, 0, p.defenseQueued),
        );
      }
      return out;
    },
  },
  {
    id: 'focus-reload-when-behind',
    on: ['focus_reload'],
    citation: {
      section: `${SECTION} Resource Cards`,
      quote:
        'Also if you have less stamina than your opponent you may discard all of your Focus cards in hand and redraw that many cards.',
    },
    check: (prev, e, next) => {
      const a = prev.players[e.actor]!;
      const b = next.players[e.actor]!;
      const opp = prev.players[other(prev, e.actor)]!;
      const out: RuleViolation[] = [];
      if (a.stamina >= opp.stamina) {
        out.push({ field: 'stamina before reloading', predicted: `< ${opp.stamina}`, actual: fmt(a.stamina) });
      }
      if (a.hand && b.hand) {
        const focus = a.hand.filter((c) => c === 'focus').length;
        const drawn = Math.min(focus, a.deckSize + a.discardSize + focus);
        out.push(...check('handSize', a.handSize - focus + drawn, b.handSize));
        // Every non-Focus card stays in hand.
        const kept = a.hand.filter((c) => c !== 'focus');
        const remaining = [...b.hand];
        for (const c of kept) {
          const i = remaining.indexOf(c);
          if (i < 0) out.push({ field: 'hand', predicted: `still holds ${c}`, actual: fmt(b.hand) });
          else remaining.splice(i, 1);
        }
      } else {
        out.push(...check('handSize', a.handSize, b.handSize));
      }
      return out;
    },
  },
  {
    id: 'cards-only-move-between-piles',
    on: '*',
    citation: {
      section: `${SECTION} Glossary`,
      quote: 'Play - To play a card is to remove it from your hand and put it in your discard pile.',
    },
    check: (prev, e, next) => {
      const out: RuleViolation[] = [];
      for (const pid of prev.playerOrder) {
        const a = prev.players[pid]!;
        const b = next.players[pid]!;
        let delta = 0;
        if (pid === e.actor && e.moveType === 'buy_card') delta = 1;
        if (pid === e.actor && e.moveType === 'refine_card') delta = -1;
        if (pid !== e.actor && e.moveType === 'play_card') {
          const sent = cardOf(e)?.effects?.add_misstep ?? 0;
          const got = b.misstepCount - a.misstepCount;
          if (got < 0 || got > sent) {
            out.push({ field: `${pid}.misstepCount`, predicted: `between ${a.misstepCount} and ${a.misstepCount + sent}`, actual: fmt(b.misstepCount) });
          }
          delta = got;
        }
        out.push(...check(`${pid}.total cards owned`, totalCards(a) + delta, totalCards(b)));
        if (b.hand && b.deck && b.discard) {
          const missteps = [...b.hand, ...b.deck, ...b.discard, ...b.played].filter((c) => c === 'misstep').length;
          out.push(...check(`${pid}.misstepCount`, missteps, b.misstepCount));
        }
      }
      return out;
    },
  },
];
