// Reading Fractured Fist's view for the table (docs/games/fractured-fist.md,
// docs/games/fractured-fist-arcade-build.md). The view shape is the engine's
// (zekel src/games/fractured-fist/views.ts):
//   view = {
//     phase, round, active_player_id, player_order, players_done_this_round,
//     players: { [pid]: { kind, stamina, max_stamina, deck_size, hand_size,
//       discard_size, discard?, played: string[], damage_queued,
//       defense_queued, actions, channels, spirit, refine_pending,
//       misstep_count, starting_hand_size, focus_reloads_this_turn,
//       supply: { [cardId]: count },
//       hand?: string[], deck_count_by_card?   // this seat only
//     } },
//     winners, scores, result_summary
//   }
// Card names, types, costs, values, effects and factions come from the
// engine's reference data (get_rules), never from a table here. The misstep
// cap is reference_data.max_missteps; max stamina is on the view; the
// default loadout is reference_data.starter_loadout. The engine resolves
// every draw inside the move that causes it and lists no draw step, so the
// deck never lights up here (fractured-fist-build.md, the open question).

import type { CardData } from '@zekel/primitives';
import type { GameReferenceResponse } from '@zekel/wire-types';
import type { GlueInput, LegalMove, PlanPrompt, PlanStep, PromptAction, SelectEvent, Zone } from '@zekel/glue-kit';
import { asArr, asNum, asStr, isObj, shapeHas, words } from '@zekel/glue-kit';
import { trackIdentities, type IdentityState } from '@zekel/glue-kit';

/**
 * Card colors from the print-and-play sheet. The corner is the card's kind:
 * a resource, one of the default seven techniques, a technique with no
 * school, a technique with a school, a Misstep. The cost number on a
 * school's card is the school's own color (`ink-` keys), which also marks
 * the school on the setup page. The table publishes these as CSS variables
 * and the theme draws each card's corner from its color key (ff.css).
 */
export const PALETTE: Record<string, string> = {
  resource: '#F2E53A',
  starter: '#19A58B',
  technique: '#2A74B8',
  misstep: '#111111',
  'masters-circle': '#8A6BB0',
  uncounted: '#8A6BB0',
  'titan-entertainment': '#8A6BB0',
  'the-awakened': '#8A6BB0',
  'ink-masters-circle': '#FFFFFF',
  'ink-uncounted': '#111111',
  'ink-titan-entertainment': '#FF8A1F',
  'ink-the-awakened': '#A6E22E',
  you: '#3E7C4F',
  opponent: '#b4452f',
  round: '#E8862E',
  damage: '#b3261e',
  defense: '#24507f',
};

/** The printed word for each effect key the engine's reference data uses. */
export const EFFECT_WORDS: Record<string, string> = {
  damage: 'Damage', defense: 'Defense', actions: 'Tech', draw: 'Draw', spirit: 'Spirit',
  channels: 'Channel', refine: 'Refine', add_misstep: 'Missteps', heal: 'Heal',
};
export const EFFECT_ORDER = Object.keys(EFFECT_WORDS);

export interface CardDef {
  id: string; name: string; type: string; cost: number; value?: number; description?: string; faction?: string;
  effects: Record<string, number>;
  /** one of the engine's default seven (reference_data.starter_loadout) */
  starter: boolean;
}

export function cardDefs(reference: GameReferenceResponse | null): Map<string, CardDef> {
  const rd = reference?.referenceData;
  const out = new Map<string, CardDef>();
  const starters = new Set(starterLoadout(reference));
  if (isObj(rd) && Array.isArray(rd['cards'])) {
    for (const c of rd['cards']) {
      if (isObj(c) && typeof c['id'] === 'string') {
        const effects: Record<string, number> = {};
        if (isObj(c['effects'])) {
          for (const [k, v] of Object.entries(c['effects'])) if (typeof v === 'number' && v > 0) effects[k] = v;
        }
        out.set(c['id'], {
          id: c['id'], name: asStr(c['name'], words(c['id'])), type: asStr(c['type']), cost: asNum(c['cost']),
          value: typeof c['value'] === 'number' ? c['value'] : undefined,
          description: asStr(c['description']) || undefined, faction: asStr(c['faction']) || undefined,
          effects,
          starter: starters.has(c['id']),
        });
      }
    }
  }
  return out;
}

