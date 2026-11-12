// Sweetlands Imperium glue: the 80-space ring board with four junction
// roads, per-seat tableaux with the faction portraits, the Intel deck and
// discard piles, the points track and the token pool. View shape per the
// engine (zekel src/games/sweetlands-imperium/views.ts): shared fields plus
// your_hand, your_secret_objectives and your_turn_step for the owning seat;
// players is an ARRAY. Board geometry comes from
// docs/games/sweetlands-imperium.md (sweetlands-board.ts); faction names,
// treats and points to win come from the engine's reference data.
//
// Moves name cards by cardId, never by hand position, and one card can mean
// many moves (which unit, take the action or not, ring or road): a tap on
// the card opens the chooser with exactly the engine's own descriptions.
// Template moves (assign every seat a faction, pick the Intel to discard,
// pick a treat slot) become forms; nothing in them is preselected.

import type { CardData, MapNode, TableauData } from '@zekel/primitives';
import type { GameReferenceResponse } from '@zekel/wire-types';
import type { FormField, GlueModule, GlueInput, LegalMove, MoveForm, SelectEvent, SetupAnswers, SetupField, SetupSeat, TablePlan, Zone } from '@zekel/glue-kit';
import { asArr, asNum, asStr, isObj, shapeHas, words } from '@zekel/glue-kit';
import { answerList, answerText } from '@zekel/glue-kit';
import { SPACES, REGION_FACTION, SPACE_COLORS, TREATS, BOARD } from './sweetlands-board.js';
import { SlScreen } from './SlScreen.js';

const PALETTE: Record<string, string> = {
  ...SPACE_COLORS,
  milkshake: REGION_FACTION[1]!.color,
  fudge: REGION_FACTION[2]!.color,
  jellybean: REGION_FACTION[3]!.color,
  cheesecake: REGION_FACTION[4]!.color,
  nomads: '#2c2c2c',
  castle: '#f0d9b5',
  foe: '#7a1f1f',
  treat: '#f7c8d8',
  sugar: '#ffffff',
  influence: '#9013fe',
  tax: '#c9a227',
};

/** The printed art, by the engine's treat and faction ids. Each faction's
 *  page carries its regional treat (-1) and the random treat drawn beside
 *  it (-2); the Nomads' page carries the quiche and the tomato. */
const TREAT_ART: Record<string, string> = {
  milkshake: '/art/sweetlands/treat-milkshake-1.png',
  ice_cream: '/art/sweetlands/treat-milkshake-2.png',
  fudge: '/art/sweetlands/treat-fudge-1.png',
  chocolate_bar: '/art/sweetlands/treat-fudge-2.png',
  jellybean: '/art/sweetlands/treat-jellybean-1.png',
  gummy_bear: '/art/sweetlands/treat-jellybean-2.png',
  cheesecake: '/art/sweetlands/treat-cheesecake-1.png',
  cupcake: '/art/sweetlands/treat-cheesecake-2.png',
  quiche: '/art/sweetlands/treat-quiche-1.png',
  tomato: '/art/sweetlands/treat-quiche-2.png',
};
const PORTRAIT: Record<string, string> = {
  milkshake: '/art/sweetlands/sweet-milkshake.jpg',
  fudge: '/art/sweetlands/sweet-fudge.jpg',
  jellybean: '/art/sweetlands/sweet-jellybean.jpg',
  cheesecake: '/art/sweetlands/sweet-cheesecake.jpg',
  nomads: '/art/sweetlands/sweet-quiche.jpg',
};
/** Each region's own treat, as printed on the board (docs/games). */
const REGION_TREAT: Record<number, string> = { 1: 'milkshake', 2: 'fudge', 3: 'jellybean', 4: 'cheesecake' };

const UNITS = ['leader', 'knight', 'ambassador'] as const;

interface UnitLocation {
  zone: 'offboard' | 'start' | 'ring' | 'road' | 'castle' | 'treat';
  region?: number;
  ringIndex?: number;
  roadIndex?: number;
  slotKind?: 'regional' | 'random';
}

