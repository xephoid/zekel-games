// Sweetlands Imperium — the choice catalog (see core/choiceCatalog.ts).
// Transcribed from POST-PORT.md §6.
//
// Most of a turn rides on ONE `play_intel` move that carries several separate
// decisions in its fields, so those rows name the field that tells them apart
// (`distinguishedBy`). Without that the check would only confirm `play_intel`
// was offered and would miss, say, the raise-taxes option quietly disappearing.

import type { PlayerChoice } from '@zekel/game-kit';

export const SWEETLANDS_CHOICES: PlayerChoice[] = [
  // ---- Setup ----
  {
    id: 'faction',
    description: 'Which faction you play',
    owner: 'player',
    when: 'setup',
    resolvedBy: ['assign_setup_choices'],
    balanceAxis: 'faction',
  },
  {
    id: 'castle-foe',
    description: 'Which foe holds the castle',
    owner: 'player',
    when: 'setup',
    resolvedBy: ['choose_foe'],
    balanceAxis: 'foe',
  },
  {
    id: 'secret-objective',
    description: 'Which secret objective you keep',
    owner: 'player',
    when: 'setup',
    resolvedBy: ['choose_secret_objective'],
  },
  {
    id: 'starting-intel',
    description: 'Report the Intel cards you physically drew to start (physical) / press Draw (digital — randomness reveal, not a decision)',
    owner: 'player',
    when: 'setup',
    // resolve_report is the digital-seat button for the SAME pending — it asks
    // the server to reveal what was drawn, not to choose. The player's choice
    // is over the cards they hold afterward, never the draw.
    resolvedBy: ['report_intel_draw', 'resolve_report'],
  },

  // ---- In play ----
  {
    id: 'mid-game-intel',
    description: 'Report the Intel you drew mid-game, from a gain or a Blue action (physical) / press Draw (digital)',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['report_intel_draw', 'resolve_report'],
  },
  {
    id: 'recall',
    description: 'Which units to recall at the start of your turn, if any',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['recall'],
  },
  {
    id: 'intel-card',
    description: 'Which Intel card to play this turn',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['play_intel'],
    distinguishedBy: 'cardId',
  },
  {
    id: 'which-unit-moves',
    description: 'Which of your units the played card moves',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['play_intel'],
    distinguishedBy: 'unit',
  },
  {
    id: 'take-colour-action',
    description: "Whether to take the card colour's action after moving",
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['play_intel'],
    distinguishedBy: 'takeAction',
  },
  {
    id: 'junction-route',
    description: 'At a junction: stay on the ring, or branch onto the road',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['play_intel'],
    distinguishedBy: 'viaRoad',
  },
  {
    id: 'raise-taxes',
    description: 'Yellow: whether to raise your region’s tax after collecting',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['play_intel'],
    distinguishedBy: 'raiseTaxes',
  },
  {
    id: 'treat-destination',
    description: 'Where a treat goes — which region and which slot',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['play_intel'],
    distinguishedBy: 'treatRegion',
    dependsOn: 'holding a treat card and reaching a region with a free treat slot',
  },
  {
    id: 'capture-target',
    description: 'Red: whose unit you capture or battle',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['play_intel'],
    distinguishedBy: 'targetPlayerId',
    dependsOn:
      "playing Red with your knight's region holding another player's Leader or Ambassador. " +
      'getLegalMoves offers one option per target, worked out from where the knight ends up.',
  },
  {
    id: 'capture-leader-scores',
    description: 'Red: which "capture a leader" objective a leader capture scores (public 1 or secret 2)',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['play_intel', 'play_token', 'choose_capture'],
    distinguishedBy: 'captureLeaderScores',
    dependsOn: 'capturing a leader while holding the secret "capture a leader" and the public one is still open',
  },
  {
    id: 'second-capture',
    description: 'Double red card: who the second Red captures',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['choose_capture'],
    dependsOn: 'a double red card whose second capture has more than one answer once the knight has moved again',
  },
  {
    id: 'nomads-entry',
    description: 'Nomads: which region an off-board unit enters at',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['play_intel'],
    distinguishedBy: 'entryRegion',
    dependsOn: 'playing the Nomads, with a unit still off the board',
  },
  {
    id: 'discard-for-colour',
    description: 'Which colour you discard for',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['discard_for_color'],
  },
  {
    id: 'buy',
    description: 'What to buy in the Influence phase — Intel tokens or sugar cubes',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['buy_intel_token', 'buy_sugar_cube'],
  },
  {
    id: 'spend-token',
    description: 'Whether to spend an Intel token, and on what',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['play_token'],
  },
  {
    id: 'discard-or-trash',
    description: 'Discarding sugar or trashing influence',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['discard_sugar', 'trash_influence'],
  },
  {
    id: 'end-turn',
    description: 'When to end your turn',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['end_turn', 'pass'],
  },

  // ---- Settled by the engine ----
  {
    id: 'trade',
    description: 'Trading with another player',
    owner: 'auto',
    when: 'in-game',
    resolvedBy: [],
    why:
      'Trade is open-ended and happens at the physical table between people; the move exists so ' +
      'a trade can be recorded, but the AI never starts one, so an all-AI game never reaches it. ' +
      'Recorded in POST-PORT.md §6 as physical-first.',
  },
];
