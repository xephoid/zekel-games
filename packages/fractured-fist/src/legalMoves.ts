import type { LegalMove } from '@zekel/game-kit';
import { FOCUS_RELOADS_PER_TURN, getCard, tryGetCard } from './cards.js';
import type { FFMove, FFState, PlayerState, TrackedPlayerState } from './types.js';

const RESOURCE_IDS = ['focus', 'momentum', 'mastery'] as const;

function isTracked(p: PlayerState): p is TrackedPlayerState {
  return p.kind === 'tracked';
}

export function getLegalMoves(state: FFState, playerId: string): LegalMove<FFMove>[] {
  if (state.phase === 'game_over') return [];
  if (state.activePlayerId !== playerId) return [];

  const me = state.players[playerId];
  if (!me) return [];

  const moves: LegalMove<FFMove>[] = [];

  // Refines block everything else.
  if (me.refinePending > 0) {
    if (isTracked(me)) {
      me.hand.forEach((cardId, idx) => {
        const def = tryGetCard(cardId);
        moves.push({
          move_id: `refine-${idx}-${cardId}`,
          description: `Refine ${def?.name ?? cardId} (hand[${idx}])`,
          move: { type: 'refine_card', hand_index: idx },
        });
      });
    } else {
      // Opaque: the server doesn't know what's in hand. Surface two intent
      // choices and let the human pick based on what they're physically holding.
      // Both need a card in hand; a Misstep also needs one to exist (the count
      // covers deck + hand + discard, so 0 means none can be in hand).
      if (me.handSize > 0 && me.misstepCount > 0) {
        moves.push({
          move_id: 'refine-misstep',
          description: 'Refine a Misstep from your hand, removing it from the game',
          move: { type: 'refine_card', was_misstep: true },
        });
      }
      if (me.handSize > 0) {
        moves.push({
          move_id: 'refine-other',
          description: 'Refine a card that is not a Misstep from your hand, removing it from the game',
          move: { type: 'refine_card', was_misstep: false },
        });
      }
    }
    moves.push({
      move_id: 'skip-refine',
      description: `Skip remaining ${me.refinePending} refine(s)`,
      move: { type: 'skip_refine' },
    });
    return moves;
  }

  if (state.phase === 'technique') {
    addPlayCardMoves(moves, state, me, 'TECHNIQUE');
    if (focusReloadAvailable(state, me)) {
      moves.push(...focusReloadMoves(me));
    }
    moves.push({
      move_id: 'advance-phase',
      description: 'Advance to Channel phase',
      move: { type: 'advance_phase' },
    });
    moves.push({
      move_id: 'end-turn',
      description: 'End turn (skip channel)',
      move: { type: 'end_turn' },
    });
    return moves;
  }

  // Channel phase.
  addPlayCardMoves(moves, state, me, 'RESOURCE');
  if (me.channels > 0) {
    // Buys come from THIS player's own supply (each player has their own 5
    // copies of each technique in Fractured Fist — supplies are not shared).
    for (const [id, count] of Object.entries(me.supply)) {
      if (count <= 0) continue;
      const def = getCard(id);
      if (me.spirit >= def.cost) {
        moves.push({
          move_id: `buy-${id}`,
          description: `Buy ${def.name} from your supply for ${def.cost} spirit (this is the "channel" action in Fractured Fist rules)`,
          move: { type: 'buy_card', card_id: id },
        });
      }
    }
  }
  if (focusReloadAvailable(state, me)) {
    moves.push(...focusReloadMoves(me));
  }
  moves.push({
    move_id: 'end-turn',
    description: 'End turn',
    move: { type: 'end_turn' },
  });
  return moves;
}

function addPlayCardMoves(
  moves: LegalMove<FFMove>[],
  state: FFState,
  me: PlayerState,
  cardType: 'TECHNIQUE' | 'RESOURCE',
): void {
  if (cardType === 'TECHNIQUE' && me.actions < 1) return;

  if (isTracked(me)) {
    me.hand.forEach((cardId, idx) => {
      const def = tryGetCard(cardId);
      if (!def || def.type !== cardType) return;
      moves.push({
        move_id: `play-${idx}-${cardId}`,
        description:
          cardType === 'RESOURCE'
            ? `Play ${def.name} for ${def.value ?? 0} spirit`
            : `Play ${def.name} (hand[${idx}])`,
        move: { type: 'play_card', card_id: cardId, hand_index: idx },
      });
    });
    return;
  }

  // Opaque: enumerate every card in this player's pool of the requested type.
  // The human picks based on what they're actually holding; the server only
  // checks the card exists in the pool (see engine.ts inGamePool). An empty
  // hand has nothing to play (the engine refuses it).
  if (me.handSize < 1) return;
  const candidates: string[] =
    cardType === 'TECHNIQUE'
      ? Object.keys(me.supply).filter((id) => getCard(id).type === 'TECHNIQUE')
      : [...RESOURCE_IDS];
  for (const cardId of candidates) {
    const def = tryGetCard(cardId);
    if (!def) continue;
    moves.push({
      move_id: `play-${cardId}`,
      description:
        cardType === 'RESOURCE'
          ? `Play ${def.name} from your hand for ${def.value ?? 0} spirit`
          : `Play ${def.name} from your hand`,
      move: { type: 'play_card', card_id: cardId },
    });
  }
}

function focusReloadAvailable(state: FFState, me: PlayerState): boolean {
  const oppId = state.playerOrder.find((p) => p !== state.activePlayerId);
  if (!oppId) return false;
  const opp = state.players[oppId];
  if (!opp) return false;
  if (me.stamina >= opp.stamina) return false;
  // Rule: at most FOCUS_RELOADS_PER_TURN reloads per turn.
  if ((me.focusReloadsThisTurn ?? 0) >= FOCUS_RELOADS_PER_TURN) return false;
  if (isTracked(me)) return me.hand.some((id) => id === 'focus');
  // Opaque: only require stamina condition + at least one card in hand.
  // The human knows whether they actually have a Focus to discard.
  return me.handSize > 0;
}

function focusReloadMoves(me: PlayerState): LegalMove<FFMove>[] {
  if (isTracked(me)) {
    return [
      {
        move_id: 'focus-reload',
        description: 'Focus reload: discard all Focus, redraw same count',
        move: { type: 'focus_reload' },
      },
    ];
  }
  // Opaque: the engine needs the number of Focus cards discarded, which only
  // the human knows — offer one option per possible count (1..hand size), so
  // the offered move is always one the engine accepts.
  const options: LegalMove<FFMove>[] = [];
  for (let n = 1; n <= me.handSize; n++) {
    options.push({
      move_id: `focus-reload-${n}`,
      description: `Focus reload: discard the ${n === 1 ? '1 Focus card' : `${n} Focus cards`} in your hand and draw ${n}`,
      move: { type: 'focus_reload', count: n },
    });
  }
  return options;
}