export function maxMissteps(reference: GameReferenceResponse | null): number | null {
  const rd = reference?.referenceData;
  return isObj(rd) && typeof rd['max_missteps'] === 'number' ? rd['max_missteps'] : null;
}

export function starterLoadout(reference: GameReferenceResponse | null): string[] {
  const rd = reference?.referenceData;
  return isObj(rd) ? asArr(rd['starter_loadout']).map((x) => asStr(x)).filter(Boolean) : [];
}

/** "+2 Draw, +1 Tech" chips from the engine's effects, in the printed order. */
export function effectChips(def: CardDef | undefined): string[] {
  if (!def) return [];
  return EFFECT_ORDER.filter((k) => def.effects[k]).map((k) => `+${def.effects[k]} ${EFFECT_WORDS[k]}`);
}

/** A card's color key: its school, or its kind (resource, one of the
 *  default seven, a technique with no school, a Misstep). */
export function colorKeyFor(def: CardDef | undefined): string | undefined {
  if (!def) return undefined;
  if (def.faction) return def.faction.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  if (def.type === 'TECHNIQUE' && def.starter) return 'starter';
  return def.type.toLowerCase();
}

/**
 * The cards that have a scene, by engine id: the files copied from
 * docs/design/fractured-fist-arcade/art into public/cards/fractured-fist.
 * This says which pictures exist, nothing about the cards themselves.
 */
const ART = new Set([
  'assess', 'attack', 'block', 'center', 'combination_rush', 'defensive_kata', 'deflecting_block', 'devastating_blow',
  'distract', 'energy_channeling', 'enlightened_flow', 'flowing_counter', 'flying_kick', 'focus', 'grand_finale',
  'impose_pressure', 'inner_harmony', 'leg_sweep', 'masters_riposte', 'mastery', 'mental_clarity', 'misstep', 'momentum',
  'overwhelming_assault', 'perfect_form', 'quicken', 'react', 'reading_the_opponent', 'ruthless_barrage', 'showstopper',
  'smoke_bomb', 'targeted_strike', 'thoughtful_composure', 'transcendent_strike',
]);

export function artUrlFor(cardId: string): string | undefined {
  return ART.has(cardId) ? `/cards/fractured-fist/${cardId}.svg` : undefined;
}

/**
 * A card's face, as the print-and-play sheet lays it out: the cost in the
 * corner (a Misstep has none), the name, the art, and the effects as chips;
 * a resource shows what it is worth. Every number is the reference data's.
 */
/** What a resource is worth, when it is worth anything. */
export function worthOf(def: CardDef | undefined): number | undefined {
  return def?.type === 'RESOURCE' && def.value !== undefined && def.value > 0 ? def.value : undefined;
}

/** The chips on a card's face: a resource's worth, else its effects. */
export function faceChips(def: CardDef | undefined): string[] {
  const worth = worthOf(def);
  return worth !== undefined ? [`Worth ${worth}`] : effectChips(def);
}

function cardData(cardId: string, instance: string, defs: Map<string, CardDef>, face: 'up' | 'down' = 'up'): CardData {
  const def = defs.get(cardId);
  const worth = worthOf(def);
  const chips = faceChips(def);
  // A card with no effects says what it is in its own words ("Unplayable.
  // Refine to remove."), when they are short enough to sit on the face.
  const subtitle = chips.length === 0 && def?.description && def.description.length <= 40 ? def.description : undefined;
  return {
    id: instance,
    label: def?.name ?? words(cardId),
    subtitle,
    colorKey: colorKeyFor(def) ?? 'technique',
    cost: def && def.type !== 'MISSTEP' ? def.cost : undefined,
    value: worth,
    artUrl: artUrlFor(cardId),
    badges: chips,
    face,
  };
}

