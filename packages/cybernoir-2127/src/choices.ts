// Cybernoir 2127 — the choice catalog (see core/choiceCatalog.ts).
// Transcribed from POST-PORT.md §6 (rows C01-C19).
//
// Two asymmetric seats: most rows belong to one side only, so the row says which.

import type { PlayerChoice } from '@zekel/game-kit';

export const CYBERNOIR_CHOICES: PlayerChoice[] = [
  // ---- Setup ----
  {
    id: 'hideout',
    description: 'Hacker: which of the 18 locations you hide in',
    owner: 'player',
    when: 'setup',
    resolvedBy: ['report_hideout'],
    balanceAxis: 'hideout',
    dependsOn: 'holding the Hacker seat',
  },
  {
    id: 'report-location-hand',
    description: 'Report the Location cards you were physically dealt',
    owner: 'player',
    when: 'setup',
    resolvedBy: ['report_location_hand'],
  },
  {
    id: 'detective-role',
    description: 'Which seat plays the Detective',
    owner: 'player',
    when: 'setup',
    resolvedBy: ['options.detective'],
  },

  // ---- Detective ----
  {
    id: 'play-location',
    description: 'Detective: which Location card you play — you must play one',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['play_location'],
    dependsOn: 'holding the Detective seat',
  },
  {
    id: 'upkeep',
    description: 'Detective: which informants you keep, and which you let go',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['upkeep_choice'],
    dependsOn: 'holding the Detective seat with informants to pay for',
  },
  {
    id: 'arrest',
    description: 'Detective: who you arrest',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['arrest'],
    dependsOn: 'holding the Detective seat with someone arrestable in reach',
  },
  {
    id: 'recruit-informant',
    description: 'Detective: who you recruit as an informant',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['recruit_informant'],
    dependsOn: 'holding the Detective seat with the AP to recruit',
  },
  {
    id: 'buy-clue',
    description: 'Detective: which cards you discard to buy a clue',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['buy_clue'],
    dependsOn: 'holding the Detective seat with enough cards to spend',
  },
  {
    id: 'block',
    description: 'Detective: whether to block a play by revealing the matching informant',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['block_decide'],
    dependsOn: 'holding the Detective seat with an informant matching the played person',
  },
  {
    id: 'guess',
    description: 'Detective: guessing the hideout, mid-game or as your final guess',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['guess_location', 'final_guess'],
    dependsOn: 'holding the Detective seat and choosing to guess',
  },
  {
    id: 'draw-extra',
    description: 'Detective: drawing an extra Location card or a contact',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['draw_extra_location', 'draw_contact'],
    dependsOn: 'holding the Detective seat with the AP and a non-empty deck',
  },

  // ---- Hacker ----
  {
    id: 'clue-reveal',
    description: 'Hacker: which clue category you reveal',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['clue_reveal'],
    dependsOn: 'holding the Hacker seat with an unrevealed category',
  },
  {
    id: 'play-person',
    description: 'Hacker: which person you play',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['play_person'],
    dependsOn: 'holding the Hacker seat',
  },
  {
    id: 'play-evidence',
    description: 'Hacker: which Evidence you commit, and to which slot',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['play_evidence', 'motive', 'witness', 'weapon'],
    dependsOn:
      'holding the Hacker seat. KNOWN DEFECT, not a rare condition: legalMoves.ts:452 gates every ' +
      "Evidence play on `state.hacker.kind === 'tracked'`, and a HUMAN Hacker is opaque, so a " +
      'human is never offered any way to commit Evidence — their whole win path. The engine ' +
      'accepts a declared play_evidence perfectly well (verified: "Played Eddie the Doorman as ' +
      'witness evidence"), so this is a legibility gap, not a missing rule. Compare play_person ' +
      'just above at legalMoves.ts:433, which does handle the opaque case.',
  },
  {
    id: 'win-back',
    description: 'Hacker: which revealed informant you win back',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['win_back'],
    dependsOn: 'holding the Hacker seat with a revealed informant to win back',
  },
  {
    id: 'jailbreak',
    description: 'Hacker: who you spring from jail, and which token you declare false',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['jailbreak'],
    dependsOn: 'holding the Hacker seat with someone in jail',
  },
  {
    id: 'overclock',
    description: 'Hacker: whether to Overclock',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['overclock'],
    dependsOn: 'holding the Hacker seat with Overclock available',
  },
  {
    id: 'burn-safehouse',
    description: 'Hacker: whether to burn the safehouse, and where you move to',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['burn_safehouse', 'burn_choice'],
    dependsOn: 'holding the Hacker seat with the AP and somewhere to relocate to',
  },
  {
    id: 'reveal-informant',
    description: 'Hacker: which facedown informant Corp 1 reveals — chosen blind, by position',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['reveal_informant'],
    dependsOn: 'playing Corp 1 while the Detective holds a facedown informant',
  },
  {
    id: 'board-discard',
    description: 'Hacker: which board Location a Gang 2 or 3 discards',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['board_discard_choice'],
    dependsOn: 'playing Gang 2 or Gang 3',
  },
  {
    id: 'discard-retrieval',
    description: 'Hacker: which discarded card Corp 2 retrieves',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['discard_retrieval_choice'],
    dependsOn: 'playing Corp 2 with a non-empty discard',
  },
  {
    id: 'informant-removal',
    description: 'Hacker: which informant an Anansi or Iceden rider removes or wins back',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['informant_removal_choice'],
    dependsOn: 'committing Evidence that carries the Anansi or Iceden rider',
  },

  // ---- Either seat ----
  {
    id: 'pass-turn',
    description: 'Ending your turn',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['pass_turn'],
  },
];
