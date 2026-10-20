// Adventurer Olympics — public + per-seat views.
//
// Public: the map, every held card (face up), the artifact supply, initiative
// order, in-play quests, per-seat steps. There are NO hidden hands in this
// game — every card drawn is resolved face up and kept face up — so the public
// view is the whole table state. The per-seat difference is only the seat's
// own pending; the shared decks' counts are public knowledge.

import type { AOState } from './types.js';
import { hexLabelOf, rotationLabel, tileHexes, tileCenter, slotHexes, sideLabelOf, localHexAbsolute } from './hexMap.js';
import { TOKENS_PER_COLOUR, TILES, COMPANION_CARDS, LITTLE_MONSTER_CARDS, BIG_MONSTER_CARDS, QUESTS, ARTIFACT_NAMES } from './data.js';
import type { HexName } from './data.js';
import { explorableSlots, allEmptySlots, effectiveStat, questProgress } from './engine.js';

/** While a revealed tile waits to be placed: every slot the player may use,
 *  the hexes the tile would cover there, and for each of its six turns where
 *  its icons would land. The same slots and turns as get_legal_moves, laid out
 *  so a screen can draw each option without knowing how tiles fit together. */
function placementOptions(state: AOState): unknown {
  const p = state.pending;
  if (p?.kind !== 'explore_place') return null;
  const tileId = p.payload!.tileId as number;
  const context = p.payload!.context as 'ordinary' | 'forced' | 'dungeon_map';
  const tile = TILES.find((t) => t.id === tileId)!;
  const slots = context === 'ordinary' ? explorableSlots(state, p.seat) : allEmptySlots(state);
  return {
    tileId,
    context,
    slots: slots.map((slot) => {
      // The existing tiles this slot sits against, and the hexes it nestles to.
      const against: { tileId: number; side: string; hexes: [string, string] }[] = [];
      for (const t of state.placedTiles) {
        for (let s = 0; s < 6; s++) {
          if (tileCenter(t.center.key, s) === slot) {
            against.push({ tileId: t.tileId, side: sideLabelOf(t.center.key, t.rotation, s), hexes: slotHexes(t.center.key, s) });
          }
        }
      }
      return {
        slot,
        label: against[0] ? `${against[0].side} of Tile ${against[0].tileId}` : slot,
        against,
        hexes: tileHexes(slot),
        rotations: [0, 1, 2, 3, 4, 5].map((rotation) => ({
          rotation,
          label: rotationLabel(rotation),
          icons: (Object.entries(tile.icons) as [HexName, string][]).map(([localHex, kind]) => ({
            hex: localHexAbsolute(slot, rotation, localHex),
            localHex,
            kind,
          })),
          move: { type: 'explore', slot, rotation },
        })),
      };
    }),
  };
}