function locToSpaceId(loc: unknown): string | null {
  if (!isObj(loc)) return null;
  const l = loc as unknown as UnitLocation;
  if (l.zone === 'ring' && typeof l.ringIndex === 'number' && typeof l.region === 'number') return `r${l.region}-ring-${l.ringIndex}`;
  if (l.zone === 'road' && typeof l.roadIndex === 'number' && typeof l.region === 'number') return `r${l.region}-road-${l.roadIndex}`;
  if (l.zone === 'castle') return 'castle';
  if (l.zone === 'start' && typeof l.region === 'number') return `r${l.region}-start`;
  if (l.zone === 'treat' && typeof l.region === 'number') return `r${l.region}-treat-${l.slotKind ?? 'regional'}`;
  return null;
}

function factionColorKey(faction: unknown): string {
  const f = asStr(faction).toLowerCase();
  for (const k of ['milkshake', 'fudge', 'jellybean', 'cheesecake']) if (f.includes(k)) return k;
  return 'nomads';
}

interface RefFaction { id: string; name: string; region: number | null; color: string; ability: string }

function referenceFactions(reference: GameReferenceResponse | null): RefFaction[] {
  const rd = reference?.referenceData;
  if (!isObj(rd)) return [];
  return asArr(rd['factions']).flatMap((f) => {
    if (!isObj(f) || typeof f['id'] !== 'string') return [];
    return [{
      id: f['id'], name: asStr(f['name'], words(f['id'])),
      region: typeof f['region'] === 'number' ? f['region'] : null,
      color: asStr(f['color']), ability: asStr(f['ability']),
    }];
  });
}

function factionName(id: string, reference: GameReferenceResponse | null): string {
  return referenceFactions(reference).find((f) => f.id === id)?.name ?? words(id);
}

function intelCard(c: unknown, fallbackId: string): CardData {
  if (!isObj(c)) return { id: fallbackId, label: 'card' };
  const id = asStr(c['card_id'], fallbackId);
  const kind = asStr(c['kind']);
  const color = asStr(c['color']);
  const treat = asStr(c['treat']);
  if (kind === 'treat') {
    return { id: `sl:card:${id}`, label: words(treat || 'treat'), subtitle: 'Treat', artUrl: TREAT_ART[treat], colorKey: 'treat' };
  }
  return {
    id: `sl:card:${id}`,
    label: kind === 'double' ? `${words(color)} ×2` : words(color),
    subtitle: `${words(kind)} Intel`,
    colorKey: color || undefined,
  };
}

function pointsToWin(reference: GameReferenceResponse | null): number | undefined {
  const rd = reference?.referenceData;
  return isObj(rd) && typeof rd['points_to_win'] === 'number' ? rd['points_to_win'] : undefined;
}

const pct = (col: number, row: number) => ({
  x: (col / (BOARD.cols - 1)) * 92 + 4,
  y: ((row - 1) / (BOARD.rows - 1)) * 88 + 6,
});

function myPlayer(view: Record<string, unknown>, me: string | null): Record<string, unknown> | null {
  const p = asArr(view['players']).find((x) => isObj(x) && x['player_id'] === me);
  return isObj(p) ? p : null;
}

/** The view is this game's: the shared fields, and this game's id or its taxes. */
function isSweetlandsView(view: unknown): view is Record<string, unknown> {
  if (!shapeHas(view, 'players', 'phase')) return false;
  return asStr(view['game_id'], 'sweetlands-imperium') === 'sweetlands-imperium' || 'taxes' in view;
}

function cardIdOf(m: LegalMove): string | null {
  const id = m.move['cardId'];
  return typeof id === 'string' ? id : null;
}

