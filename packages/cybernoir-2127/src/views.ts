import type { CNState } from './types.js';
import { getPerson, getLocation, LOCATIONS, WEAPON_ID } from './data/index.js';
import { detectiveRuledOutReason, ruledOutReason } from './ai.js';

export function getPublicView(state: CNState): unknown {
  return {
    phase: state.phase,
    turn: state.turn,
    activePlayerId: state.activePlayerId,
    playerOrder: state.playerOrder,
    pending: state.pending?.type ?? null,
    endgame_triggered: state.endgame_triggered,
    endgame_reason: state.endgame_reason,
    board: state.detective.board.map(id => getLocation(id)?.name ?? id),
    informants_facedown_count: state.detective.informants.filter(i => !i.revealed).length,
    informants_revealed: state.detective.informants.filter(i => i.revealed).map(i => ({
      person: getPerson(i.person_id)?.name ?? i.person_id,
    })),
    // v2.3: named slots matching the printed sheet — the assistant kept
    // assuming the track ended in permanent lock-up.
    jail: {
      slot_1_booked: (state.detective.jail[0] ?? []).map(j => getPerson(j)?.name ?? j),
      slot_2_processing: (state.detective.jail[1] ?? []).map(j => getPerson(j)?.name ?? j),
      slot_3_release_pending_then_freed: (state.detective.jail[2] ?? []).map(j => getPerson(j)?.name ?? j),
    },
    truthful_clues: state.hacker.truthful_clues,
    truthful_values: state.hacker.truthful_values,
    negative_clues: state.hacker.negative_clues,
    safehouse_burned: state.hacker.safehouse_burned ?? false,
    hideout_card_removed: state.hideout_card_removed ?? false,
    evidence: {
      weapon: state.hacker.evidence.weapon,
      witnesses: state.hacker.evidence.witnesses.map(id => getPerson(id)?.name ?? id),
      motive_set_1: state.hacker.evidence.motive_set_1.map(id => getPerson(id)?.name ?? id),
      motive_set_2: state.hacker.evidence.motive_set_2.map(id => getPerson(id)?.name ?? id),
      motive_set_3: (state.hacker.evidence.motive_set_3 ?? []).map(id => getPerson(id)?.name ?? id),
      motive_set_4: (state.hacker.evidence.motive_set_4 ?? []).map(id => getPerson(id)?.name ?? id),
    },
    contacts_discard: state.hacker.contacts_discard.map(id => id === WEAPON_ID ? 'The Weapon' : (getPerson(id)?.name ?? id)),
    detective: {
      location_deck_size: state.detective.location_deck.length,
      location_hand_size: state.detective.location_hand.length,
      // Discards happen face up, so the pile is public (opaque Detectives:
      // only the discards the server saw named).
      location_discard: (state.detective.location_discard ?? []).map(id => getLocation(id)?.name ?? id),
      poi_deck_size: state.detective.poi_deck.length,
      mid_game_guess_spent: state.detective.mid_game_guess_spent,
      location_played_this_turn: state.detective.location_played_this_turn,
      upkeep_paid: state.detective.upkeep_paid,
      ap: state.players[state.playerOrder[0]!]?.ap ?? 0,
      overclock_used: state.players[state.playerOrder[0]!]?.overclock_used ?? false,
    },
    hacker: {
      contacts_deck_size: state.hacker.contacts_deck.length,
      contacts_discard_size: state.hacker.contacts_discard.length,
      hand_size: state.players[state.playerOrder[1]!]?.hand_size ?? 0,
      ap: state.players[state.playerOrder[1]!]?.ap ?? 0,
      overclock_used: state.players[state.playerOrder[1]!]?.overclock_used ?? false,
    },
    overclock_draws_owed: state.overclock_draws_owed,
    overclock_draw_timing: state.overclock_draw_timing,
    /**
     * Which Locations cannot be the hideout, and why, from what is on the
     * table: a card the Detective played once the safehouse card has left the
     * deck, and anything a revealed clue or a NOT token contradicts. Both
     * seats may work this out from public facts; publishing it means a client
     * does not have to hold the rule to draw it.
     */
    locations_ruled_out: LOCATIONS
      .map(l => ({ location_name: l.name, reason: ruledOutReason(state, l) }))
      .filter((r): r is { location_name: string; reason: string } => r.reason !== undefined),
  };
}

export function getPlayerView(state: CNState, playerId: string): unknown {
  const pub = getPublicView(state) as Record<string, unknown>;
  const isDetective = state.playerOrder[0] === playerId;
  const isHacker = state.playerOrder[1] === playerId;

  if (isDetective) {
    return {
      ...pub,
      role: 'detective',
      location_hand: state.detective.kind === 'tracked'
        ? state.detective.location_hand.map(id => getLocation(id)?.name ?? id)
        : 'physical — you hold your own Location cards at the table; the server does not track which ones',
      informants: state.detective.informants.map(i => ({
        person: getPerson(i.person_id)?.name ?? i.person_id,
        revealed: i.revealed,
      })),
      /**
       * The Detective's own crossing-off: everything public, plus the cards
       * they have held or discarded, which only they can know are out. Never
       * in the public view and never in the Hacker's — it would hand over
       * what the Detective has seen.
       */
      your_locations_ruled_out: LOCATIONS
        .map(l => ({ location_name: l.name, reason: detectiveRuledOutReason(state, l) }))
        .filter((r): r is { location_name: string; reason: string } => r.reason !== undefined),
    };
  }

  if (isHacker) {
    const playerState = state.players[playerId];
    return {
      ...pub,
      role: 'hacker',
      // Opaque hands are PHYSICAL: serving an empty array here taught clients
      // "your hand is empty" and they vetoed legal plays (integration gate,
      // INTEGRATION-NOTES finding C). Say what is true instead.
      hand: state.hacker.kind === 'tracked' && playerState?.kind === 'tracked'
        ? playerState.hand.map(id => id === WEAPON_ID ? 'The Weapon' : (getPerson(id)?.name ?? id))
        : 'physical — you hold your own Contact cards at the table; the server tracks only hand_size, never the contents',
      // v2.5: the Hacker's own hideout by NAME, beside the three printed facts.
      // They chose the place, so they are entitled to see which one it is, and
      // the facts alone do not identify it — Trailer Towers and Little Ghana
      // share all three on purpose. Additive: the facts stay where they were.
      // Sessions from before the location id was stored (v1.6) carry a null
      // name rather than a guess between the twins. The Detective's view is
      // untouched and still carries no hideout at all.
      hideout: state.hacker.hideout && {
        location_name: state.hacker.hideout_location_id
          ? getLocation(state.hacker.hideout_location_id)?.name ?? null
          : null,
        ...state.hacker.hideout,
      },
      evidence_detail: state.hacker.evidence,
    };
  }

  return pub;
}