export function getPublicView(state: AOState): unknown {
  return {
    phase: state.pending?.kind ?? (state.gameOver ? 'game_over' : state.endingPhase > 0 ? 'ending' : 'idle'),
    round: state.round,
    activeSeat: state.activeSeat,
    endingPhase: state.endingPhase,
    gameOver: state.gameOver,
    map: {
      tiles: state.placedTiles.map((t) => ({
        tileId: t.tileId,
        center: t.center.key,
        rotation: t.rotation,
        isStarting: t.isStarting,
        exploredBy: t.exploredBy,
        // How the tile is turned, in table words (the starting tile is unturned).
        turned: rotationLabel(t.rotation),
        // The seven hexes the tile covers, centre first.
        hexes: tileHexes(t.center.key),
      })),
      icons: state.iconHexes.map((h) => ({
        key: h.key,
        tileId: h.tileId,
        localHex: h.localHex,
        kind: h.kind,
        completed: h.completed,
        completedBy: h.completedBy,
        hexLabel: hexLabelOf(state.placedTiles, h.key),
      })),
      hexes: Object.keys(state.hexes),
    },
    players: state.playerOrder.map((pid) => {
      const p = state.players[pid] as import('./types.js').PlayerState;
      return {
        player_id: pid,
        name: p.name,
        standee: p.standee,
        colour: p.colour,
        hex: p.hexKey,
        // The same hex in table words (the tile it is on + the printed hex name).
        hexLabel: p.hexKey ? hexLabelOf(state.placedTiles, p.hexKey) : null,
        stepsLeft: p.stepsLeft,
        // The stats in play now: the starting values plus every recruited
        // companion's bonus (RULES.md §7), so a screen never adds them up.
        stats: {
          charisma: effectiveStat(state, pid, 'charisma'),
          strength: effectiveStat(state, pid, 'strength'),
          movement: effectiveStat(state, pid, 'movement'),
        },
        initiative: p.initiative,
        companions: p.companions,
        littleMonsters: p.littleMonsters,
        bigMonsters: p.bigMonsters,
        artifacts: p.artifacts,
        questPoints: p.questPoints,
        claimedQuests: p.claimedQuests,
        exploredTiles: p.exploredTileIds,
        dungeonsCompleted: p.dungeonsCompleted,
        tokensSpent: p.tokensSpent,
        // Tokens of this colour not yet on the map (10 in the box, RULES.md §1).
        tokensLeft: TOKENS_PER_COLOUR - p.tokensSpent,
      };
    }),
    // Shared deck counts are public knowledge on the table; the ORDER is
    // server-owned only when every seat is digital.
    decks: {
      companion: state.decks.companion.length,
      little: state.decks.little.length,
      big: state.decks.big.length,
      dungeon: state.decks.dungeon.length,
      tileStack: state.tileStack.length,
    },
    // The artifact supply: every artifact no player holds (face up beside the decks).
    artifactSupply: (Object.keys(ARTIFACT_NAMES) as Array<keyof typeof ARTIFACT_NAMES>)
      .filter((a) => !state.playerOrder.some((pid) => (state.players[pid]!.artifacts as string[]).includes(a))),
    inPlayQuests: state.inPlayQuests,
    // Each quest in play with what it takes and how far every seat has got:
    // the instant quests' target, and the count each quest is judged by.
    quests: Object.entries(state.inPlayQuests).map(([kind, who]) => {
      const q = QUESTS.find((x) => x.kind === kind);
      return {
        kind,
        name: q?.name ?? kind,
        endGame: q?.endGame ?? false,
        target: q?.target ?? null,
        claimedBy: who === 'unclaimed' ? null : who,
        progress: Object.fromEntries(state.playerOrder.map((pid) => [pid, questProgress(state, pid, kind)])),
      };
    }),
    questBoxRemaining: state.questBoxRemaining,
    turnOrder: state.turnOrder,
    // This round's turn-order rolls, said aloud at the table: the first rolls,
    // the re-rolls of the group still tied, and who still has to roll.
    // The most recent roll with each die (null dice when only a total was
    // reported), so a screen shows the dice without reading the summary.
    lastRoll: state.lastRoll ?? null,
    turnOrderRolls: {
      totals: state.baseTotals,
      tiedGroup: state.tieBand,
      reRolls: state.groupTotals,
      stillToRoll: state.drawStack,
    },
    // True when anyone plays with the real cards (players report every draw).
    tableUsesRealCards: !state.serverOwnsDecks,
    // Cards everyone saw go under each deck, top of that run first (tables with
    // real cards only; empty otherwise). The rest of each deck is face down.
    cardsUnderDecks: state.knownBottom ?? { companion: [], little: [], big: [], dungeon: [] },
    pending: state.pending,
    // Set only while a revealed tile waits to be placed (see placementOptions).
    placementOptions: placementOptions(state),
    dungeonResolving: state.dungeonResolving,
    referenceData: {
      tiles: TILES,
      companions: COMPANION_CARDS,
      littleMonsters: LITTLE_MONSTER_CARDS,
      bigMonsters: BIG_MONSTER_CARDS,
      quests: QUESTS,
      artifacts: Object.entries(ARTIFACT_NAMES),
      tokensPerColour: TOKENS_PER_COLOUR,
    },
  };
}

export function getPlayerView(state: AOState, playerId: string): unknown {
  const pub = getPublicView(state) as Record<string, unknown>;
  return {
    ...pub,
    myPending: state.pending?.seat === playerId ? state.pending : null,
  };
}
