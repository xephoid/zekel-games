// Fractured Fist — the choice catalog (see core/choiceCatalog.ts).
//
// Rows written by the post-port walk of a human seat (POST-PORT.md §6,
// 2026-09-23): every decision the rules give a player, turn by turn, checked
// against what getLegalMoves offers a physical (opaque) human and a
// server-tracked one. Drawing, discarding at cleanup, where Missteps land and
// healing are not decisions — the rules settle them.

import type { PlayerChoice } from '@zekel/game-kit';

export const FRACTURED_FIST_CHOICES: PlayerChoice[] = [
  {
    id: 'loadout',
    description: 'Which techniques make up the loadout (each player gets their own supply of the same cards)',
    owner: 'player',
    when: 'setup',
    resolvedBy: ['options.loadout'],
    balanceAxis: 'loadout',
  },
  {
    id: 'play-card',
    description: 'Which card to play from your hand',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['play_card'],
  },
  {
    id: 'buy-card',
    description: 'Which card to buy, if any',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['buy_card'],
  },
  {
    id: 'refine',
    description: 'Whether to refine a card, and which one',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['refine_card', 'skip_refine'],
    dependsOn: 'reaching a refine window with a card that can be refined',
  },
  {
    id: 'focus-reload',
    description: 'Whether to spend Focus to reload',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['focus_reload'],
    dependsOn: "having lower stamina than your opponent, which random play reaches only once damage has landed",
  },
  {
    id: 'first-player',
    description: 'Who takes the first turn',
    owner: 'auto',
    when: 'setup',
    resolvedBy: [],
    why:
      'The rules text names no first-player rule. The first seat listed at create_session goes first, and the ' +
      'players choose that order when they set up the session; it never changes during the game.',
  },
  {
    id: 'end-turn',
    description: 'When to stop and end your turn',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['end_turn', 'advance_phase'],
  },
];
