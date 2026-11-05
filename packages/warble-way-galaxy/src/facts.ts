import type { LegalMove, MoveGateStatus } from '@zekel/game-kit';
import { ABILITY_NAMES, ABILITY_STAT, HAZARD_CONSEQUENCE_BY_STAT } from './data/abilities.js';
import { BEING_NAMES, CARD_FLAVOUR, ITEM_TITLES, MISSION_TITLES } from './data/flavour.js';
import { HABITATS } from './data/habitats.js';
import { ABILITY_TEXT, SHIP_TEXT } from './data/sheetText.js';
import { CLUB_MISSIONS, HEART_RECRUITS, SPADE_HAZARDS } from './data/travelTables.js';
import {
  actDieFor,
  anyBeingHasAdvanced,
  anyoneHasEffective,
  applyMove,
  attackRangeOf,
  bestAttackAbility,
  bestForAbility,
  boardOrThrow,
  cellsWhere,
  describeRecruit,
  effectiveScore,
  legCards,
  missionById,
  movementAllowance,
  pairingSides,
  partyQualifiesFor,
  pirateOf,
  recruitDefinitionById,
  rollBonus,
  ruinMapForLevel,
  ruinReachable,
  scorePairing,
  spaceEnc,
  tokenGroundAdvantage,
  unnamedCap,
  type PairingSides,
} from './engine.js';
import type {
  AbilityId,
  ItemDefinition,
  MissionDefinition,
  RollPart,
  RollReason,
  ShipDamage,
  WarbleMove,
  WarblePending,
  WarbleWayGalaxyState,
} from './types.js';

// What a table needs to put beside a choice so the player can make it: what
// a roll adds and what it must reach, the exact chance, what passing and
// failing each do, what else a move sets off, and why a move is not on offer.
// Everything here is read off the same state and the same functions the
// resolution uses (engine.ts); nothing here changes the game.

type RollPending = Extract<WarblePending, { kind: 'roll' }>;

export interface RollFacts {
  reason: RollReason;
  /** A name for the roll: "Recruit", "Mission", "Exchange of fire". */
  name: string;
  /** Who or what it is about: a recruit, a mission, a hazard, a foe. */
  subject?: string;
  /** Whose score is added: "you" or a crew member. Absent when none is. */
  carrier?: string;
  dice: number;
  parts: RollPart[];
  bonus: number;
  /** A roll against a number: the number, what the dice alone must make, and the chance. */
  target?: number;
  dice_need?: number;
  /** 0 to 1, exact. For a pairing roll, the chance of winning once ties are rolled again. */
  chance?: number;
  /** A pairing roll (4 dice in two pairs): which pair is yours, why, and what each side adds. */
  pairing?: {
    you_take: 'higher' | 'lower';
    why: string;
    your_add: number;
    their_add: number;
    their_name: string;
    rider_dice: number;
    win: number;
    tie: number;
    lose: number;
  };
  /** A roll on a list: what each face gives. */
  table?: Array<{ face: number; result: string }>;
  on_pass: string;
  on_fail: string;
  /** Anything else worth knowing before the dice: an extra die, a red shirt who could step in. */
  notes: string[];
}

