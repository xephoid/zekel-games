// Adventurer Olympics — legal move enumeration (the build's getLegalMoves).
//
// Every move shape accepts PRINTED names / stable labels; the engine resolves
// them (CLAUDE.md "Don't make the model guess"). The legal set is what the
// MCP layer surfaces as a numbered move_menu.

import type { LegalMove } from '@zekel/game-kit';
import type { AOState } from './types.js';
import {
  neighbors,
  slotHexes,
  tileCenter,
  sideLabelOf,
  isUnitHexKey,
  rotationLabel,
} from './hexMap.js';
import {
  ARTIFACT_NAMES,
  QUESTS,
  DUNGEON_KIND_NAMES,
  SUIT_ARTIFACTS,
} from './data.js';
import {
  anyArtifactOptions,
  topCandidates,
  setupReportOwed,
  availableColours,
  nextFreeStandee,
  drawableFaces,
  isServerServed,
  allEmptySlots,
  explorableSlots,
  nameOf,
  hexLabel,
} from './engine.js';

type Move = Record<string, unknown> & { type: string };

export function getLegalMoves(state: AOState, playerId: string): LegalMove<Move>[] {
  const moves: LegalMove<Move>[] = [];
  const seat = state.pending?.seat;
  const kind = state.pending?.kind;
  if (seat !== playerId || !kind) return moves;
  const payload = state.pending!.payload ?? {};

  switch (kind) {
    case 'setup_standee_colour': {
      // One entry per colour still free; the standee defaults to the next
      // unused "Standee N" (the figures have no printed names — a player may
      // name theirs instead).
      const standee = nextFreeStandee(state);
      for (const colour of availableColours(state)) {
        moves.push({
          move_id: `setup_${colour.toLowerCase()}`,
          description: `Take the ${colour} tokens and a standee (${standee}, or name your figure).`,
          move: { type: 'setup_standee', standee, colour },
        });
      }
      break;
    }

    case 'setup_explore_report': {
      // One offer per piece still owed: each quest card not yet reported, and
      // each tile the starting tile could be. Every offer is applicable as-is.
      const owed = setupReportOwed(state);
      if (owed.questsLeft > 0) {
        for (const q of QUESTS) {
          if (owed.reportedQuests.includes(q.kind)) continue;
          moves.push({
            move_id: `setup_quest_${q.kind}`,
            description: `Report a quest card you drew: "${q.name}".`,
            move: { type: 'setup_report', quests: [q.name] },
          });
        }
      }
      if (owed.tileOwed) {
        for (const id of [...state.tileStack].sort((a, b) => a - b)) {
          moves.push({
            move_id: `setup_tile_${id}`,
            description: `Report the starting tile you flipped: Tile ${id}.`,
            move: { type: 'setup_report', tile: `Tile ${id}` },
          });
        }
      }
      break;
    }

    case 'roll': {
      const rollKind = payload.rollKind as string;
      // A digital seat has no dice of its own: its one move is the Roll
      // button, and the server rolls when it is pressed (R7). Offering it the
      // totals too would let the player pick the number they wanted.
      if (isDigitalButton(state, playerId)) {
        const diceCount = rollKind === 'turn_order' ? 2 : (payload.diceCount as number);
        moves.push({
          move_id: 'resolve_roll',
          description: rollKind === 'turn_order'
            ? 'Roll 2 dice for turn order (the server rolls when you press this).'
            : `Roll ${diceCount} ${diceCount === 1 ? 'die' : 'dice'} (the server rolls when you press this; you need ${payload.number}).`,
          move: { type: 'resolve_report' },
        });
        break;
      }
      if (rollKind === 'turn_order') {
        // 2d6 — report the actual total; the engine validates 2..12.
        for (let total = 2; total <= 12; total++) {
          moves.push({
            move_id: `roll_${total}`,
            description: `Report your 2-dice turn-order total: ${total}.`,
            move: { type: 'report_turn_order_roll', total },
          });
        }
      } else {
        const diceCount = payload.diceCount as number;
        const min = diceCount, max = diceCount * 6;
        for (let t = min; t <= max; t++) {
          moves.push({
            move_id: `test_${t}`,
            description: `Report your test roll total: ${t} (needs ${payload.number}).`,
            move: { type: 'report_test_roll', total: t },
          });
        }
      }
      break;
    }

    case 'draw': {
      // A digital human's draw from a server-owned deck: the one move is the
      // Draw button. The card stays face down until it is pressed.
      const deck = payload.deck as string;
      const what = deck === 'tile' ? 'Turn over the top map tile'
        : deck === 'dungeon' ? 'Draw the top Dungeon card'
        : deck === 'companion' ? 'Draw the top Companion card'
        : deck === 'little' ? 'Draw the top Little Monster card'
        : 'Draw the top Big Monster card';
      moves.push({
        move_id: 'resolve_draw',
        description: `${what} (the server deals it when you press this).`,
        move: { type: 'resolve_report' },
      });
      break;
    }

    case 'report_card': {
      const deck = payload.deck as 'companion' | 'little' | 'big' | 'dungeon' | 'tile';
      // A draw made for another seat (an AI) is reported by this human.
      const forSeat = payload.forSeat as string | undefined;
      const drawn = forSeat && forSeat !== playerId ? `drawn for ${nameOf(state, forSeat)}` : 'you drew';
      // Enumerate reportable identities (the engine resolves printed names).
      if (deck === 'tile') {
        // The physical seat reports the tile they drew — offer the tiles still
        // in the stack so the model never invents one.
        for (const id of state.tileStack) {
          moves.push({
            move_id: `report_tile_${id}`,
            description: `Report the tile ${drawn}: Tile ${id}.`,
            move: { type: 'report_card', card: `Tile ${id}` },
          });
        }
      } else if (deck === 'companion' || deck === 'little' || deck === 'big') {
        // One entry per distinct printed face still drawable — copies with the
        // same face are interchangeable, and each entry carries the full
        // printed face so the engine resolves it in this state.
        for (const { face, cardId } of drawableFaces(state, deck)) {
          moves.push({
            move_id: `report_${cardId}`,
            description: `Report the card ${drawn}: ${face}.`,
            move: { type: 'report_card', card: face },
          });
        }
      } else {
        // Only the Dungeon cards that can be on top right now (the cards put
        // under the deck sit there in a known order).
        const possible = new Set(topCandidates(state, 'dungeon'));
        for (const [k, printed] of Object.entries(DUNGEON_KIND_NAMES)) {
          if (!possible.has(k)) continue;
          moves.push({
            move_id: `report_${k}`,
            description: `Report the Dungeon card ${drawn}: ${printed}.`,
            move: { type: 'report_card', card: printed },
          });
        }
      }
      break;
    }

    case 'move': {
      const me = state.players[playerId] as { stepsLeft: number; hexKey: string };
      moves.push({ move_id: 'stop', description: 'Stop moving and end your turn.', move: { type: 'stop' } });
      const cur = me.hexKey;
      for (const n of stepTargets(state, playerId, cur)) {
        const icon = state.iconHexes.find((h) => h.key === n);
        if (icon && !icon.completed) {
          moves.push({
            move_id: `step_${n}`,
            description: `Step onto the ${iconLabel(icon.kind)} on ${hexLabel(state, n)} — it triggers and ends your turn.`,
            move: { type: 'step', to: n },
            cost: '1 step',
          });
        } else {
          moves.push({ move_id: `step_${n}`, description: `Step to ${hexLabel(state, n)}.`, move: { type: 'step', to: n }, cost: '1 step' });
        }
      }
      // Explore offers must NOT name the hidden top tile — at a digital/all-AI
      // table that identity is real and secret until the player commits (R2);
      // at a physical table the server doesn't know it at all (R1).
      if (me.stepsLeft >= 1 && state.tileStack.length > 0 && explorableSlots(state, playerId).length > 0) {
        moves.push({
          move_id: 'explore',
          description: 'Explore — draw the top tile, then choose the slot and rotation.',
          move: { type: 'explore' },
        });
      }
      break;
    }

    case 'try_again': {
      moves.push({ move_id: 'stay', description: 'Stay on this icon and try again (fresh card).', move: { type: 'try_again' } });
      // Moving is optional (RULES.md §5.1–5.2: you MAY try again or walk away),
      // so doing nothing this turn is a legal choice too.
      moves.push({ move_id: 'stop', description: 'Do nothing this turn — stay here without trying the icon; your turn ends.', move: { type: 'stop' } });
      const me = state.players[playerId] as { hexKey: string; stepsLeft: number };
      for (const n of stepTargets(state, playerId, me.hexKey)) {
        const icon = state.iconHexes.find((h) => h.key === n);
        moves.push({
          move_id: `away_${n}`,
          description: icon && !icon.completed
            ? `Walk away onto the ${iconLabel(icon.kind)} on ${hexLabel(state, n)} — it triggers and ends your turn.`
            : `Walk away to ${hexLabel(state, n)} — you keep the rest of your movement.`,
          move: { type: 'move_away', path: [n] },
        });
      }
      if (me.stepsLeft >= 1 && state.tileStack.length > 0 && explorableSlots(state, playerId).length > 0) {
        moves.push({
          move_id: 'tryagain_explore',
          description: 'Explore instead — draw the top tile, then choose the slot and rotation.',
          move: { type: 'explore' },
        });
      }
      break;
    }

    case 'explore_place': {
      // The tile's identity is now REAL (server-revealed for digital/AI,
      // reported by the player for physical) — placement choices may name it.
      const context = payload.context as 'ordinary' | 'forced' | 'dungeon_map';
      const tileId = payload.tileId as number;
      const slots = context === 'ordinary' ? explorableSlots(state, playerId) : allEmptySlots(state);
      for (const slot of slots) {
        for (let rot = 0; rot < 6; rot++) {
          moves.push({
            move_id: `place_${slot}_${rot}`,
            description: `${context === 'ordinary' ? 'Explore' : context === 'forced' ? 'Forced explore' : 'Dungeon Map'}: place Tile ${tileId} against ${slotLabelFor(state, slot)}, ${rotationLabel(rot)}.`,
            move: { type: 'explore', slot, rotation: rot },
          });
        }
      }
      break;
    }

    case 'take_artifact': {
      // Only REAL sources: supply artifacts no one holds, plus artifacts other
      // players hold — never your own, never the Star (RULES.md §6.3/§6.5).
      for (const o of anyArtifactOptions(state, playerId)) {
        const name = ARTIFACT_NAMES[o.artifact];
        moves.push({
          move_id: `take_${o.artifact}_${o.from === 'supply' ? 'supply' : o.from}`,
          description: o.from === 'supply'
            ? `Take the ${name} artifact from the supply.`
            : `Take the ${name} artifact from ${nameOf(state, o.from)}.`,
          move: { type: 'take_artifact', artifact: o.artifact, from: o.from },
        });
      }
      moves.push({ move_id: 'decline_artifact', description: 'Decline — the card gives nothing; draw another Dungeon card.', move: { type: 'decline_artifact' } });
      break;
    }

    default:
      break;
  }
  return moves;
}

