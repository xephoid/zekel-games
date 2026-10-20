// Adventurer Olympics — choice catalog (every decision the printed rules give
// a player, src/core/choiceCatalog.ts shape). Seeded from PORT-PLAN.md §5; the
// post-port gate formalizes ownership, ai-development annotates policy, balance
// annotates axis.

import type { PlayerChoice } from '@zekel/game-kit';

export const AOChoices: PlayerChoice[] = [
  {
    id: 'ao-setup-standee-colour',
    description: 'Which standee and colour',
    owner: 'player',
    when: 'setup',
    resolvedBy: ['setup_standee'],
    aiPolicy: 'Takes the first colour no human chose (cosmetic — no effect on play).',
  },
  {
    id: 'ao-setup-draw-report',
    description: 'Report the quest cards drawn and the starting tile flipped at setup (a table with real cards)',
    owner: 'player',
    when: 'setup',
    resolvedBy: ['setup_report'],
    aiPolicy: 'Never owed by an AI: a human reports every real draw.',
  },
  {
    id: 'ao-turn-order-roll',
    description: 'Their 2-dice turn-order total',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['report_turn_order_roll'],
    aiPolicy: 'Rolls 2 dice with the seeded rng (the server rolls for AI players, RULES.md §12).',
  },
  {
    id: 'ao-move-path',
    description: 'Their move: which path, how far, or stop',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['step', 'stop'],
    distinguishedBy: 'to',
    aiPolicy: 'easy: random. medium/hard: step toward the destination worth most (quest progress from the outcome, times its odds, discounted 30% per extra turn); stop only when nothing is worth anything.',
  },
  {
    id: 'ao-try-again',
    description: 'Stay on a failed icon and try again, or move away',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['try_again', 'move_away'],
    aiPolicy: 'easy: random. medium/hard: stays when the failed icon is still the best destination (hard uses its real odds of the next card); otherwise walks toward a better one or explores.',
  },
  {
    id: 'ao-explore-slot-rotation',
    description: 'Whether to explore, which slot, which rotation',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['explore'],
    distinguishedBy: 'slot',
    aiPolicy: 'medium/hard: explore when it is the best destination; place the tile at the slot and turn that bring its icons closest to me and furthest from the rivals.',
  },
  {
    id: 'ao-forced-explore-slot',
    description: 'Which slot anywhere on the map + rotation (forced explore, or a Dungeon Map card)',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['explore'],
    distinguishedBy: 'slot',
    aiPolicy: 'Same placement rule as an ordinary explore, over every empty slot on the map.',
  },
  {
    id: 'ao-any-artifact-pick',
    description: 'Which suit artifact, from supply or a player — or decline',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['take_artifact', 'decline_artifact'],
    distinguishedBy: 'artifact',
    aiPolicy: 'Takes the artifact worth most — counting what the holder loses; never declines, since taking always completes the Dungeon.',
  },
  {
    id: 'ao-test-roll',
    description: 'Their test dice total (recruit / fight)',
    owner: 'player',
    when: 'in-game',
    // resolve_report (digital button) is a randomness reveal, not a decision.
    resolvedBy: ['report_test_roll', 'resolve_report'],
    aiPolicy: 'Rolls its stat in dice with the seeded rng.',
  },
  {
    id: 'ao-report-card',
    description: 'Report the card you physically drew (city / monster / dungeon)',
    owner: 'player',
    when: 'in-game',
    // resolve_report is the digital-seat reveal button for the SAME pending —
    // randomness, not a decision (docs/digital-mode.md).
    resolvedBy: ['report_card', 'resolve_report'],
    aiPolicy: 'Never owed by an AI: at a table with real cards a human draws for the AI.',
  },
];