const ZONES = ['hand', 'played', 'discard'] as const;

type Contents = { hand: string[]; played: string[]; discard: string[] };

function contentsOf(p: Record<string, unknown>): Contents {
  return {
    hand: asArr(p['hand']).map((x) => asStr(x)),
    played: asArr(p['played']).map((x) => asStr(x)),
    discard: asArr(p['discard']).map((x) => asStr(x)),
  };
}

function cardOf(instance: string): string {
  return instance.slice(instance.indexOf('|') + 1, instance.lastIndexOf('#'));
}

/** The shelf's stack for a card: the one place every copy flies from. */
export function shelfCardId(shelfPid: string, cardId: string): string {
  return `p:${shelfPid}:supply:${cardId}`;
}

/** Instance ids for one player's cards, carried across events in memory. */
export function identitiesFor(pid: string, p: Record<string, unknown>, input: GlueInput, shelfPid: string): IdentityState {
  const key = `ff:identity:${pid}`;
  const cached = input.memory.get(key) as { seq: number; state: IdentityState; base: IdentityState | null } | undefined;
  if (cached && cached.seq === input.seq) return cached.state;
  // The state before this event is the one computed for the previous event.
  const base = cached ? (cached.seq < input.seq ? cached.state : cached.base) : null;
  const move = input.engineMove;
  const movedFrom = move && input.actorPlayerId === pid && typeof move['hand_index'] === 'number'
    && (move['type'] === 'play_card' || move['type'] === 'refine_card')
    ? { zone: 'hand', index: move['hand_index'] as number }
    : undefined;
  const prefix = `p:${pid}`;
  // Cleanups: end_turn sends the actor's whole hand to the discard; a new
  // round means the strike swept every played row into its discard.
  const clearedZones: string[] = [];
  if (move && move['type'] === 'end_turn' && input.actorPlayerId === pid) clearedZones.push('hand');
  if (isObj(input.previous) && isObj(input.view) && asNum(input.previous['round']) < asNum(input.view['round'])) clearedZones.push('played');
  const state = trackIdentities(prefix, base, contentsOf(p), {
    movedFrom,
    clearedZones,
    sources: {
      hand: `${prefix}:deck`,
      // Bought cards and pushed Missteps both land in the discard from the
      // shelf: the stack of that card is where every copy comes from.
      discard: 'ff:supply',
      played: `${prefix}:hand`,
    },
  });
  for (const [inst, from] of Object.entries(state.arrivals)) {
    if (from === 'ff:supply') state.arrivals[inst] = shelfCardId(shelfPid, cardOf(inst));
  }
  input.memory.set(key, { seq: input.seq, state, base });
  return state;
}