/** A digital HUMAN seat gets the no-payload reveal button (Roll). AI seats
 *  resolve their own rolls; a physical seat reports theirs. */
function isDigitalButton(state: AOState, playerId: string): boolean {
  const p = state.players[playerId];
  return p?.kind === 'human' && p.table === 'digital';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function stepTargets(state: AOState, playerId: string, from: string): string[] {
  const out: string[] = [];
  for (const n of neighbors(from)) {
    if (state.hexes[n] !== true) continue;
    if (!isUnitHexKey(n)) continue;
    const occupant = state.playerOrder.find((p) => p !== playerId && (state.players[p] as { hexKey: string }).hexKey === n);
    if (occupant) continue;
    out.push(n);
  }
  return out;
}

function iconLabel(kind: string): string {
  if (kind === 'city') return 'City';
  if (kind === 'dungeon') return 'Dungeon';
  if (kind === 'little_monster') return 'Little Monster';
  if (kind === 'big_monster') return 'Big Monster';
  if (kind === 'star') return 'Star';
  if (kind === 'hearts') return 'Hearts';
  if (kind === 'spades') return 'Spades';
  if (kind === 'diamonds') return 'Diamonds';
  if (kind === 'clubs') return 'Clubs';
  return kind;
}

/** The printed side label for a slot — the side of the tile it was offered
 *  against, named for the hexes as that tile STANDS (rotation-aware). */
function slotLabelFor(state: AOState, centerKey: string): string {
  for (const t of state.placedTiles) {
    for (let s = 0; s < 6; s++) {
      if (tileCenter(t.center.key, s) === centerKey) {
        return `${sideLabelOf(t.center.key, t.rotation, s)} of Tile ${t.tileId}`;
      }
    }
  }
  return centerKey;
}

export { SUIT_ARTIFACTS, slotHexes };