export const sweetlandsGlue: GlueModule = {
  gameId: 'sweetlands-imperium',
  title: 'Sweetlands Imperium',
  /** The candy table (docs/design/sweetlands-candy) draws its own screen;
   *  the plan below keeps the shared primitives' shape for the debug client. */
  Screen: SlScreen,

  /** The candy theme (docs/design/sweetlands-candy): the table's own look,
   *  for every seat and for a watcher, once the view is this game's. */
  themeFor(input: GlueInput): string | null {
    return isSweetlandsView(input.view) ? 'sl-theme' : null;
  },

  plan(input: GlueInput): TablePlan | null {
    const { view } = input;
    if (!isSweetlandsView(view)) return null;
    const players = asArr(view['players']);
    if (players.length === 0) return null;
    const me = input.playerId;
    const toWin = pointsToWin(input.reference);
    const phase = asStr(view['phase']);

    // --- the 80-space map; units as pieces on nodes --------------------------
    const pieces = new Map<string, MapNode['pieces']>();
    for (const p of players) {
      if (!isObj(p)) continue;
      const ck = factionColorKey(p['faction']);
      const pid = asStr(p['player_id']);
      const locs = isObj(p['unit_locations']) ? p['unit_locations'] : {};
      for (const [unit, loc] of Object.entries(locs)) {
        const sid = locToSpaceId(loc);
        if (!sid) continue;
        const list = pieces.get(sid) ?? [];
        // The label's first letter is the glyph (L, K, A); the seat keeps two
        // players' pieces apart even before factions are assigned.
        list!.push({ label: `${unit} (${pid})`, colorKey: ck });
        pieces.set(sid, list);
      }
    }
    const castleOcc = asStr(view['castle_occupant_id']);
    const placement = isObj(view['random_treat_placement']) ? view['random_treat_placement'] : {};
    const foe = isObj(view['foe']) ? view['foe'] : null;

    const nodes: MapNode[] = SPACES.map((s) => {
      const node: MapNode = {
        id: s.id,
        label: '',
        ...pct(s.col, s.row),
        colorKey: s.color ?? REGION_FACTION[s.region]!.colorKey,
        size: s.zone === 'treat' ? 1.15 : 0.7,
        pieces: pieces.get(s.id) ?? [],
        roadsTo: s.zone === 'ring' && s.index === 5 ? [`r${s.region}-road-0`] : s.zone === 'road' && s.index < 5 ? [`r${s.region}-road-${s.index + 1}`] : [],
      };
      if (s.zone === 'treat') {
        const treat = s.index === 0 ? REGION_TREAT[s.region]! : asStr(placement[String(s.region)]);
        node.label = treat ? words(treat) : '?';
        node.colorKey = 'treat';
        node.artUrl = TREAT_ART[treat];
      }
      return node;
    });
    const occupant = players.find((p) => isObj(p) && p['player_id'] === castleOcc);
    nodes.push({
      id: 'castle', label: 'Candy Castle', x: 50, y: 53, colorKey: 'castle', size: 1.6,
      pieces: [
        ...(foe && asStr(foe['type']) && foe['defeated'] !== true ? [{ label: `foe:${asStr(foe['type'])}`, colorKey: 'foe' }] : []),
        ...(castleOcc ? [{ label: castleOcc, colorKey: factionColorKey(isObj(occupant) ? occupant['faction'] : null) }] : []),
      ],
      badges: foe ? [foe['defeated'] === true ? `${words(asStr(foe['type']))} defeated` : words(asStr(foe['type']))] : [],
      roadsTo: ['r1-road-5', 'r2-road-5', 'r3-road-5', 'r4-road-5'],
    });
    for (const r of [1, 2, 3, 4] as const) {
      nodes.push({
        id: `r${r}-start`,
        label: `${factionName(REGION_FACTION[r]!.colorKey, input.reference).split(' ').pop()} start`,
        ...pct(TREATS[r]!.start[1]!, TREATS[r]!.start[0]!),
        colorKey: REGION_FACTION[r]!.colorKey,
        pieces: pieces.get(`r${r}-start`) ?? [],
      });
    }

    const board: Zone[] = [
      { kind: 'map', id: 'sl:map', data: { label: 'Sweetlands', aspect: 80, nodes } },
      { kind: 'card-zone', id: 'sl:intel-deck', data: { label: 'Intel deck', mode: 'pile', countOnly: asNum(view['intel_deck_count']) } },
      { kind: 'card-zone', id: 'sl:intel-discard', arriveFrom: 'sl:intel-deck', data: { label: 'Intel discard', mode: 'pile', countOnly: asNum(view['intel_discard_count']) } },
    ];

    // --- per-seat tableaux; this seat's hand in the bench -------------------
    const side: Zone[] = [];
    const bench: Zone[] = [];
    const activePid = asStr(view['active_player_id']);
    const pointsSpaces: Array<{ index: number; pieces: { label: string; colorKey?: string }[] }> = [];
    const maxPoints = Math.max(toWin ?? 0, ...players.map((p) => (isObj(p) ? asNum(p['points']) : 0)));
    for (let i = 0; i <= maxPoints; i++) pointsSpaces.push({ index: i, pieces: [] });
    for (const p of players) {
      if (!isObj(p)) continue;
      const pid = asStr(p['player_id']);
      const ck = factionColorKey(p['faction']);
      const units = isObj(p['units']) ? p['units'] : {};
      const stats: NonNullable<TableauData['stats']> = [
        { label: 'Points', value: asNum(p['points']), max: toWin },
        { label: 'Influence', value: asNum(p['influence']) },
        { label: 'Sugar cubes', value: asNum(p['sugar_cubes']) },
        { label: 'Intel tokens', value: asArr(p['intel_tokens']).map((x) => words(asStr(x))).join(', ') || 'none' },
        { label: 'Hand', value: asNum(p['hand_count']) },
        ...Object.entries(units).map(([u, where]) => ({ label: words(u), value: asStr(where, 'off-board') })),
      ];
      // Before the factions are assigned the engine's default faction means
      // nothing; the seat is the name then.
      const assigned = phase !== 'setup_factions' && !!p['faction'];
      const label = assigned ? asStr(p['faction_name'], words(ck)) : `Seat ${players.indexOf(p) + 1}`;
      // Your own card sits in the bench beside the hand: the counts only,
      // since the map shows your units and the hand shows itself.
      const benchStats = stats.filter((s) => ['Points', 'Influence', 'Sugar cubes', 'Intel tokens'].includes(s.label));
      const tableau: Zone = {
        kind: 'tableau', id: `sl:p:${pid}`,
        data: {
          label: `${label}${pid === me ? ' (you)' : ''}`, owner: assigned ? ck : undefined, active: pid === activePid,
          stats: pid === me ? benchStats : stats,
          artUrl: assigned ? PORTRAIT[ck] : undefined,
        },
      };
      pointsSpaces[asNum(p['points'])]?.pieces.push({ label: `${ck} (${pid})`, colorKey: ck });
      if (pid === me) bench.push(tableau); else side.push(tableau);
    }
    const taxes = isObj(view['taxes']) ? view['taxes'] : null;
    if (taxes) {
      side.push({
        kind: 'track', id: 'sl:taxes',
        data: {
          label: 'Taxes by region',
          spaces: ([1, 2, 3, 4] as const).map((r) => ({
            index: r, label: `${factionName(REGION_FACTION[r]!.colorKey, input.reference).split(' ').pop()}: ${asNum(taxes[String(r)])}`,
            pieces: Array.from({ length: asNum(taxes[String(r)]) }, () => ({ label: 'tax', colorKey: 'tax' })),
          })),
        },
      });
    }
    const mine = myPlayer(view, me);
    if (mine) {
      bench.push({
        kind: 'pool', id: 'sl:tokens',
        data: {
          label: 'Your tokens',
          items: [
            { label: 'sugar', count: asNum(mine['sugar_cubes']), colorKey: 'sugar' },
            { label: 'influence', count: asNum(mine['influence']), colorKey: 'influence' },
            ...asArr(mine['intel_tokens']).map((t) => ({ label: `${asStr(t)} Intel`, count: 1, colorKey: asStr(t) })),
          ],
        },
      });
    }
    if (Array.isArray(view['your_hand'])) {
      bench.push({
        kind: 'card-zone', id: 'sl:hand', arriveFrom: 'sl:intel-deck',
        data: { label: 'Your Intel', mode: 'fan', cards: (view['your_hand'] as unknown[]).map((c, i) => intelCard(c, `sl:hand:${i}`)) },
      });
    }
    const secrets = asArr(view['your_secret_objectives']).map((x) => asStr(x)).filter(Boolean);
    if (secrets.length > 0) {
      bench.push({
        kind: 'card-zone', id: 'sl:secrets',
        data: { label: 'Your secret objectives', mode: 'row', cards: secrets.map((s) => ({ id: `sl:secret:${s}`, label: words(s), subtitle: 'Secret', colorKey: 'treat' })) },
      });
    }
    // The other seats, the taxes and the points ride with the board zones,
    // not in the side column: the table draws a plan's side zones even
    // beside a screen, and the candy screen draws its own players panel.
    board.push(...side, { kind: 'track', id: 'sl:points', data: { label: 'Points', spaces: pointsSpaces } });
    const step = asStr(view['your_turn_step']);
    const status = phase.startsWith('setup')
      ? `Setup · ${words(phase.replace(/^setup_/, ''))}`
      : `Round ${asNum(view['round'], 1)} · ${words(phase)}${step ? ` · ${words(step)}` : ''}`;
    return { board, bench, side: [], palette: PALETTE, title: 'Sweetlands Imperium', status };
  },

  litParts(input: GlueInput): string[] {
    const lit: string[] = [];
    const home = isObj(input.view) ? asNum(myPlayer(input.view, input.playerId)?.['home_region']) : 0;
    for (const m of input.legalMoves) {
      const t = asStr(m.move['type']);
      const cardId = cardIdOf(m);
      if (t === 'play_intel' && cardId) lit.push(`sl:card:${cardId}`);
      if (t === 'play_token') lit.push('sl:tokens');
      if (t === 'choose_foe') lit.push('castle');
      if (t === 'recall' && home) lit.push(`r${home}-start`);
    }
    return [...new Set(lit)];
  },

  moveForSelect(sel: SelectEvent, input: GlueInput): LegalMove | null {
    const all = sweetlandsGlue.movesForSelect!(sel, input);
    return all.length === 1 ? all[0]! : null;
  },

  movesForSelect(sel: SelectEvent, input: GlueInput): LegalMove[] {
    const card = /^sl:card:(.+)$/.exec(sel.id);
    if (card) return input.legalMoves.filter((m) => m.move['type'] === 'play_intel' && cardIdOf(m) === card[1]);
    if (sel.id === 'sl:tokens') return input.legalMoves.filter((m) => m.move['type'] === 'play_token');
    if (sel.id === 'castle') return input.legalMoves.filter((m) => m.move['type'] === 'choose_foe');
    if (/^r\d-start$/.test(sel.id)) return input.legalMoves.filter((m) => m.move['type'] === 'recall');
    return [];
  },

  formFor(move: LegalMove, input: GlueInput): MoveForm | null {
    const t = asStr(move.move['type']);
    const view = isObj(input.view) ? input.view : {};
    if (t === 'assign_setup_choices') {
      // Every seat chooses a faction; the template's default map is not an answer.
      const players = asArr(view['players']).filter(isObj);
      const factions = referenceFactions(input.reference)
        .filter((f) => players.length === 5 ? true : f.id !== 'nomads');
      const options = factions.map((f) => ({ value: f.id, label: f.name, hint: f.ability }));
      const fields: FormField[] = players.map((p) => {
        const pid = asStr(p['player_id']);
        const who = pid === input.playerId ? 'you' : p['kind'] === 'ai' ? 'AI' : 'friend';
        return { kind: 'choice', key: `seat.${pid}`, label: `${pid} (${who})`, options };
      });
      return {
        title: 'Choose factions',
        help: 'Each seat plays one faction. Pick for every seat at this table; no two seats share a faction.',
        fields,
        template: move,
        editableKeys: ['selections'],
        submitLabel: 'Seat the factions',
        build(answers) {
          const selections: Record<string, string> = {};
          for (const p of players) {
            const pid = asStr(p['player_id']);
            const v = answerText(answers, `seat.${pid}`);
            if (!v) return null;
            selections[pid] = v;
          }
          if (new Set(Object.values(selections)).size !== players.length) return null;
          return { ...move.move, selections };
        },
      };
    }
    if (t === 'play_intel' && 'treatRegion' in move.move) {
      const regions = ([1, 2, 3, 4] as const).map((r) => ({ value: String(r), label: `Region ${r}: ${factionName(REGION_FACTION[r]!.colorKey, input.reference)}` }));
      return {
        title: 'Which treat space?',
        help: move.description,
        fields: [
          { kind: 'choice', key: 'treatRegion', label: 'Region', options: regions },
          { kind: 'choice', key: 'treatSlot', label: 'Slot', options: [{ value: 'regional', label: "The region's own treat" }, { value: 'random', label: 'The random treat slot' }] },
        ],
        template: move,
        editableKeys: ['treatRegion', 'treatSlot'],
        build(answers) {
          const region = answerText(answers, 'treatRegion');
          const slot = answerText(answers, 'treatSlot');
          if (!region || !slot) return null;
          return { ...move.move, treatRegion: Number(region), treatSlot: slot };
        },
      };
    }
    if (t === 'discard_for_color') {
      const need = asArr(move.move['cardIds']).length;
      const hand = asArr(view['your_hand']).filter(isObj);
      const options = hand.map((c, i) => {
        const card = intelCard(c, `sl:hand:${i}`);
        return { value: asStr(c['card_id'], `sl:hand:${i}`), label: `${card.label} (${card.subtitle ?? ''})` };
      });
      return {
        title: `Discard ${need} Intel for ${words(asStr(move.move['color']))}`,
        help: move.description,
        fields: [{ kind: 'multi', key: 'cardIds', label: `Pick the ${need} cards to discard`, options, pick: need }],
        template: move,
        editableKeys: ['cardIds'],
        build(answers) {
          const ids = answerList(answers, 'cardIds');
          if (ids.length !== need) return null;
          return { ...move.move, cardIds: ids };
        },
      };
    }
    return null;
  },

  resolveReportMove(legalMoves: LegalMove[]): LegalMove | null {
    return legalMoves.find((m) => m.move['type'] === 'resolve_report') ?? null;
  },

  /**
   * Against the AI the host makes every setup choice here: a faction per
   * seat (the AI seats' too, as the engine asks the first human to assign
   * them all) and the castle foe. With a friend at the table the factions
   * stay at the table, since each person chooses their own; the secret
   * objectives are dealt in play and always stay there.
   */
  setupFields(reference: GameReferenceResponse, seats?: SetupSeat[]): SetupField[] {
    if (!seats || seats.some((s) => s.kind === 'human' && !s.host)) return [];
    const factions = referenceFactions(reference).filter((f) => seats.length === 5 ? true : f.id !== 'nomads');
    if (factions.length === 0) return [];
    const options = factions.map((f) => ({ value: f.id, label: f.name, hint: f.ability }));
    const fields: SetupField[] = seats.map((s) => ({
      kind: 'choice', key: `faction.p${s.position + 1}`,
      label: s.host ? 'Your faction' : `Seat ${s.position + 1}'s faction (AI${s.aiDifficulty ? `, ${s.aiDifficulty}` : ''})`,
      help: s.host ? 'No two seats share a faction.' : undefined,
      options,
    }));
    const rd = reference.referenceData;
    const foes = isObj(rd) ? asArr(rd['foes']).flatMap((f) => (isObj(f) && typeof f['type'] === 'string' ? [{ type: f['type'], dice: asNum(f['dice']) }] : [])) : [];
    if (foes.length > 0) {
      fields.push({
        kind: 'choice', key: 'foe', label: 'The castle foe',
        help: 'Guards the Candy Castle until a knight defeats it.',
        options: foes.map((f) => ({ value: f.type, label: words(f.type), hint: f.dice ? `rolls ${f.dice} dice` : undefined })),
      });
    }
    return fields;
  },

  setupMoves(answers: SetupAnswers, seats: SetupSeat[], _reference: GameReferenceResponse): Array<Record<string, unknown>> {
    const selections: Record<string, string> = {};
    for (const s of seats) {
      const v = answers[`faction.p${s.position + 1}`];
      if (typeof v === 'string' && v) selections[`p${s.position + 1}`] = v;
    }
    const moves: Array<Record<string, unknown>> = [];
    if (Object.keys(selections).length === seats.length) moves.push({ type: 'assign_setup_choices', selections });
    const foe = answers['foe'];
    if (typeof foe === 'string' && foe) moves.push({ type: 'choose_foe', foe });
    return moves;
  },

  diceFor() {
    // Sugar dice are totals of 0-3 faces, not d6 pips; the summary carries
    // both totals ("(7 vs 4)") and the log shows it.
    return null;
  },
};

export { UNITS as SWEETLANDS_UNITS, TREAT_ART as SWEETLANDS_TREAT_ART };
export default sweetlandsGlue;