function playerZones(pid: string, p: Record<string, unknown>, isSelf: boolean, input: GlueInput, defs: Map<string, CardDef>, shelfPid: string) {
  const prefix = `p:${pid}`;
  const ids = identitiesFor(pid, p, input, shelfPid);
  const contents = contentsOf(p);
  const instance = (zone: (typeof ZONES)[number], i: number) => ids.zones[zone]?.[i] ?? `${prefix}:${zone}:${i}`;

  // A watcher has no seat: the players go by their engine names then.
  const watching = input.playerId === null;
  const whose = watching ? `${words(pid)}'s` : isSelf ? 'Your' : 'Their';

  const refining = isSelf && asNum(p['refine_pending']) > 0;
  const handCards: CardData[] = contents.hand.length > 0
    ? contents.hand.map((cid, i) => cardData(cid, instance('hand', i), defs))
    : Array.from({ length: asNum(p['hand_size']) }, (_, i) => ({ id: `${prefix}:hand:back:${i}`, label: 'card', face: 'down' as const }));
  const hand: Zone = {
    kind: 'card-zone', id: `${prefix}:hand`, arriveFrom: `${prefix}:deck`,
    data: { label: `Hand (${asNum(p['hand_size'], contents.hand.length)})${refining ? ' · pick one to remove' : ''}`, mode: 'fan', cards: handCards },
  };
  const deck: Zone = {
    kind: 'card-zone', id: `${prefix}:deck`,
    data: { label: 'Deck', mode: 'pile', countOnly: asNum(p['deck_size']) },
  };
  const discardCards = contents.discard.map((cid, i) => cardData(cid, instance('discard', i), defs));
  const discard: Zone = {
    kind: 'card-zone', id: `${prefix}:discard`, arriveFrom: 'ff:supply',
    data: contents.discard.length > 0 || asNum(p['discard_size']) === 0
      ? { label: 'Discard', mode: 'pile', cards: discardCards }
      : { label: 'Discard', mode: 'pile', countOnly: asNum(p['discard_size']) },
  };
  const played: Zone = {
    kind: 'card-zone', id: `${prefix}:played`, arriveFrom: `${prefix}:hand`, span: 'full',
    data: {
      label: `${whose} played cards`,
      mode: 'row', cards: contents.played.map((cid, i) => cardData(cid, instance('played', i), defs)),
    },
  };
  // Which engine card each drawn card is, and where it sits, in words: what
  // the phone's card sheet needs to show a card up close.
  const where = { hand: watching ? `In ${whose} hand` : isSelf ? 'In your hand' : 'In their hand', played: `${whose} played cards`, discard: `${whose} discard` };
  const known: Array<[string, Spot]> = [];
  for (const zone of ZONES) contents[zone].forEach((cid, i) => known.push([instance(zone, i), { cardId: cid, where: where[zone] }]));
  return { hand, deck, discard, played, ids, known };
}

/** One drawn card's engine id and where it is, in words. */
export interface Spot { cardId: string; where: string }

/**
 * One shelf for both supplies. The engine has no shared market: every stack
 * is still its owner's, and the shelf just draws each card once with the
 * two counts on it (docs/games/fractured-fist.md, the shared area).
 */
function shelfZone(order: string[], players: Record<string, unknown>, shelfPid: string, defs: Map<string, CardDef>, watching: boolean, phase: string): Zone {
  const supplies = order.map((pid) => ({ pid, supply: isObj(players[pid]) && isObj((players[pid] as Record<string, unknown>)['supply']) ? ((players[pid] as Record<string, unknown>)['supply'] as Record<string, unknown>) : {} }));
  const cardIds: string[] = [];
  for (const s of supplies) for (const cid of Object.keys(s.supply)) if (!cardIds.includes(cid)) cardIds.push(cid);
  const cards: CardData[] = cardIds.map((cid) => ({
    ...cardData(cid, shelfCardId(shelfPid, cid), defs),
    counts: supplies.map((s) => ({
      label: watching ? words(s.pid) : s.pid === shelfPid ? 'you' : 'them',
      value: asNum(s.supply[cid]),
      own: !watching && s.pid === shelfPid,
    })),
  }));
  return {
    kind: 'card-zone', id: 'ff:supply', span: 'full',
    data: { label: phase === 'channel' ? 'Pick one to buy. It goes to your discard.' : 'Buying opens in the Channel step.', mode: 'list', cards },
  };
}

export function selfPid(input: GlueInput, view: Record<string, unknown>): string | null {
  if (input.playerId) return input.playerId;
  const players = isObj(view['players']) ? view['players'] : {};
  for (const [pid, p] of Object.entries(players)) if (isObj(p) && Array.isArray(p['hand'])) return pid;
  return null;
}

export const STEP_NAMES: Record<string, string> = { technique: 'Technique', channel: 'Channel' };

