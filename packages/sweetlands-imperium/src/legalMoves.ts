// Sweetlands Imperium — legal move enumeration.
//
// Surfaces concrete, ready-to-submit options for the active player (or the setup
// reporter) so the model/AI never has to invent a move shape (CLAUDE.md "don't
// make the model guess").

import type { LegalMove, MoveLanding } from '@zekel/game-kit';
import { availableFactionIds } from './data/factions.js';
import { REGION_TREAT, type RegionId, type TreatId } from './data/board.js';
import { hasJunctionChoice, JUNCTION_INDEX, advanceToColor, pathToColor } from './geometry.js';
import type {
  SweetlandsState, SweetlandsMove, PlayerState, SpaceColor, UnitType, FoeType,
  UnitLocation,
} from './types.js';

const UNITS: UnitType[] = ['leader', 'knight', 'ambassador'];
const COLORS: SpaceColor[] = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];

function mk(move: SweetlandsMove, description: string, landing?: MoveLanding): LegalMove<SweetlandsMove> {
  return { move_id: '', description, move, ...(landing ? { landing } : {}) };
}

/** Where a colored play moves a unit (LegalMove.landing): the movement alone,
 *  before the color's action, walked by the same steps the engine moves by
 *  (engine.ts resolveColorPlay). A double card moves twice; its second stop is
 *  worked out from the first, so an action in between that moves the unit
 *  itself (Purple into the castle, a lost battle sending it home) is not in it.
 *  A unit that cannot advance stays where it is, with an empty path. */
function colorLanding(from: UnitLocation, unit: UnitType, color: SpaceColor, viaRoad: boolean, times: 1 | 2): MoveLanding {
  const path: UnitLocation[] = [];
  const stops: UnitLocation[] = [];
  let cur = from;
  for (let i = 0; i < times; i++) {
    const leg = pathToColor(cur, color, viaRoad);
    if (leg && leg.length > 0) { path.push(...leg); cur = leg[leg.length - 1]!; }
    stops.push(cur);
  }
  return { piece: unit, from, to: cur, path, ...(times === 2 ? { stops } : {}) };
}

/** Where a treat card sends a unit: the slot holding that treat (engine.ts
 *  findTreatSlot, for a move that does not name one itself). */
function treatLanding(state: SweetlandsState, from: UnitLocation, unit: UnitType, treat: TreatId): MoveLanding | undefined {
  const regions: RegionId[] = [1, 2, 3, 4];
  const regional = regions.find((r) => REGION_TREAT[r] === treat);
  const random = regions.find((r) => state.randomTreatPlacement[r] === treat);
  const to: UnitLocation | null = regional ? { zone: 'treat', region: regional, slotKind: 'regional' }
    : random ? { zone: 'treat', region: random, slotKind: 'random' } : null;
  return to ? { piece: unit, from, to, path: [to] } : undefined;
}

/** Whether a unit is on the road or at the ring junction, i.e. can Purple-enter. */
function atCastleEntrance(loc: UnitLocation): boolean {
  return loc.zone === 'road' || (loc.zone === 'ring' && loc.ringIndex === JUNCTION_INDEX);
}

/** Whether playing Red with this unit/move will trigger a castle-foe battle.
 *  Red attacks the foe ONLY when the knight is already inside the castle. */
function redWillBattleFoe(state: SweetlandsState, p: PlayerState, u: UnitType): boolean {
  return u === 'knight' && !!state.foe && !state.foe.defeated && p.units.knight.zone === 'castle';
}

/** Whether playing Purple with this unit/move will enter the castle and battle the foe.
 *  Purple carries a road/junction unit into the castle; a knight entering fights the foe.
 *  advanceToColor can't return the colorless castle node, so we use the effective
 *  post-movement location (destination, or current location if movement is blocked). */
function purpleWillBattleFoe(state: SweetlandsState, p: PlayerState, u: UnitType, from: UnitLocation, viaRoad: boolean): boolean {
  if (!state.foe || state.foe.defeated) return false;
  if (u !== 'knight') return false;
  const dest = advanceToColor(from, 'purple', viaRoad);
  const effective = dest ?? from;
  return effective.zone === 'castle' || atCastleEntrance(effective);
}

