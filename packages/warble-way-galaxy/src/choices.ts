// Warble Way Galaxy — the choice catalog (see core/choiceCatalog.ts).
// Transcribed from POST-PORT.md §6.
//
// A solo game, so "the player" is the single seat. The §6 table groups the
// decisions by where in the game they come up rather than one row per move, and
// this follows that grouping.

import type { PlayerChoice } from '@zekel/game-kit';

export const WARBLE_CHOICES: PlayerChoice[] = [
  // ---- Character creation ----
  {
    id: 'character',
    description: 'Your name, race, ship and disposition',
    owner: 'player',
    when: 'setup',
    resolvedBy: ['create_character'],
    balanceAxis: 'creation_archetype',
  },
  {
    id: 'ability-scores',
    description: 'How you set your ability scores — the method and the spread',
    owner: 'player',
    when: 'setup',
    resolvedBy: ['create_character'],
    balanceAxis: 'creation_archetype',
  },

  // ---- At a habitat ----
  {
    id: 'habitat-action',
    description:
      'What you do at a habitat — repair, reduce unrest, buy, fabricate, upgrade, equip, ' +
      'recruit, take a mission, or depart',
    owner: 'player',
    when: 'in-game',
    resolvedBy: [
      'attempt_repair',
      'pay_repair',
      'attempt_reduce_unrest',
      'buy_item',
      'fabricate_part',
      'upgrade_item',
      'equip_item',
      'recruit_at',
      'recruit_unnamed',
      'take_mission',
      'depart_for_next_habitat',
    ],
  },
  {
    id: 'equip-target',
    description: 'Who wears the gear',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['equip_item'],
  },
  {
    id: 'level-up',
    description: 'Which ability you raise on levelling up',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['level_up'],
    dependsOn: 'earning enough experience to level up',
  },
  {
    id: 'release-crew',
    description: 'Who you release when you are over capacity',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['release_crew'],
    dependsOn: 'being over your crew capacity',
  },

  // ---- Travel ----
  {
    id: 'report-card-draw',
    description: 'Report the travel card you physically drew',
    owner: 'player',
    when: 'in-game',
    // resolve_report is the digital-seat button for the SAME pending — a
    // RANDOMNESS REVEAL, not a decision: the player's choice is what they do
    // with the draw after, which stays in the catalog entries below.
    resolvedBy: ['report_card_draw', 'resolve_report'],
  },
  {
    id: 'report-roll',
    description: 'Report what you physically rolled',
    owner: 'player',
    when: 'in-game',
    // resolve_report (digital button) is a randomness reveal, not a decision.
    resolvedBy: ['report_roll', 'resolve_report'],
  },
  {
    id: 'res-peek',
    description: 'Use the RES peek or skip it, and if you use it, which card you discard',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['report_res_discard', 'skip_res_peek'],
    dependsOn: 'having RES high enough to peek',
  },
  {
    id: 'hazard',
    description: 'Which hazard option you take, and whose score carries it — the carrier takes the consequence',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['choose_hazard_option'],
    dependsOn: 'drawing a hazard',
  },
  {
    id: 'mission-offer',
    description: 'Accept or decline a mission you are offered',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['accept_mission', 'decline_mission'],
    dependsOn: 'being offered a mission',
  },
  {
    id: 'recruit-offer',
    description: 'Accept or decline someone offering to join you',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['attempt_recruit', 'decline_recruit', 'recruit_survivors'],
    dependsOn: 'meeting someone who can be recruited',
  },
  {
    id: 'reroll',
    description: 'Whether to spend a reroll',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['use_reroll', 'accept_result'],
    dependsOn: 'holding a reroll when a roll goes against you',
  },
  {
    id: 'use-consumable',
    description: 'Whether to declare a consumable before the roll',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['use_item'],
    dependsOn: 'holding a consumable when a roll is pending',
  },

  // ---- Encounters and combat ----
  {
    id: 'run-silent-or-engage',
    description: 'Slip past quietly, or engage',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['attempt_evade', 'decline_evade'],
    dependsOn: 'meeting something you could avoid',
  },
  {
    id: 'combat-action',
    description:
      'What you do in a combat round — fight, open fire, hack, intimidate, escape, board, ' +
      'take or abandon the ship',
    owner: 'player',
    when: 'in-game',
    resolvedBy: [
      'fight_round',
      'open_fire',
      'attempt_hack',
      'attempt_intimidate',
      'attempt_escape',
      'board_ship',
      'leave_pirate',
      'take_ship',
      'abandon_ship',
      'escape_to_start',
      'redline',
      'attack',
    ],
    dependsOn: 'reaching a fight',
  },
  {
    id: 'sacrifice-crew',
    description: 'Whether to let an unnamed crew member take the hit',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['sacrifice_unnamed', 'decline_sacrifice'],
    dependsOn: 'having unnamed crew aboard when a hit lands',
  },

  // ---- Ruins ----
  {
    id: 'ruin-entry',
    description: 'Whether to enter a ruin, and how deep to go',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['enter_ruin', 'skip_ruin'],
    dependsOn: 'finding a ruin',
  },
  {
    id: 'ruin-setup',
    description: 'Your party, the entrance, the threat level, and where the attackers start',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['setup_encounter'],
    dependsOn: 'entering a ruin',
  },
  {
    id: 'ruin-turn',
    description:
      'In a ruin: which being acts, how they split move and act, what they target, and whether ' +
      'they collect, recruit or escape',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['move_being', 'collect_item', 'end_being_turn'],
    dependsOn: 'being inside a ruin',
  },

  // ---- Settled by the engine ----
  {
    id: 'crew-names',
    description: 'What unnamed crew and captured ships are called',
    owner: 'auto',
    when: 'in-game',
    resolvedBy: [],
    why: 'Labels only, with no effect on play. The DM may give them colour.',
  },
  {
    id: 'combat-pairing',
    description: 'Who fights whom in a combat round',
    owner: 'auto',
    when: 'in-game',
    resolvedBy: [],
    why: 'The rules force it from who has the advantage — there is nothing to choose.',
  },
  {
    id: 'which-score-rolls',
    description: 'Which ability score a boarding, mission or space roll uses',
    owner: 'auto',
    when: 'in-game',
    resolvedBy: [],
    why: 'The rules say to use the highest, or name the score outright.',
  },
  {
    id: 'attacker-behaviour',
    description: 'What the attackers do on their turn',
    owner: 'auto',
    when: 'in-game',
    resolvedBy: [],
    why: 'Scripted by the rules — the player never directs them.',
  },
];
