// The choice catalog (post-port runbook §5): every decision the game gives the
// player, who owns it, and which move settles it. Written from the human-seat
// walk in POST-PORT.md §5/§6; `auto` rows say why the engine may settle them.
// Solo game: "the player" is the single seat. Typed to match
// @zekel/game-kit's PlayerChoice structurally (index.ts hands it through).

export interface ChoiceRow {
  id: string;
  description: string;
  owner: 'player' | 'auto';
  when: 'setup' | 'in-game';
  resolvedBy: string[];
  distinguishedBy?: string;
  dependsOn?: string;
  why?: string;
  balanceAxis?: string;
}

export const DEMON_HUNTER_CHOICES: ChoiceRow[] = [
  // ---- Setup ----
  {
    id: 'world-seed',
    description: 'Which world to play: the seed (and how many clearings it has)',
    owner: 'player',
    when: 'setup',
    resolvedBy: ['options.seed', 'options.clearings'],
    balanceAxis: 'world_seed',
  },

  // ---- Outdoors ----
  {
    id: 'where-to-go',
    description: 'Which path to take from the place you stand',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['move'],
    distinguishedBy: 'to',
  },
  {
    id: 'where-to-travel',
    description: 'Where to travel in one go (a place, a quest giver\'s town, the nearest inn), and whether to press on past a stop at the edge of danger',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['travel'],
  },
  {
    id: 'enter-or-pass',
    description: 'Whether to go into a town or temple you stand outside, and when to leave it',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['enter', 'leave'],
  },
  {
    id: 'whom-to-attack',
    description: 'Which enemy, plant or tree here you attack',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['attack'],
    distinguishedBy: 'target',
  },
  {
    id: 'bomb-here',
    description: 'Whether to set off a bomb where you stand (it hits everything on the node)',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['bomb'],
    dependsOn: 'holding a bomb or the Fire Bombs',
  },
  {
    id: 'black-market',
    description: 'Whether to talk to a Lady Bandit and, once she has made her offer, which of bomb or lockpick to buy',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['talk_bandit', 'buy_from_bandit'],
    distinguishedBy: 'item',
    dependsOn: 'a Lady Bandit you have not attacked is here',
  },
  {
    id: 'fly-or-walk',
    description: 'Whether to fly over enemies with the Winged Boots, and when to land',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['fly', 'land'],
    dependsOn: 'holding the Winged Boots',
  },
  {
    id: 'raise-the-aura',
    description: 'Whether to raise the Aura of Protection, in a fight or before moving',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['aura'],
    dependsOn: 'holding the Aura of Protection',
  },
  {
    id: 'teleport-destination',
    description: 'Which visited town the Cape of Teleportation takes you to',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['teleport'],
    distinguishedBy: 'town',
    dependsOn: 'holding the Cape of Teleportation',
  },

  // ---- Combat ----
  {
    id: 'fight-or-flee',
    description: 'In a fight, whether to attack or run away (or walk out under the aura)',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['fight', 'flee', 'aura'],
  },
  {
    id: 'which-blocker-fights-first',
    description: 'When several enemies would stop you leaving a place, which one you fight first',
    owner: 'auto',
    when: 'in-game',
    resolvedBy: ['move'],
    why: 'Every blocker must be fought (or fled) before you can leave, so the order changes nothing; the engine takes them in id order. Mushrooms are fungible.',
  },
  {
    id: 'enemy-actions',
    description: "An enemy's own action: attack, flee (snake, wizard), teleport destination",
    owner: 'auto',
    when: 'in-game',
    resolvedBy: ['fight', 'flee', 'attack'],
    why: 'Enemy behaviour is rule-scripted and its randomness (50% snake flee, 50% wizard teleport) is the server\'s, as all dice are in this game.',
  },

  // ---- Progression ----
  {
    id: 'level-up-stat',
    description: 'Which stat you raise with an earned level or a Blacksmith\'s favour',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['level_up'],
    distinguishedBy: 'stat',
  },
  {
    id: 'continue-after-death',
    description: 'After dying, when to continue from the last town you visited',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['continue'],
    dependsOn: 'having died',
  },

  // ---- Town ----
  {
    id: 'ask-around',
    description: 'What to ask around town for: a pet, colour, trade, item, a task, who knows the truth, or contradictions in your clue book',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['search_town'],
  },
  {
    id: 'whom-to-talk-to',
    description: 'Which townsperson you talk to',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['talk'],
    distinguishedBy: 'person',
  },
  {
    id: 'take-the-task',
    description: 'Whether to accept a person\'s task (any number may be active at once) or decline',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['accept_task', 'decline'],
  },
  {
    id: 'reward-clue-or-power',
    description: 'On finishing a task for someone who knows the truth: their demon secret, or their occupation\'s favour',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['claim_reward'],
    distinguishedBy: 'reward',
    dependsOn: 'having completed a task for a truth-knower',
  },
  {
    id: 'claim-the-favour',
    description: 'On finishing a task for anyone else: claim their occupation\'s favour',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['claim_reward'],
    dependsOn: 'having completed a task',
  },
  {
    id: 'claim-in-one-move',
    description: 'Claiming a reward from a giver in their town without talking first (claim_reward with their id)',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['claim_reward'],
    distinguishedBy: 'person',
    dependsOn: 'a completed task whose giver is in this town',
  },
  {
    id: 'end-the-conversation',
    description: 'When to say goodbye',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['goodbye'],
  },
  {
    id: 'inn-services',
    description: 'At the inn: sleep, train, ride to a town (which one), buy or sell a resource (which one, how many), or leave',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['inn', 'sleep', 'train', 'ride', 'buy', 'sell', 'leave_inn'],
  },
  {
    id: 'which-house-to-search',
    description: 'Whose house to open with a lockpick or a Locksmith\'s favour, and confirming the lockpick',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['search_house'],
    distinguishedBy: 'person',
    dependsOn: 'holding a lockpick or a Locksmith\'s favour',
  },
  {
    id: 'suspects',
    description: 'Whom you mark as a suspect in your clue book',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['mark_suspect', 'unmark_suspect'],
    distinguishedBy: 'person',
  },
  {
    id: 'the-knife',
    description: 'Whom you stab with the demon-killing knife, face to face in their town, and when',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['stab'],
    distinguishedBy: 'person',
  },
  {
    id: 'barber-introductions',
    description: 'Which people the Barber introduces you to',
    owner: 'auto',
    when: 'in-game',
    resolvedBy: ['claim_reward'],
    why: 'The original picks 1–5 random unmet people; the Barber chooses, not the player.',
  },
  {
    id: 'carpenter-town',
    description: 'Which town the Carpenter rules out',
    owner: 'auto',
    when: 'in-game',
    resolvedBy: ['claim_reward'],
    why: 'The original picks a random town the demon is not in and that is not already ruled out; the Carpenter chooses.',
  },
  {
    id: 'binding-name',
    description: 'Which binding a minion\'s house holds',
    owner: 'auto',
    when: 'in-game',
    resolvedBy: ['search_house'],
    why: 'Cosmetic: the original hands out the registry names in order.',
  },

  // ---- Temples ----
  {
    id: 'gauntlet-or-riddle',
    description: 'Inside a temple, whether to fight the gauntlet or answer the riddle, and switching between them',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['gauntlet', 'riddle'],
  },
  {
    id: 'next-guardian',
    description: 'When to face the next guardian of the gauntlet',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['next_fight'],
    dependsOn: 'a gauntlet under way',
  },
  {
    id: 'riddle-answer',
    description: 'Your answer to the riddle, in your own words',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['answer_riddle'],
    distinguishedBy: 'text',
    dependsOn: 'standing at a riddle door',
  },

  // ---- The finale ----
  {
    id: 'arena-minions',
    description: 'Which three monsters the demon summons',
    owner: 'auto',
    when: 'in-game',
    resolvedBy: ['fight'],
    why: 'The original draws three random overworld types; the demon chooses.',
  },
];