// A report move can't be enumerated to a single move_id (the cards are whatever
// the human physically drew), so the template must SHOW the per-card object shape
// — otherwise the model knows the colors but not that each card needs a `kind`
// field, and the report is silently rejected. (CLAUDE.md taxonomy #4: opaque
// fill-in template.) The skeleton seeds one example per card; the instruction
// spells out all three card shapes and says to EDIT it to the real cards.
function reportCardSkeleton(count: number): Array<{ kind: 'single'; color: SpaceColor }> {
  return Array.from({ length: Math.max(1, count) }, () => ({ kind: 'single' as const, color: 'red' as SpaceColor }));
}
function reportCardInstruction(count: number): string {
  return `Report the ${count} Intel card(s) you drew — EDIT cards[] to your actual ${count} card(s). Each card object is ONE of: {"kind":"single","color":<color>} · {"kind":"double","color":<color>} · {"kind":"treat","treat":<treat name>}. Colors: red, orange, yellow, green, blue, purple. Do NOT invent cards.`;
}

/** Every listed move carries an id a client can send back (the move menu's
 *  leaves point at ids). Ids are per listing, not stable across moves. */
export function getLegalMoves(state: SweetlandsState, playerId: string): LegalMove<SweetlandsMove>[] {
  return listLegalMoves(state, playerId).map((m, i) => (m.move_id ? m : { ...m, move_id: `sl-${i + 1}` }));
}