/** The action bar: the step in words, and a button for each move that moves the turn. */
export function promptFor(view: Record<string, unknown>, me: string | null, defs: Map<string, CardDef>, ids: IdentityState | null, input: GlueInput): PlanPrompt {
  const phase = asStr(view['phase']);
  const activePid = asStr(view['active_player_id']);
  const players = isObj(view['players']) ? view['players'] : {};
  const p = me && isObj(players[me]) ? (players[me] as Record<string, unknown>) : null;
  const moves = input.legalMoves;
  const find = (type: string) => moves.find((m) => m.move['type'] === type) ?? null;
  const actions: PromptAction[] = [];

  if (phase === 'game_over') return { title: 'The fight is over', actions };
  if (!p || activePid !== me) {
    const who = me === null ? words(activePid) : 'Opponent';
    return { title: `${who} is taking their turn`, sub: 'When they finish, both hits land at once.', actions };
  }
  // Your turn, but the engine's menu is not here yet (the board is still
  // playing back): the step in words, no buttons.
  if (moves.length === 0) return { title: phase === 'channel' ? 'Channel step' : 'Technique step', actions };

  const refine = asNum(p['refine_pending']);
  const skip = find('skip_refine');
  if (refine > 0 && skip) {
    actions.push({ id: 'skip-refine', label: 'Skip the rest', move: skip });
    return {
      title: `Remove ${refine} more card${refine === 1 ? '' : 's'}`,
      sub: 'Pick from your hand, or skip the rest. Refined cards leave the game.',
      actions, urgent: true,
    };
  }

  const reload = find('focus_reload');
  if (reload) {
    const used = asNum(p['focus_reloads_this_turn']);
    actions.push({
      id: 'focus-reload', label: 'Focus reload', note: used > 0 ? `used ${used} this turn` : undefined,
      title: 'Discard every Focus in hand and draw that many. Allowed while your stamina is lower.', move: reload,
    });
  }

  let title = 'Technique step';
  let sub = 'Play techniques, one action each. Nothing moves on until you say so.';
  if (phase === 'channel') {
    title = 'Channel step';
    const ch = asNum(p['channels']);
    sub = ch > 0 ? 'Play resources for spirit, then buy from your supply.' : 'No channels left: play resources or end your turn.';
    // Every resource in hand in one press, when there is more than one to
    // press. Each is a listed play; the button says what the press spends.
    const hand = asArr(p['hand']).map((x) => asStr(x));
    const plays = moves.filter((m) => m.move['type'] === 'play_card' && typeof m.move['hand_index'] === 'number' && defs.get(asStr(m.move['card_id']))?.type === 'RESOURCE');
    const batch: SelectEvent[] = [];
    let gain = 0;
    let focus = 0;
    for (const m of plays) {
      const idx = m.move['hand_index'] as number;
      const inst = ids?.zones['hand']?.[idx];
      const def = defs.get(hand[idx] ?? '');
      if (!inst || !def) continue;
      batch.push({ component: 'card', id: inst, label: def.name });
      gain += def.value ?? 0;
      if (def.id === 'focus') focus += 1;
    }
    if (batch.length > 1) {
      const costsReload = reload !== null && focus > 0;
      actions.push({
        id: 'play-all-resources', label: `Play all resources · +${gain}`, short: `All resources +${gain}`,
        note: costsReload ? `spends your ${focus} Focus` : undefined,
        title: `Plays all ${batch.length} resources into your played row at once, for ${gain} spirit.${costsReload ? ` Your ${focus} Focus go with them, so no reload after this.` : ''}`,
        batch,
      });
    }
  } else if (asNum(p['actions']) < 1) {
    title = 'No actions left';
    sub = 'Advance to Channel to spend spirit, or end your turn.';
  }
  const advance = find('advance_phase');
  if (advance) actions.push({ id: 'advance-phase', label: 'Advance to Channel', short: 'To Channel', move: advance });
  const end = find('end_turn');
  if (end) actions.push({ id: 'end-turn', label: 'End turn', primary: true, move: end });
  return { title, sub, actions };
}

/** One fighter, as the plate at the top of the table draws them. Every
 *  number is the view's; the cap is the engine's reference data. */
