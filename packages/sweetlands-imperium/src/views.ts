// Sweetlands Imperium — public & per-player views.
//
// Hidden info (CLAUDE.md physical-first): a player's Intel HAND and SECRET
// objectives are private. The public view shows hand COUNTS only; a player view
// adds that player's own hand + secret objectives. The Intel deck order is never
// exposed.

import { FACTIONS } from './data/factions.js';
import { REGION_TREAT } from './data/board.js';
import type { SweetlandsState, PlayerState, UnitLocation } from './types.js';

// Prose label for a unit location. Each region's 12-space ring runs ROYGBP
// TWICE, so colour alone matches two spaces — the space index must always ride
// along (audit 2026-08-05: "region 2 ring (yellow)" was unrebuildable).
function describeLocation(loc: UnitLocation, state: SweetlandsState): string {
  switch (loc.zone) {
    case 'offboard': return 'off-board';
    case 'start': return `region ${loc.region} start`;
    case 'ring': return `region ${loc.region} ring space ${loc.ringIndex} (${ringColor(loc.ringIndex)})`;
    case 'road': return `region ${loc.region} road space ${loc.roadIndex} (${ringColor(loc.roadIndex)})`;
    case 'castle': return 'castle';
    case 'treat': {
      const treat = loc.slotKind === 'regional' ? REGION_TREAT[loc.region] : state.randomTreatPlacement[loc.region];
      return `region ${loc.region} ${loc.slotKind} treat (${treat ?? '?'})`;
    }
  }
}

function ringColor(i: number): string {
  return ['red', 'orange', 'yellow', 'green', 'blue', 'purple'][i % 6]!;
}

function publicPlayer(p: PlayerState, state: SweetlandsState): unknown {
  return {
    player_id: p.playerId,
    kind: p.kind,
    faction: p.faction,
    faction_name: FACTIONS[p.faction].name,
    home_region: p.homeRegion,
    points: p.points,
    influence: p.influence,
    sugar_cubes: p.sugarCubes,
    intel_tokens: Object.keys(p.intelTokens),
    hand_count: p.hand.length,
    units: {
      leader: describeLocation(p.units.leader, state),
      knight: describeLocation(p.units.knight, state),
      ambassador: describeLocation(p.units.ambassador, state),
    },
    // Structured twin of the prose above (view-completeness): the raw
    // UnitLocation discriminated union, exactly as moves/engine use it.
    unit_locations: {
      leader: p.units.leader,
      knight: p.units.knight,
      ambassador: p.units.ambassador,
    },
    public_objectives_scored: p.publicObjectivesScored,
    secret_objectives_count: p.secretObjectives.length,
    // Scored secret objectives are revealed only at game end (no mid-game leak) —
    // for the balance harness's per-objective achievement breakdown.
    ...(state.phase === 'game_over' ? { secret_objectives_scored: p.secretObjectivesScored ?? [] } : {}),
  };
}

function sharedView(state: SweetlandsState): Record<string, unknown> {
  return {
    game_id: 'sweetlands-imperium',
    phase: state.phase,
    round: state.round,
    active_player_id: state.activePlayerId,
    first_player_id: state.players[state.firstPlayerIndex]?.playerId,
    taxes: state.taxes,
    foe: state.foe,
    castle_occupant_id: state.castleOccupantId,
    intel_deck_count: state.intelDeck.length,
    intel_discard_count: state.intelDiscard.length,
    random_treat_placement: state.randomTreatPlacement,
    // The most recent battle's dice, rolled in the open; null before the first.
    last_battle: state.lastBattle ? {
      id: state.lastBattle.id,
      round: state.lastBattle.round,
      kind: state.lastBattle.kind,
      attacker: { player_id: state.lastBattle.attacker.playerId, faces: state.lastBattle.attacker.faces, total: state.lastBattle.attacker.total },
      defender: { player_id: state.lastBattle.defender.playerId, foe: state.lastBattle.defender.foe, faces: state.lastBattle.defender.faces, total: state.lastBattle.defender.total },
      winner: state.lastBattle.winner,
      ...(state.lastBattle.automatic ? { automatic: true } : {}),
    } : null,
    players: state.players.map((p) => publicPlayer(p, state)),
  };
}

export function getPublicView(state: SweetlandsState): unknown {
  return sharedView(state);
}

export function getPlayerView(state: SweetlandsState, playerId: string): unknown {
  const view = sharedView(state);
  const me = state.players.find((p) => p.playerId === playerId);
  if (me) {
    view['your_hand'] = me.hand.map(describeCard);
    view['your_secret_objectives'] = me.secretObjectives;
    view['your_turn_step'] = me.kind && state.phase === 'play' && state.activePlayerId === playerId ? me.turn.step : null;
  }
  return view;
}

function describeCard(c: PlayerState['hand'][number]): Record<string, unknown> {
  if (c.kind === 'single') return { card_id: c.cardId, kind: 'single', color: c.color };
  if (c.kind === 'double') return { card_id: c.cardId, kind: 'double', color: c.color };
  return { card_id: c.cardId, kind: 'treat', treat: c.treat };
}