function listLegalMoves(state: SweetlandsState, playerId: string): LegalMove<SweetlandsMove>[] {
  if (state.phase === 'game_over') return [];

  // ---- a pending Intel report blocks all else ----
  if (state.pending?.kind === 'report_intel') {
    if (state.pending.forPlayerId !== playerId) return [];
    const p = byId(state, playerId);
    // Digital humans press the button — the server fills the cards.
    if (p?.digital === true) {
      const label = state.pending.reason === 'gain' ? 'Draw' : 'Draw (Blue collect)';
      return [mk({ type: 'resolve_report' }, `${label} ${state.pending.count} Intel card(s) (the server deals them when you press this).`)];
    }
    return [mk({ type: 'report_intel_draw', cards: reportCardSkeleton(state.pending.count) }, reportCardInstruction(state.pending.count))];
  }

  // ---- setup phases ----
  if (state.phase === 'setup_factions') {
    // The first human reporter assigns everyone; offer the default distinct map.
    const pool = availableFactionIds(state.players.length);
    const def: Record<string, string> = {};
    state.players.forEach((p, i) => { def[p.playerId] = pool[i % pool.length]!; });
    const note = state.players.length === 5 ? ' (one seat must be Nomads)' : ' (Nomads are 5-player only)';
    return [mk({ type: 'assign_setup_choices', selections: def as Record<string, never> }, `Assign each player a faction${note} — default distinct map shown; edit to each human's choice.`)];
  }
  if (state.phase === 'setup_foe') {
    return (['dragon', 'orc', 'fiend'] as FoeType[]).map((f) => mk({ type: 'choose_foe', foe: f }, `Choose the ${f} as this game's castle foe.`));
  }
  if (state.phase === 'setup_secrets') {
    const head = state.setup.awaitingSecretFrom[0];
    if (head !== playerId) return [];
    const deal = state.setup.secretDeal[playerId] ?? [];
    return deal.map((o) => mk({ type: 'choose_secret_objective', objective: o }, `Keep secret objective "${o}" (the other passes to your right).`));
  }
  if (state.phase === 'setup_intel') {
    const p = byId(state, playerId);
    if (!p || p.kind !== 'human' || p.hand.length > 0) return [];
    // Digital humans press the button — the server fills the cards.
    if (p.digital === true) {
      return [mk({ type: 'resolve_report' }, 'Draw your 3 starting Intel cards from the shared deck (the server deals them when you press this).')];
    }
    return [mk({ type: 'report_intel_draw', cards: reportCardSkeleton(3) }, reportCardInstruction(3))];
  }

  // ---- play phase ----
  const p = active(state);
  if (p.playerId !== playerId) return [];
  const moves: LegalMove<SweetlandsMove>[] = [];

  if (p.turn.step === 'recall') {
    moves.push(mk({ type: 'recall', units: [] }, 'Skip recall (gain Intel, then play).'));
    moves.push(mk({ type: 'recall', units: [...UNITS] }, 'Recall ALL your units to your start, then gain Intel.'));
    for (const u of UNITS) moves.push(mk({ type: 'recall', units: [u] }, `Recall your ${u} to start, then gain Intel.`));
    return moves;
  }

  if (p.turn.step === 'play') {
    // Collapse identical cards to one representative. Two copies of the same card
    // (e.g. two yellow singles) are fungible — the human can't say which physical
    // copy they played, so surfacing both as separate same-description options
    // only makes the model freeze ("which yellow card?") or pick arbitrarily, both
    // of which desync. One entry per distinct identity removes the ambiguity; the
    // engine plays whichever copy this representative names. (card_id is fungible
    // in the state compare too — see desyncBot canonicalObject.)
    // Digital seats own no dice: a battle move carries no battleTotal to fill
    // in; the server rolls their sugar cubes when they press it.
    const digital = p.digital === true;
    const foeNote = digital
      ? ' The server rolls your sugar cubes against the foe when you press this.'
      : ' You must physically roll your sugar cubes and replace battleTotal (0) with the actual total pips.';
    const seenCard = new Set<string>();
    const uniqueHand = p.hand.filter((c) => {
      const key = c.kind === 'treat' ? `treat-${c.treat}` : `${c.kind}-${c.color}`;
      if (seenCard.has(key)) return false;
      seenCard.add(key);
      return true;
    });
    for (const card of uniqueHand) {
      if (card.kind === 'single' || card.kind === 'double') {
        const label = card.kind === 'double' ? `double ${card.color} (acts twice)` : card.color;
        for (const u of UNITS) {
          const offboard = p.units[u].zone === 'offboard';
          const entries = offboard ? ([1, 2, 3, 4] as const) : ([undefined] as const);
          for (const entryRegion of entries) {
            const from = offboard ? { zone: 'start' as const, region: entryRegion! } : p.units[u];
            const junction = hasJunctionChoice(from, card.color);
            for (const viaRoad of junction ? [false, true] : [false]) {
              const branch = junction ? (viaRoad ? ' via road' : ' around ring') : '';
              const where = entryRegion ? ` entering region ${entryRegion}` : '';
              const needsFoeTotal = card.color === 'red' ? redWillBattleFoe(state, p, u) : card.color === 'purple' ? purpleWillBattleFoe(state, p, u, from, viaRoad) : false;
              const base = { type: 'play_intel' as const, cardId: card.cardId, unit: u, viaRoad, ...(entryRegion ? { entryRegion } : {}) };
              const landing = colorLanding(from, u, card.color, viaRoad, card.kind === 'double' ? 2 : 1);
              moves.push(mk({ ...base, takeAction: true, ...(needsFoeTotal && !digital ? { battleTotal: 0 } : {}) }, `Play ${label}: move ${u}${where}${branch} and take the ${card.color} action.${needsFoeTotal ? foeNote : ''}`, landing));
              moves.push(mk({ ...base, takeAction: false }, `Play ${label}: move ${u}${where}${branch} only (no action).`, landing));
              // Yellow's optional "raise taxes" is a player choice — surface it.
              if (card.color === 'yellow') {
                moves.push(mk({ ...base, takeAction: true, raiseTaxes: true }, `Play yellow: move ${u}${where}${branch}, collect taxes AND raise your region's tax +1 (costs 1 influence).`, landing));
              }
            }
          }
        }
        if (card.color === 'green') {
          moves.push(mk({ type: 'play_intel', cardId: card.cardId, unit: 'leader', takeAction: true }, 'Discard Green to play unlimited Intel this turn (no move).'));
        }
      } else {
        const anySlot = p.faction === 'cheesecake';
        for (const u of UNITS) {
          moves.push(mk({ type: 'play_intel', cardId: card.cardId, unit: u, takeAction: false }, `Use the ${card.treat} treat to move your ${u} to its special location.`, treatLanding(state, p.units[u], u, card.treat)));
        }
        if (anySlot) {
          moves.push(mk({ type: 'play_intel', cardId: card.cardId, unit: 'ambassador', takeAction: false, treatRegion: 1, treatSlot: 'regional' }, `Cheesecake: use ${card.treat} to move your ambassador to ANY treat (region 1 regional shown — edit region/slot).`));
        }
      }
    }
    // play an owned Intel token as a one-time card of its color (mirrors play_intel's
    // off-board entry + junction handling)
    for (const color of COLORS) {
      if (!p.intelTokens[color]) continue;
      for (const u of UNITS) {
        const offboard = p.units[u].zone === 'offboard';
        const entries = offboard ? ([1, 2, 3, 4] as const) : ([undefined] as const);
        for (const entryRegion of entries) {
          const from = offboard ? { zone: 'start' as const, region: entryRegion! } : p.units[u];
          const junction = hasJunctionChoice(from, color);
          for (const viaRoad of junction ? [false, true] : [false]) {
            const where = entryRegion ? ` entering region ${entryRegion}` : '';
            const needsFoeTotal = color === 'red' ? redWillBattleFoe(state, p, u) : color === 'purple' ? purpleWillBattleFoe(state, p, u, from, viaRoad) : false;
            const base = { type: 'play_token' as const, color, unit: u, viaRoad, ...(entryRegion ? { entryRegion } : {}) };
            const landing = colorLanding(from, u, color, viaRoad, 1);
            moves.push(mk({ ...base, takeAction: true, ...(needsFoeTotal && !digital ? { battleTotal: 0 } : {}) }, `Spend your ${color} Intel token: move ${u}${where} and take the ${color} action.${needsFoeTotal ? foeNote : ''}`, landing));
            moves.push(mk({ ...base, takeAction: false }, `Spend your ${color} Intel token: move ${u}${where} only.`, landing));
          }
        }
      }
    }
    // discard-for-color conversion (4, or 2 for Fudge)
    const need = p.faction === 'fudge' ? 2 : 4;
    if (p.hand.length >= need) {
      const ids = p.hand.slice(0, need).map((c) => c.cardId);
      for (const color of COLORS) moves.push(mk({ type: 'discard_for_color', cardIds: ids, color }, `Discard ${need} Intel to gain one ${color} Intel.`));
    }
    addSugarDiscards(p, moves);
    moves.push(mk({ type: 'pass' }, 'Pass your turn to gain 1 influence.'));
    return moves;
  }

  // influence step (Intel tokens: 4 of each color in the supply)
  for (const color of COLORS) {
    const supplyLeft = 4 - state.players.filter((x) => x.intelTokens[color]).length;
    if (!p.intelTokens[color] && supplyLeft > 0 && p.influence >= 1) moves.push(mk({ type: 'buy_intel_token', color }, `Buy a ${color} Intel token (1 influence).`));
  }
  const sugarHeld = state.players.reduce((n, x) => n + x.sugarCubes, 0);
  if (p.influence >= 3 && sugarHeld < 30) moves.push(mk({ type: 'buy_sugar_cube' }, 'Buy a sugar cube (3 influence).'));
  addSugarDiscards(p, moves);
  moves.push(mk({ type: 'end_turn' }, 'End your turn.'));
  return moves;
}

/** Voluntary sugar discards + influence trashing (the sinks for the "discard 5
 *  sugar cubes" / "spend 5 influence" secret objectives). */
function addSugarDiscards(p: PlayerState, moves: LegalMove<SweetlandsMove>[]): void {
  if (p.sugarCubes >= 1) moves.push(mk({ type: 'discard_sugar', count: 1 }, 'Discard 1 sugar cube.'));
  if (p.sugarCubes >= 5) moves.push(mk({ type: 'discard_sugar', count: 5 }, 'Discard 5 sugar cubes (completes that secret objective).'));
  if (p.influence >= 1) moves.push(mk({ type: 'trash_influence', count: 1 }, 'Trash 1 influence (toward the spend-5-influence objective).'));
  if (p.influence >= 5) moves.push(mk({ type: 'trash_influence', count: 5 }, 'Trash 5 influence (completes that secret objective).'));
}

function active(state: SweetlandsState): PlayerState {
  return state.players[state.currentPlayerIndex]!;
}
function byId(state: SweetlandsState, id: string): PlayerState | undefined {
  return state.players.find((p) => p.playerId === id);
}