export interface Fighter {
  pid: string;
  /** this seat's own fighter */
  self: boolean;
  /** "You", or the engine's name; the screen puts a seat's display name over it */
  who: string;
  /** on turn now */
  active: boolean;
  stamina: number;
  maxStamina: number;
  missteps: number;
  misstepCap: number | null;
  handSize: number;
  deckSize: number;
  discardSize: number;
  damageQueued: number;
  defenseQueued: number;
  zones: { hand: Zone; deck: Zone; discard: Zone; played: Zone };
}

export interface Fight {
  round: number;
  phase: string;
  over: boolean;
  /** you on the left (or the first seat, for a watcher), the other on the right */
  left: Fighter;
  right: Fighter;
  /** this seat's fighter, when there is a seat: their hand is the bench */
  me: Fighter | null;
  /** the counters the current step can change, while this seat is on turn */
  counters: Array<{ label: string; value: number }>;
  supply: Zone;
  steps: PlanStep[];
  prompt: PlanPrompt;
  /** every face-up card on the table by its part id: which card, and where */
  cards: Record<string, Spot>;
}

/**
 * Only the counters the current step can change: refines while one is
 * pending, actions in the Technique step, spirit and channels in the
 * Channel step. Stamina and missteps are about the whole game; the plates
 * carry them.
 */
function countersFor(p: Record<string, unknown>, phase: string): Fight['counters'] {
  const out: Fight['counters'] = [];
  if (asNum(p['refine_pending']) > 0) out.push({ label: 'Refines', value: asNum(p['refine_pending']) });
  if (phase === 'technique') out.push({ label: 'Actions', value: asNum(p['actions']) });
  if (phase === 'channel') {
    out.push({ label: 'Spirit', value: asNum(p['spirit']) });
    out.push({ label: 'Channels', value: asNum(p['channels']) });
  }
  return out;
}

/** The whole table as the screen draws it, or null when the view is not a
 *  two-fighter Fractured Fist view. */
export function fightOf(input: GlueInput): Fight | null {
  const { view } = input;
  if (!shapeHas(view, 'players', 'phase', 'player_order')) return null;
  const players = view['players'];
  if (!isObj(players)) return null;
  const order = asArr(view['player_order']).map((x) => asStr(x)).filter((pid) => isObj(players[pid]));
  if (order.length !== 2) return null;
  const defs = cardDefs(input.reference);
  const missCap = maxMissteps(input.reference);
  const me = selfPid(input, view);
  const activePid = asStr(view['active_player_id']);
  const phase = asStr(view['phase']);
  const shelfPid = me ?? order[0]!;
  const watching = input.playerId === null;

  const cards: Record<string, Spot> = {};
  const fighters = order.map((pid): Fighter => {
    const p = players[pid] as Record<string, unknown>;
    const self = pid === me;
    const z = playerZones(pid, p, self, input, defs, shelfPid);
    for (const [part, spot] of z.known) cards[part] = spot;
    return {
      pid, self,
      who: watching ? words(pid) : self ? 'You' : 'Opponent',
      active: pid === activePid && phase !== 'game_over',
      stamina: asNum(p['stamina']),
      maxStamina: asNum(p['max_stamina']),
      missteps: asNum(p['misstep_count']),
      misstepCap: missCap,
      handSize: asNum(p['hand_size'], contentsOf(p).hand.length),
      deckSize: asNum(p['deck_size']),
      discardSize: asNum(p['discard_size'], contentsOf(p).discard.length),
      damageQueued: asNum(p['damage_queued']),
      defenseQueued: asNum(p['defense_queued']),
      zones: { hand: z.hand, deck: z.deck, discard: z.discard, played: z.played },
    };
  });
  const mine = fighters.find((f) => f.self) ?? null;
  const left = mine ?? fighters[0]!;
  const right = fighters.find((f) => f !== left)!;
  const supply = shelfZone(order, players, shelfPid, defs, watching, phase);
  if (supply.kind === 'card-zone') {
    for (const c of supply.data.cards ?? []) {
      const m = /:supply:(.+)$/.exec(c.id ?? '');
      if (m) cards[c.id!] = { cardId: m[1]!, where: 'In the supply' };
    }
  }
  const myIds = mine ? identitiesFor(mine.pid, players[mine.pid] as Record<string, unknown>, input, shelfPid) : null;
  const counters = mine && mine.active ? countersFor(players[mine.pid] as Record<string, unknown>, phase) : [];
  return {
    round: asNum(view['round'], 1),
    phase,
    over: phase === 'game_over',
    left, right, me: mine, counters,
    supply,
    steps: Object.entries(STEP_NAMES).map(([id, label]) => ({ id, label, current: phase === id })),
    prompt: promptFor(view, me, defs, myIds, input),
    cards,
  };
}