export interface MovePreview {
  /** The roll this move opens at once. */
  roll?: RollFacts;
  /** A roll this move leads to later: a mission's check at the far end. */
  check?: RollFacts;
  /** What else taking it sets off, when that is more than its description says. */
  then?: string;
  /** A hazard option: each being who could carry the roll, with the roll as they would make it. */
  carriers?: Array<{ name: string; title: string; roll: RollFacts }>;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const DAMAGE_STEPS: ShipDamage[] = ['pristine', 'used', 'damaged', 'hobbled'];

// ---------------------------------------------------------------------------
// Names: the one a table shows for a being or an item
// ---------------------------------------------------------------------------

/** The name on a recruit's printed row or card, when it has one. */
export function recruitTitle(recruitId: string | undefined): string | null {
  if (!recruitId) return null;
  if (BEING_NAMES[recruitId]) return BEING_NAMES[recruitId]!;
  const heart = /^heart-(.+)$/.exec(recruitId);
  if (heart) return CARD_FLAVOUR[`${heart[1]}H`]?.title ?? null;
  return null;
}

/** A crew member's name for a table: the one on their row or card, else the engine's label. */
export function crewTitle(state: WarbleWayGalaxyState, name: string): string {
  const crew = state.crew.find((c) => c.name === name);
  return recruitTitle(crew?.recruit_id) ?? name;
}

/** An item's name for a table: the shop's name for it, else its printed label. */
export function itemTitle(item: ItemDefinition): string {
  const title = ITEM_TITLES[item.id.replace(/#\d+$/, '')];
  return title ? `${title}${item.upgraded === true ? ' MK-II' : ''}` : item.name;
}

/** What an item does, in a line. */
export function itemEffectText(item: Pick<ItemDefinition, 'type' | 'effect'>): string {
  const e = item.effect;
  if (!e) return ''; // an item with no recorded effect says nothing
  if (e.kind === 'ability_bonus') {
    if (item.type === 'consumable') {
      return e.ability === 'ANY'
        ? `One use: +${e.bonus} to any one roll that adds a score, declared before the dice.`
        : `One use: +${e.bonus} to one ${ABILITY_NAMES[e.ability]} roll, declared before the dice.`;
    }
    return e.ability === 'ANY' ? `+${e.bonus} to a score of the wearer's.` : `+${e.bonus} ${ABILITY_NAMES[e.ability]} for whoever wears it.`;
  }
  if (e.kind === 'ground_combat_advantage') return 'Whoever wears it takes the higher pair in ground combat.';
  if (e.kind === 'space_combat_advantage') return 'The ship takes the higher pair in every exchange of fire.';
  return `Ship ${e.stat} +${e.bonus}. ${SHIP_TEXT[e.stat]}`;
}

/** The recruit a pending offer or roll is about, when a card names them. */
function pendingRecruit(state: WarbleWayGalaxyState): { label: string; title: string } | null {
  const p = state.pending;
  try {
    const def =
      p?.kind === 'space_recruit_offer'
        ? HEART_RECRUITS[p.card_id.replace(/[HDSC]$/, '') as keyof typeof HEART_RECRUITS]
        : p?.kind === 'roll' && p.reason === 'recruit' && p.context.recruit_id
          ? recruitDefinitionById(state, p.context.recruit_id, p.context.recruit_source ?? 'cantina')
          : undefined;
    const title = def ? recruitTitle(def.id) : null;
    return def && title ? { label: describeRecruit(def), title } : null;
  } catch {
    return null; // a recruit with no definition (a turned attacker) keeps the engine's words
  }
}

/** A sentence with the engine's labels swapped for the names a table shows:
 *  a crew member's label for the name on their card, an owned item's printed
 *  label for the shop's name. Longest label first, so one label inside
 *  another is never cut. */
export function namesIn(state: WarbleWayGalaxyState, text: string, before?: WarbleWayGalaxyState): string {
  const swaps: Array<[string, string]> = [];
  // The recruit an offer or a roll is about is not aboard yet, so no crew row
  // names them: the card does. `before` is the state the move was made in,
  // for a sentence about a roll that has just been settled.
  const asked = pendingRecruit(state) ?? (before ? pendingRecruit(before) : null);
  if (asked && !text.includes(`${asked.title} the `)) {
    text = text.includes(`the drifting ${asked.label}`)
      ? text.split(`the drifting ${asked.label}`).join(`${asked.title} the drifting ${asked.label}`)
      : text.split(asked.label).join(`${asked.title} the ${asked.label}`);
  }
  for (const c of state.crew) {
    const title = recruitTitle(c.recruit_id);
    if (title && title !== c.name) swaps.push([c.name, title]);
  }
  for (const i of state.items) {
    const title = itemTitle(i);
    if (title !== i.name) swaps.push([i.name, title]);
  }
  swaps.sort((a, b) => b[0].length - a[0].length);
  let out = text;
  for (const [label, title] of swaps) out = out.split(label).join(title);
  return out;
}

/** A listed move's description for a screen: the same sentence, led by the
 *  name the table shows for the row it is about. */
export function screenDescription(state: WarbleWayGalaxyState, move: WarbleMove, description: string): string {
  const habitat = HABITATS[state.current_habitat];
  let d = description;
  if (move.type === 'take_mission') {
    const title = MISSION_TITLES[move.mission_name];
    if (title) d = `${title}: ${d}`;
  } else if (move.type === 'buy_item') {
    const item = habitat?.shop.find((s) => s.name === move.item_name || s.id === move.item_name);
    const title = item ? ITEM_TITLES[item.id] : undefined;
    if (item && title) d = d.replace(item.name, `${title} (${item.name})`);
    return d; // the item is not owned yet: its label must not be swapped a second time
  } else if (move.type === 'attempt_recruit' && state.pending === null) {
    const recruit = habitat?.cantina.find((c) => c.id === move.recruit_name);
    const title = recruit ? BEING_NAMES[recruit.id] : undefined;
    if (recruit && title) d = d.replace(`the ${describeRecruit(recruit)}`, `${title}, the ${describeRecruit(recruit)},`);
  }
  return namesIn(state, d);
}

export function missionTitle(missionId: string): string | null {
  if (MISSION_TITLES[missionId]) return MISSION_TITLES[missionId]!;
  const club = /^club-([^-]+)/.exec(missionId);
  return club ? CARD_FLAVOUR[`${club[1]}C`]?.title ?? null : null;
}

// ---------------------------------------------------------------------------
// Consequences, in words
// ---------------------------------------------------------------------------

/** How many hits the ship can take before the one that destroys it lands, that one included. */
export function hitsToLost(state: WarbleWayGalaxyState): number {
  const ship = state.ship;
  if (!ship) return 0;
  const steps = DAMAGE_STEPS.length - DAMAGE_STEPS.indexOf(ship.damage);
  return steps + (anyBeingHasAdvanced(state, 'ARM') && state.bulkheads_spent !== true ? 1 : 0);
}

/** What one more hit on the ship does right now. */
export function hitText(state: WarbleWayGalaxyState): string {
  const ship = state.ship!;
  if (ship.damage === 'hobbled') {
    return anyBeingHasAdvanced(state, 'ARM') && state.bulkheads_spent !== true
      ? `The ${ship.name} takes a hit that would destroy it; the emergency bulkheads hold it at Hobbled, this once.`
      : `The ${ship.name} takes a hit while Hobbled and is destroyed. The game is over.`;
  }
  const next = DAMAGE_STEPS[DAMAGE_STEPS.indexOf(ship.damage) + 1]!;
  return `The ${ship.name} takes one damage, to ${cap(next)}.`;
}

export function deathCheckText(state: WarbleWayGalaxyState): string {
  return state.character?.wounded === true
    ? 'A death check follows: 3 dice, 9 or more and you live. You are wounded, so failing it kills you and ends the game.'
    : 'A death check follows: 3 dice, 9 or more and you live. Failing it leaves you wounded, −1 to every score until the next habitat; a failure while wounded kills you.';
}

/** What failing a hazard costs, for this ability and this carrier. */
export function hazardFailText(state: WarbleWayGalaxyState, ability: AbilityId, carrier: { who: 'self' | 'crew'; crew_name?: string }): string {
  const consequence = HAZARD_CONSEQUENCE_BY_STAT[ABILITY_STAT[ability]];
  const credits = state.character?.credits ?? 0;
  switch (consequence) {
    case 'death':
      return carrier.who === 'crew' && carrier.crew_name
        ? `${crewTitle(state, carrier.crew_name)} dies, and the gear they wear is lost. +1 XP for surviving.`
        : deathCheckText(state);
    case 'lose_credits':
      return credits - 100 < -300
        ? `Lose 100 credits, to ${credits - 100}c: debt past 300c ends the game.`
        : `Lose 100 credits, to ${credits - 100}c${credits - 100 < 0 ? ' (debt past 300c ends the game)' : ''}. +1 XP for surviving.`;
    case 'ship_damage':
      return `${hitText(state)}${state.ship!.damage === 'hobbled' && !(anyBeingHasAdvanced(state, 'ARM') && state.bulkheads_spent !== true) ? '' : ' +1 XP for surviving.'}`;
    case 'crew_unrest': {
      if (state.crew.length === 0) return 'Every crew member would gain an anger token; you have no crew, so nothing is lost. +1 XP for surviving.';
      const leavers = state.crew.filter((c) => c.anger_tokens >= 2).map((c) => crewTitle(state, c.name));
      return `Every crew member gains an anger token${leavers.length ? `; ${leavers.join(' and ')} would reach three and leave with their gear` : ''}. +1 XP for surviving.`;
    }
  }
}

// ---------------------------------------------------------------------------
// Chances
// ---------------------------------------------------------------------------

/** The chance that n dice total `need` or more. */
export function chanceAtLeast(n: number, need: number): number {
  let ways = [1];
  for (let k = 0; k < n; k++) {
    const next = new Array<number>(ways.length + 6).fill(0);
    ways.forEach((w, s) => { for (let f = 1; f <= 6; f++) next[s + f]! += w; });
    ways = next;
  }
  let hit = 0;
  ways.forEach((w, s) => { if (s >= need) hit += w; });
  return hit / 6 ** n;
}

/** Every way the dice can fall in a pairing roll, counted. */
export function pairingOdds(sides: PairingSides, bonus: number): { win: number; tie: number; lose: number } {
  const n = 4 + sides.rider_dice;
  const dice = new Array<number>(n).fill(1);
  const count = { win: 0, tie: 0, lose: 0 };
  const total = 6 ** n;
  for (let i = 0; i < total; i++) {
    let x = i;
    for (let d = 0; d < n; d++) { dice[d] = (x % 6) + 1; x = Math.floor(x / 6); }
    count[scorePairing(sides, dice, bonus).outcome] += 1;
  }
  return { win: count.win / total, tie: count.tie / total, lose: count.lose / total };
}

const round4 = (x: number) => Math.round(x * 10000) / 10000;

// ---------------------------------------------------------------------------
// A roll's facts
// ---------------------------------------------------------------------------

function rollName(pending: RollPending): string {
  switch (pending.reason) {
    case 'recruit': return 'Recruit';
    case 'repair': return 'Repair';
    case 'reduce_unrest': return 'Ease unrest';
    case 'mission_check': return 'Mission';
    case 'hazard_check': return 'Hazard';
    case 'death_check': return 'Death check';
    case 'escape': return 'Escape';
    case 'hack': return 'Hack';
    case 'evade': return 'Run silent';
    case 'volley': return 'Opening volley';
    case 'intimidate': return 'Stand down or burn';
    case 'unnamed_recruit': return pending.context.unnamed_source === 'survivors' ? 'Talk the survivors aboard' : 'Work the docks';
    case 'redline': return 'Redline';
    case 'space_combat': return 'Exchange of fire';
    case 'ground_combat': return pending.context.ground === 'ruin_attack' ? 'Attack' : pending.context.ground === 'ruin_defense' ? 'Defend' : 'Boarding';
    case 'item_d6': return 'Open the cache';
    case 'being_d6': return 'Approach the figure';
  }
}

/** The facts of a roll pending: the open one, or one a move would open. */
export function factsFor(state: WarbleWayGalaxyState, pending: RollPending): RollFacts {
  const { bonus, parts } = rollBonus(state, pending);
  const ctx = pending.context;
  const src = pending.score_source;
  const carrierTitle = src.who === 'crew' && src.crew_name ? crewTitle(state, src.crew_name) : 'you';
  const facts: RollFacts = {
    reason: pending.reason,
    name: rollName(pending),
    ...(src.ability || src.who === 'crew' ? { carrier: carrierTitle } : {}),
    dice: pending.dice_count,
    parts,
    bonus,
    on_pass: '',
    on_fail: '',
    notes: [],
  };
  if (pending.min_roll !== null) {
    facts.target = pending.min_roll;
    facts.dice_need = pending.min_roll - bonus;
    facts.chance = round4(chanceAtLeast(pending.dice_count, pending.min_roll - bonus));
  }
  const sides = pairingSides(state, pending);
  if (sides) {
    const odds = pairingOdds(sides, bonus);
    facts.pairing = {
      you_take: sides.advantage ? 'higher' : 'lower',
      why: sides.why,
      your_add: bonus + sides.your_extra,
      their_add: sides.their_add,
      their_name: sides.their_name,
      rider_dice: sides.rider_dice,
      win: round4(odds.win), tie: round4(odds.tie), lose: round4(odds.lose),
    };
    facts.chance = odds.win + odds.lose > 0 ? round4(odds.win / (odds.win + odds.lose)) : 0;
    facts.notes.push('A tie is rolled again.');
  }
  if (src.ability && pending.dice_count > 3 && pending.min_roll !== null && anyoneHasEffective(state, 'ACT')) {
    facts.notes.push('Acting aboard adds the extra die.');
  }
  const ship = state.ship;
  const unopposed = () => `They attack unopposed: ${hitText(state)}`;

  switch (pending.reason) {
    case 'recruit': {
      const id = ctx.recruit_id ?? '';
      if (id.startsWith('convert-')) {
        const foe = id.replace('convert-', '');
        const limit = unnamedCap(state);
        facts.subject = foe;
        facts.on_pass = (state.unnamed_crew ?? 0) >= limit
          ? `${foe} lays down arms, but you already hold ${limit} of ${limit} red shirts, so it scatters when the fight ends. No XP.`
          : `${foe} lays down arms and joins as a red shirt, acting from your next round. No XP, and it does not count toward Bounty.`;
        facts.on_fail = `${foe} keeps fighting.`;
        break;
      }
      const source = ctx.recruit_source ?? 'cantina';
      const def = recruitDefinitionById(state, id, source);
      const name = recruitTitle(id) ?? describeRecruit(def);
      facts.subject = name;
      const over = ship ? state.crew.length + 2 > ship.capacity : false;
      facts.on_pass = `${name} joins the crew${source === 'ruin' ? ' and stands on the map, acting from your next round' : ''}.${anyoneHasEffective(state, 'LEA') ? ' +1 XP (Leadership).' : ''}${over ? ' The ship would then be over capacity: someone must be released.' : ''}`;
      facts.on_fail = source === 'cantina'
        ? `${name} is marked: no second try at this cantina, ever.`
        : source === 'space' ? `${name} drifts on. A recruit met in space is never marked.` : `${name} slips away, and the spot is spent.`;
      break;
    }
    case 'repair': {
      const up = ship ? DAMAGE_STEPS[Math.max(0, DAMAGE_STEPS.indexOf(ship.damage) - 1)]! : 'pristine';
      facts.on_pass = `The ${ship?.name} goes up one damage level, to ${cap(up)}.`;
      facts.on_fail = `The ${ship?.name} stays ${cap(ship?.damage ?? '')}. There is one repair roll per arrival.`;
      break;
    }
    case 'reduce_unrest':
      facts.on_pass = 'One anger token comes off every crew member.';
      facts.on_fail = 'The anger tokens stay. There is one unrest roll per arrival.';
      break;
    case 'mission_check': {
      const mission = missionById(ctx.mission_id!);
      facts.subject = missionTitle(mission.id) ?? `the ${src.ability} ${pending.min_roll} mission`;
      const extras: string[] = [];
      const act = Math.max(0, state.character?.abilities.ACT ?? 0, ...state.crew.map((c) => c.abilities.ACT ?? 0));
      if (act >= 3) extras.push(`Je ne sais quoi +${100 * act}c`);
      if (anyBeingHasAdvanced(state, 'DIP')) extras.push('Silver Tongue doubles the credits');
      facts.on_pass = `${mission.credits}c and ${mission.xp} XP${extras.length ? ` (${extras.join('; ')})` : ''}.${ship && ship.damage !== 'pristine' ? ' Time planetside also repairs the ship one level.' : ''} The trip back is still to fly.`;
      facts.on_fail = 'No credits and no XP. The trip back is still to fly.';
      break;
    }
    case 'hazard_check': {
      const rank = (ctx.hazard_card_id ?? '').replace(/[HDSC]$/, '') as keyof typeof SPADE_HAZARDS;
      const hazard = SPADE_HAZARDS[rank];
      const opt = hazard ? (ctx.hazard_option === 2 ? hazard.option2 : hazard.option1) : null;
      facts.subject = CARD_FLAVOUR[ctx.hazard_card_id ?? '']?.title ?? 'the hazard';
      facts.on_pass = 'Nothing happens. +1 XP for surviving.';
      facts.on_fail = opt ? hazardFailText(state, opt.ability, src) : 'The consequence lands.';
      if ((state.unnamed_crew ?? 0) > 0) {
        facts.notes.push(`If it fails, you may spend a red shirt (${state.unnamed_crew} aboard) to count it as survived instead. You choose after the dice.`);
      }
      break;
    }
    case 'death_check':
      facts.on_pass = 'You live, unharmed.';
      facts.on_fail = state.character?.wounded === true
        ? 'You are already wounded: you die, and the game is over.'
        : 'You live, wounded: −1 to every score until the next habitat. A failed death check while wounded kills you.';
      break;
    case 'evade':
      facts.subject = 'the pirates';
      facts.on_pass = 'They never see you. No encounter.';
      facts.on_fail = 'They spot you, and the fight starts as it would have.';
      break;
    case 'escape':
      facts.subject = 'the pirates';
      facts.on_pass = 'A clean getaway. The encounter ends.';
      facts.on_fail = `${hitText(state)}${ship?.damage === 'hobbled' && !(anyBeingHasAdvanced(state, 'ARM') && state.bulkheads_spent !== true) ? '' : ' Then you get away all the same.'}`;
      break;
    case 'hack':
      facts.subject = 'the pirates';
      facts.on_pass = `Their ship is disabled: board it or fly on.${anyBeingHasAdvanced(state, 'HAK') ? ' Hackers Delight pays +200c.' : ''}`;
      facts.on_fail = `${unopposed()} The fight goes on.`;
      break;
    case 'volley':
      facts.subject = 'the pirates';
      facts.on_pass = '−2 to the pirates\' total in every exchange for the rest of this fight.';
      facts.on_fail = `${unopposed()} The fight goes on, and the volley is spent.`;
      break;
    case 'redline':
      facts.on_pass = '+2 to your total in every exchange for the rest of this fight.';
      facts.on_fail = `${unopposed()} The fight goes on, and the redline is spent.`;
      break;
    case 'intimidate': {
      const pirate = pirateOf(spaceEnc(state));
      facts.subject = 'the pirates';
      facts.on_pass = `They break off and the encounter ends.${anyBeingHasAdvanced(state, 'DEM') ? ` They pay ${50 * pirate.space_attack}c in tribute.` : ''}${(state.dread ?? 0) < 3 ? ' Dread +1.' : ''}`;
      facts.on_fail = `${unopposed()} ${pirate.space_attack <= 3 ? 'Then they think better of it and leave.' : 'The fight goes on.'}`;
      break;
    }
    case 'unnamed_recruit': {
      const limit = unnamedCap(state);
      facts.on_pass = `One red shirt signs on, ${Math.min(limit, (state.unnamed_crew ?? 0) + 1)} of ${limit}.`;
      facts.on_fail = ctx.unnamed_source === 'survivors' ? 'Nobody signs on. The survivors can be asked once per victory.' : 'Nobody signs on. The docks can be worked once per habitat.';
      break;
    }
    case 'space_combat': {
      const enc = spaceEnc(state);
      facts.subject = 'the pirates';
      facts.on_pass = 'Their ship is disabled: board it or fly on. A disabled ship does not count toward Bounty.';
      facts.on_fail = !enc.reroll_used && anyBeingHasAdvanced(state, 'PIL')
        ? `Flying Ace lets you roll the exchange again, once. Otherwise: ${hitText(state)}`
        : `${hitText(state)}${ship?.damage === 'hobbled' && !(anyBeingHasAdvanced(state, 'ARM') && state.bulkheads_spent !== true) ? '' : ' The fight goes on.'}`;
      break;
    }
    case 'ground_combat': {
      if (ctx.ground === 'ruin_attack') {
        const { board } = boardOrThrow(state);
        const foe = board.attackers.find((a) => a.id === ctx.target);
        facts.subject = foe?.id ?? 'the attacker';
        facts.on_pass = `${foe?.id} falls: +${foe?.xp ?? 0} XP, and it counts toward Bounty.`;
        facts.on_fail = `${foe?.id} holds. Nothing else happens to ${facts.carrier ?? 'the attacker'}.`;
      } else if (ctx.ground === 'ruin_defense') {
        const { board } = boardOrThrow(state);
        const token = board.tokens.find((t) => t.name === ctx.actor);
        facts.subject = ctx.target ?? 'the attacker';
        if (!facts.carrier) facts.carrier = token?.is_character ? 'you' : crewTitle(state, ctx.actor ?? '');
        facts.on_pass = 'The blow is weathered.';
        facts.on_fail = token?.is_character
          ? deathCheckText(state)
          : token?.unnamed === true ? 'The red shirt falls.' : `${crewTitle(state, ctx.actor ?? '')} dies, and the gear they wear is lost.`;
      } else {
        facts.subject = 'the pirates';
        facts.on_pass = `Their ship is captured: take it or keep yours.${(state.dread ?? 0) < 3 ? ' Dread +1.' : ''} It counts toward Bounty.`;
        facts.on_fail = src.who === 'crew' && src.crew_name
          ? `${crewTitle(state, src.crew_name)} dies leading the boarding, and the gear they wear is lost. The ship stays disabled.`
          : `${deathCheckText(state)} The ship stays disabled.`;
      }
      break;
    }
    case 'item_d6': {
      const map = ruinMapForLevel(boardOrThrow(state).run.level);
      facts.table = [1, 2, 3, 4, 5, 6].map((face) => {
        const item = map.items[face];
        return { face, result: item ? `${item.name}: ${itemEffectText(item)}` : 'Empty.' };
      });
      facts.on_pass = 'Whatever the die names is yours. Opening the cache counts toward Plunder, full or empty, and the spot is spent.';
      facts.on_fail = '';
      break;
    }
    case 'being_d6': {
      const map = ruinMapForLevel(boardOrThrow(state).run.level);
      facts.table = [1, 2, 3, 4, 5, 6].map((face) => {
        const being = map.beings[face];
        return { face, result: being ? `${describeRecruit(being)}, idealizes ${being.idealized}.` : 'A decoy: nobody is there.' };
      });
      facts.on_pass = 'If someone is there, the recruit roll follows at once. Either way the spot is spent.';
      facts.on_fail = '';
      break;
    }
  }
  return facts;
}

/** The open roll's facts, or null when no roll is owed. */
export function rollFacts(state: WarbleWayGalaxyState): RollFacts | null {
  return state.pending?.kind === 'roll' ? factsFor(state, state.pending) : null;
}

// ---------------------------------------------------------------------------
// What a move would do
// ---------------------------------------------------------------------------

/** The check an ability mission ends in, as the crew stands now. */
function missionCheckFacts(state: WarbleWayGalaxyState, mission: MissionDefinition): RollFacts | null {
  if (mission.goal.kind !== 'ability_check') return null;
  const best = bestForAbility(state, mission.goal.ability);
  const pending: RollPending = {
    kind: 'roll',
    reason: 'mission_check',
    dice_count: 3 + actDieFor(state, mission.goal.ability),
    score_source: { who: best.who, ...(best.crew_name ? { crew_name: best.crew_name } : {}), ability: mission.goal.ability, bonus: best.bonus },
    min_roll: mission.goal.min_roll,
    declared_items: [],
    context: { mission_id: mission.id },
  };
  return factsFor(state, pending);
}

const OPENS_ROLL = new Set(['attempt_recruit', 'attempt_repair', 'attempt_reduce_unrest', 'recruit_unnamed', 'recruit_survivors', 'choose_hazard_option', 'attempt_evade', 'attempt_escape', 'attempt_hack', 'open_fire', 'redline', 'attempt_intimidate', 'fight_round', 'use_reroll', 'board_ship', 'attack', 'convert_attacker', 'collect_item', 'recruit_at', 'use_item']);
const NO_PREVIEW = new Set(['resolve_report', 'report_roll', 'report_card_draw', 'report_res_discard', 'create_character', 'setup_encounter', 'move_being']);

/** What taking a listed move leads to. Null when there is nothing to add. */
export function previewMove(state: WarbleWayGalaxyState, move: WarbleMove): MovePreview | null {
  if (NO_PREVIEW.has(move.type)) return null;
  const preview: MovePreview = {};
  let next: WarbleWayGalaxyState | null = null;
  try {
    next = applyMove(state, move).newState;
  } catch {
    next = null;
  }
  // Only a move that itself asks for dice carries a roll: ending a turn or
  // flying on can leave a roll open too (an attacker strikes, a leg ends at
  // its mission), but that roll is not this move's.
  if (next?.pending?.kind === 'roll' && OPENS_ROLL.has(move.type)) preview.roll = factsFor(next, next.pending);
  const ship = state.ship;
  const habitat = HABITATS[state.current_habitat];

  switch (move.type) {
    case 'take_mission': {
      const mission = habitat?.missions.find((m) => m.id === move.mission_name);
      if (!mission || !ship) break;
      const cards = legCards(state, mission.distance);
      const check = missionCheckFacts(state, mission);
      if (check) preview.check = check;
      preview.then = mission.goal.kind === 'ruin'
        ? `You leave ${habitat!.name} at once: ${plural(cards, 'card')} out, the ruin to depth ${mission.goal.depth}, then ${plural(cards, 'card')} back. A mission can be tried once.`
        : `You leave ${habitat!.name} at once: ${plural(cards, 'card')} out, the check, then ${plural(cards, 'card')} back. A mission can be tried once.`;
      break;
    }
    case 'accept_mission': {
      if (state.pending?.kind !== 'space_mission_offer' || !ship) break;
      const rank = state.pending.card_id.replace(/[HDSC]$/, '') as keyof typeof CLUB_MISSIONS;
      const entry = CLUB_MISSIONS[rank];
      if (!entry) break;
      const mission = entry.kind === 'choice' ? (move.option === 2 ? entry.option2 : entry.option1) : entry.mission;
      const cards = legCards(state, mission.distance);
      const check = missionCheckFacts(state, mission);
      if (check) preview.check = check;
      preview.then = `It goes on top of your trip: ${plural(cards, 'card')} out, ${mission.goal.kind === 'ruin' ? `the ruin to depth ${mission.goal.depth}` : 'the check'}, ${plural(cards, 'card')} back, then the leg you were on picks up where it stopped.`;
      break;
    }
    case 'depart_for_next_habitat': {
      const prog = habitat?.progression;
      if (!prog || !ship) break;
      if (prog.kind === 'final_ruin') preview.then = `The finale: a ruin to depth ${prog.depth}. Clearing it wins the season.`;
      else preview.then = `A one-way trip of ${plural(legCards(state, prog.distance_one_way), 'card')}. You do not come back to ${habitat!.name}: what its shop, cantina and missions still hold is left behind.`;
      break;
    }
    case 'choose_hazard_option': {
      if (state.pending?.kind !== 'hazard_option') break;
      const rank = state.pending.card_id.replace(/[HDSC]$/, '') as keyof typeof SPADE_HAZARDS;
      const hazard = SPADE_HAZARDS[rank];
      if (!hazard) break;
      const opt = move.option === 2 ? hazard.option2 : hazard.option1;
      if (state.pending.must_fail) {
        preview.then = `No roll: nobody aboard has either ability. ${hazardFailText(state, opt.ability, { who: 'self' })}${(state.unnamed_crew ?? 0) > 0 ? ' A red shirt cannot take this one; they step in only after a roll fails.' : ''}`;
        break;
      }
      const carriers: NonNullable<MovePreview['carriers']> = [];
      const names = [state.character?.name, ...state.crew.map((c) => c.name)].filter((n): n is string => !!n);
      for (const name of names) {
        try {
          const after = applyMove(state, { ...move, carrier: name } as WarbleMove).newState;
          if (after.pending?.kind === 'roll') carriers.push({ name, title: name === state.character?.name ? 'you' : crewTitle(state, name), roll: factsFor(after, after.pending) });
        } catch {
          // this being has no score in the option's ability
        }
      }
      if (carriers.length > 1) preview.carriers = carriers;
      break;
    }
    case 'escape_to_start': {
      if (state.encounter?.kind !== 'ruin_run' || !state.encounter.board) break;
      const left = state.encounter.board.tokens.length - 1;
      preview.then = left === 0
        ? 'The last one out: the visit ends, and you keep what was collected.'
        : `They leave the ruin for the rest of this level. ${plural(left, 'being')} would still be inside.`;
      break;
    }
    case 'end_being_turn': {
      if (state.encounter?.kind !== 'ruin_run' || !state.encounter.board) break;
      const open = state.encounter.board.tokens.filter((t) => !t.ended);
      if (open.length === 1) preview.then = 'The last to act: the attackers move next.';
      break;
    }
    case 'accept_result':
      preview.then = `${hitText(state)} The fight goes on.`;
      break;
    case 'decline_sacrifice': {
      if (state.pending?.kind !== 'sacrifice_offer') break;
      const rank = state.pending.hazard_card_id.replace(/[HDSC]$/, '') as keyof typeof SPADE_HAZARDS;
      const hazard = SPADE_HAZARDS[rank];
      if (!hazard) break;
      const opt = state.pending.hazard_option === 2 ? hazard.option2 : hazard.option1;
      preview.then = hazardFailText(state, opt.ability, { who: state.pending.carrier_who, ...(state.pending.carrier_name ? { crew_name: state.pending.carrier_name } : {}) });
      break;
    }
    case 'sacrifice_unnamed':
      preview.then = `One red shirt is lost, leaving ${Math.max(0, (state.unnamed_crew ?? 0) - 1)}. The hazard counts as survived: +1 XP.`;
      break;
    case 'buy_item': {
      const item = habitat?.shop.find((s) => s.name === move.item_name || s.id === move.item_name);
      if (item) preview.then = `${itemEffectText(item)}${item.type === 'ship_part' ? ' Fitted at once.' : item.type === 'consumable' ? '' : ' One weapon and one armor per being.'}`;
      break;
    }
    case 'pay_repair': {
      if (!ship) break;
      const up = DAMAGE_STEPS[Math.max(0, DAMAGE_STEPS.indexOf(ship.damage) - 1)]!;
      preview.then = `The ${ship.name} goes up one damage level, to ${cap(up)}. You may pay again.`;
      break;
    }
    case 'release_crew':
      preview.then = `${crewTitle(state, move.crew_name)} leaves for good and takes the weapon and armor they wear.`;
      break;
    case 'level_up': {
      const now = state.character?.abilities[move.ability] ?? 0;
      const text = ABILITY_TEXT[move.ability];
      preview.then = `${ABILITY_NAMES[move.ability]} ${now} to ${now + 1}. ${text.basic}${now + 1 === 3 ? ` A natural 3 also gives ${text.advanced.name}: ${text.advanced.what}` : ''}`;
      break;
    }
    case 'take_ship':
      preview.then = 'Their ship becomes yours as it is, Hobbled and with no parts. Your own ship and every part fitted to it are left behind.';
      break;
    case 'enter_ruin':
      if (state.pending?.kind === 'ruin_discovery') preview.then = 'Next you choose who goes in, the start square, the threat level and where the three attackers stand. Stepping on the goal of the last level ends the visit at once.';
      break;
    default:
      break;
  }
  return preview.roll || preview.check || preview.then || preview.carriers ? preview : null;
}

/** Listed moves, each with what it would lead to. */
export function withPreviews(
  state: WarbleWayGalaxyState,
  moves: LegalMove<WarbleMove>[],
): Array<LegalMove<WarbleMove> & { preview?: MovePreview }> {
  return moves.map((m) => {
    const preview = previewMove(state, m.move);
    return preview ? { ...m, preview } : m;
  });
}

// ---------------------------------------------------------------------------
// Why a move is not on offer
// ---------------------------------------------------------------------------

const needs = (a: AbilityId) => `Needs ${ABILITY_NAMES[a]} (${a}) aboard.`;

/** The moves a player might look for and not find, each with the reason. A
 *  whole move type is listed only when no instance of it is legal; an `item`
 *  entry names one shop row, mission or option that is shut. */
export function moveGates(state: WarbleWayGalaxyState): MoveGateStatus[] {
  const gates: MoveGateStatus[] = [];
  if (state.result !== null || !state.character || !state.ship) return gates;
  const gate = (move_type: string, reason: string, item?: string) => gates.push({ move_type, status: 'gated', reason, ...(item ? { item } : {}) });
  const pending = state.pending;
  const ship = state.ship;
  const char = state.character;
  const has = (a: AbilityId) => bestForAbility(state, a).bonus >= 1;
  const naturalMec3 = (char.abilities.MEC ?? 0) >= 3 || state.crew.some((c) => (c.abilities.MEC ?? 0) >= 3);
  const redShirtRoom = () => {
    const limit = unnamedCap(state);
    return (state.unnamed_crew ?? 0) >= limit ? `You hold ${state.unnamed_crew ?? 0} of ${limit} red shirts. The most you can hold is your best natural Diplomacy.` : null;
  };

  if (!pending && state.phase === 'at_habitat') {
    const habitat = HABITATS[state.current_habitat]!;
    const progress = state.habitat_progress[state.current_habitat]!;
    for (const s of habitat.shop) {
      if (progress.purchased.includes(s.id) || char.credits >= s.cost) continue;
      gate('buy_item', `Costs ${s.cost}c; you have ${char.credits}c.`, s.id);
    }
    for (const m of habitat.missions) {
      if (progress.missions_attempted.includes(m.id) || m.goal.kind !== 'ability_check' || partyQualifiesFor(state, m.goal.ability)) continue;
      gate('take_mission', `Nobody aboard has ${ABILITY_NAMES[m.goal.ability]} (${m.goal.ability}), and no item you hold gives it.`, m.id);
    }
    if (progress.repair_rolled_this_arrival) gate('attempt_repair', 'There is one repair roll each time you arrive from a trip, and none is owed now.');
    else if (ship.damage === 'pristine') gate('attempt_repair', `The ${ship.name} is Pristine: nothing to repair.`);
    else if (!has('MEC')) gate('attempt_repair', needs('MEC'));
    if (ship.damage === 'pristine') gate('pay_repair', `The ${ship.name} is Pristine: nothing to repair.`);
    else if (char.credits - 150 <= -300) gate('pay_repair', `Paying 150c would take your debt to 300c or past it; you have ${char.credits}c.`);
    if (progress.unrest_rolled_this_arrival) gate('attempt_reduce_unrest', 'There is one unrest roll each time you arrive from a trip, and none is owed now.');
    else if (!state.crew.some((c) => c.anger_tokens > 0)) gate('attempt_reduce_unrest', 'No crew member holds an anger token.');
    else if (!has('LEA')) gate('attempt_reduce_unrest', needs('LEA'));
    if (progress.unnamed_rolled === true) gate('recruit_unnamed', 'The docks can be worked once per habitat, and here they have been.');
    else if (!has('DIP')) gate('recruit_unnamed', needs('DIP'));
    else { const full = redShirtRoom(); if (full) gate('recruit_unnamed', full); }
    if (!naturalMec3) {
      gate('fabricate_part', 'Needs a natural Mechanics 3 aboard; a score raised by an item does not count.');
      gate('upgrade_item', 'Needs a natural Mechanics 3 aboard; a score raised by an item does not count.');
    } else {
      if (progress.fabricated_this_arrival === true) gate('fabricate_part', 'One part can be built per visit, and this visit\'s is built.');
      else if (char.credits - 400 <= -300) gate('fabricate_part', `Building a part costs 400c, which would take your debt to 300c or past it; you have ${char.credits}c.`);
      const improvable = state.items.filter((i) => (i.type === 'weapon' || i.type === 'armor') && i.effect.kind === 'ability_bonus' && i.upgraded !== true);
      if (improvable.length === 0) gate('upgrade_item', 'You hold no weapon or armor that adds to a score and is not already an MK-II.');
      else if (char.credits - 200 <= -300) gate('upgrade_item', `Improving an item costs 200c, which would take your debt to 300c or past it; you have ${char.credits}c.`);
    }
    if (!state.items.some((i) => i.type === 'weapon' || i.type === 'armor')) gate('equip_item', 'You hold no weapon or armor.');
    if (state.crew.length === 0) gate('release_crew', 'You have no crew.');
    const prog = habitat.progression;
    if (prog.kind === 'missions_then_travel' && progress.missions_attempted.length < prog.missions_required) {
      gate('depart_for_next_habitat', `${habitat.name} lets you move on once ${prog.missions_required} of its missions have been tried, pass or fail. You have tried ${progress.missions_attempted.length}.`);
    }
    return gates;
  }

  if (pending?.kind === 'space_combat_action' && state.encounter?.kind === 'space_combat' && state.encounter.stage === 'choose_action') {
    const enc = state.encounter;
    if (!has('HAK')) gate('attempt_hack', needs('HAK'));
    if (!has('GUN')) gate('open_fire', needs('GUN'));
    else if (enc.volley_used === true) gate('open_fire', 'The opening volley can be tried once per fight, and it has been.');
    if (!has('MEC')) gate('redline', needs('MEC'));
    else if (enc.redline_used === true) gate('redline', 'The redline can be tried once per fight, and it has been.');
    if (!has('DEM')) gate('attempt_intimidate', needs('DEM'));
    return gates;
  }
  if (pending?.kind === 'boarding_decision' && state.encounter?.kind === 'space_combat') {
    if (state.encounter.survivors_rolled === true) gate('recruit_survivors', 'The survivors can be asked once per victory, and they have been.');
    else if (!has('DIP')) gate('recruit_survivors', needs('DIP'));
    else { const full = redShirtRoom(); if (full) gate('recruit_survivors', full); }
    return gates;
  }
  if (pending?.kind === 'hazard_option' && !pending.must_fail) {
    const rank = pending.card_id.replace(/[HDSC]$/, '') as keyof typeof SPADE_HAZARDS;
    const hazard = SPADE_HAZARDS[rank];
    if (hazard) {
      for (const [n, opt] of [[1, hazard.option1] as const, [2, hazard.option2] as const]) {
        if (!anyoneHasEffective(state, opt.ability)) gate('choose_hazard_option', `Nobody aboard has ${ABILITY_NAMES[opt.ability]} (${opt.ability}).`, `option-${n}`);
      }
    }
    return gates;
  }
  if (pending?.kind === 'space_mission_offer') {
    const rank = pending.card_id.replace(/[HDSC]$/, '') as keyof typeof CLUB_MISSIONS;
    const entry = CLUB_MISSIONS[rank];
    if (entry?.kind === 'choice') {
      for (const [n, m] of [[1, entry.option1] as const, [2, entry.option2] as const]) {
        if (m.goal.kind === 'ability_check' && !partyQualifiesFor(state, m.goal.ability)) {
          gate('accept_mission', `Nobody aboard has ${ABILITY_NAMES[m.goal.ability]} (${m.goal.ability}), and no item you hold gives it.`, `option-${n}`);
        }
      }
    }
    return gates;
  }
  return gates;
}

// ---------------------------------------------------------------------------
// The ruin map, for a table that draws it
// ---------------------------------------------------------------------------

/** What each being on the map can do this round: where it can end a move, how
 *  far it may still go, and how it would attack. */
export function ruinPartyFacts(state: WarbleWayGalaxyState): Record<string, {
  title: string;
  move_allowance: number;
  moves_left: number;
  reach: string[];
  attack: { ability: AbilityId; bonus: number; range: number; advantage: boolean };
}> {
  const enc = state.encounter;
  if (enc?.kind !== 'ruin_run' || !enc.board) return {};
  const out: ReturnType<typeof ruinPartyFacts> = {};
  for (const t of enc.board.tokens) {
    // A token whose being cannot be found (a half-built board) simply carries no facts.
    try {
      const allowance = movementAllowance(state, t);
      const attack = bestAttackAbility(state, t);
      out[t.name] = {
        title: t.is_character || t.unnamed === true ? t.name : crewTitle(state, t.name),
        move_allowance: allowance,
        moves_left: Math.max(0, allowance - t.moved),
        reach: t.ended ? [] : [...ruinReachable(state, t.name).keys()],
        attack: { ability: attack.ability, bonus: attack.bonus, range: attackRangeOf(state, t), advantage: tokenGroundAdvantage(state, t) },
      };
    } catch {
      // no facts for this token
    }
  }
  return out;
}

/** Before a level is set up: how each being who could go in would move and
 *  fight, so the party can be chosen against the attackers' numbers. */
export function ruinCandidateFacts(state: WarbleWayGalaxyState): Array<{
  name: string;
  title: string;
  kind: 'captain' | 'crew' | 'red_shirt';
  move_allowance: number;
  attack: { ability: AbilityId; bonus: number; range: number; advantage: boolean };
}> {
  const out: ReturnType<typeof ruinCandidateFacts> = [];
  const add = (name: string, title: string, kind: 'captain' | 'crew' | 'red_shirt') => {
    const t = { name, is_character: kind === 'captain', cell: '', moved: 0, acted: false, ended: false, has_attacked: false, ...(kind === 'red_shirt' ? { unnamed: true } : {}) };
    try {
      const attack = bestAttackAbility(state, t);
      out.push({ name, title, kind, move_allowance: movementAllowance(state, t), attack: { ability: attack.ability, bonus: attack.bonus, range: attackRangeOf(state, t), advantage: tokenGroundAdvantage(state, t) } });
    } catch {
      // no facts for a being with no record
    }
  };
  if (state.character) add(state.character.name, state.character.name, 'captain');
  for (const c of state.crew) add(c.name, crewTitle(state, c.name), 'crew');
  if ((state.unnamed_crew ?? 0) > 0) add('Red Shirt', 'Red shirt', 'red_shirt');
  return out;
}

export function ruinGoal(state: WarbleWayGalaxyState): string | null {
  const enc = state.encounter;
  if (enc?.kind !== 'ruin_run') return null;
  return cellsWhere(ruinMapForLevel(enc.level), 'G')[0] ?? null;
}