/** Lit part ids for the current legal moves: hand cards by instance, and
 *  your own supply stacks. */
export function litPartsFor(input: GlueInput): string[] {
  const { view, legalMoves } = input;
  if (!shapeHas(view, 'players')) return [];
  const me = selfPid(input, view);
  if (!me) return [];
  const players = isObj(view['players']) ? view['players'] : {};
  const p = isObj(players[me]) ? (players[me] as Record<string, unknown>) : null;
  if (!p) return [];
  const ids = identitiesFor(me, p, input, me);
  const lit: string[] = [];
  for (const m of legalMoves) {
    const t = asStr(m.move['type']);
    if ((t === 'play_card' || t === 'refine_card') && typeof m.move['hand_index'] === 'number') {
      const inst = ids.zones['hand']?.[m.move['hand_index']];
      if (inst) lit.push(inst);
    } else if (t === 'play_card' && typeof m.move['card_id'] === 'string') {
      // An opaque seat lists plays by card id only; light every copy.
      const hand = asArr(p['hand']).map((x) => asStr(x));
      hand.forEach((cid, i) => { if (cid === m.move['card_id']) { const inst = ids.zones['hand']?.[i]; if (inst) lit.push(inst); } });
    } else if (t === 'buy_card') {
      // Only your own stacks ever light: the shelf's stacks are keyed by
      // your seat, and a buy is always from your own supply.
      lit.push(shelfCardId(me, asStr(m.move['card_id'])));
    }
    // The moves that move the turn (advance, end, reload, skip) are the
    // action bar's buttons; the numbered menu lists them too.
  }
  return [...new Set(lit)];
}

/** How many of your stacks the engine lists a buy for. */
export function buyableCount(input: GlueInput): number {
  return new Set(input.legalMoves.filter((m) => m.move['type'] === 'buy_card').map((m) => asStr(m.move['card_id']))).size;
}

/** Given a tap on a lit part, the legal move it submits, or null. */
export function moveForTap(sel: SelectEvent, input: GlueInput): LegalMove | null {
  const { view, legalMoves } = input;
  if (!shapeHas(view, 'players')) return null;
  const me = selfPid(input, view);
  if (!me) return null;
  const players = isObj(view['players']) ? view['players'] : {};
  const p = isObj(players[me]) ? (players[me] as Record<string, unknown>) : null;
  if (!p) return null;
  const supply = new RegExp(`^p:${me}:supply:([a-z0-9_-]+)$`, 'i').exec(sel.id);
  if (supply) {
    return legalMoves.find((m) => m.move['type'] === 'buy_card' && m.move['card_id'] === supply[1]) ?? null;
  }
  const ids = identitiesFor(me, p, input, me);
  const idx = (ids.zones['hand'] ?? []).indexOf(sel.id);
  if (idx < 0) return null;
  const cardId = asArr(p['hand']).map((x) => asStr(x))[idx];
  return (
    legalMoves.find((m) => m.move['type'] === 'play_card' && m.move['hand_index'] === idx) ??
    legalMoves.find((m) => m.move['type'] === 'refine_card' && m.move['hand_index'] === idx) ??
    legalMoves.find((m) => m.move['type'] === 'play_card' && m.move['hand_index'] === undefined && m.move['card_id'] === cardId) ??
    null
  );
}
