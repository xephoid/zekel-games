// Rules encoding for Adventurer Olympics, authored from the pinned rules text
// ALONE (rules-v2-2026-09-30.txt, next to this file). No
// game-module knowledge used.
import type { EncodingEntry, GameRulesEncoding, NotApplicableCell } from '@zekel/dev/verify/types';

// ---------------------------------------------------------------------------
// Universe
// ---------------------------------------------------------------------------

const ZONES = [
  'map tile stack',
  'map (tiles/hexes/icons)',
  'quest deck',
  'in-play quests',
  'quest box',
  'companion deck',
  'companion held',
  'dungeon deck',
  'little monster deck',
  'big monster deck',
  'artifact supply',
  'artifact held',
  'player tokens',
  'player standee',
  'initiative tokens',
] as const;
type ZoneName = (typeof ZONES)[number];

const EVENTS = [
  'setup-shuffle-decks',
  'setup-artifact-supply',
  'setup-standee-colour',
  'setup-quest-draw',
  'setup-starting-tile',
  'setup-standee-placement',
  'setup-starting-stats',
  'round-roll-turn-order',
  'round-take-turns',
  'turn-move',
  'turn-stop',
  'turn-try-again',
  'turn-explore',
  'turn-forced-explore',
  'icon-trigger',
  'icon-complete',
  'icon-fail',
  'city-recruit',
  'monster-fight',
  'dungeon-draw',
  'dungeon-resolve',
  'dungeon-draw-again',
  'dungeon-complete',
  'dungeon-fail',
  'artifact-hex-take',
  'artifact-transfer',
  'artifact-star',
  'stat-compute',
  'quest-claim',
  'quest-endgame-score',
  'quest-points',
  'game-end-trigger',
  'game-end-sequence',
] as const;
type EventKind = (typeof EVENTS)[number];

const COUNTERS = [
  'steps left this turn',
  'charisma',
  'strength',
  'movement',
  'quest points',
  'explored tiles (own)',
  'dungeons completed (own)',
  'companions held (own)',
  'little monsters defeated (own)',
  'big monsters defeated (own)',
  'artifacts held (own)',
  'quest deck size',
  'companion deck size',
  'dungeon deck size',
  'little monster deck size',
  'big monster deck size',
  'map tile stack size',
  'tokens used (own)',
  'player count',
];

// Entries are typed against the universe so a typo'd zone or event kind fails
// typecheck instead of silently punching a hole in coverage.
type Entry = EncodingEntry & { eventKind: EventKind; zones: ZoneName[] };

// ---------------------------------------------------------------------------
// Entries — setup
// ---------------------------------------------------------------------------

const setupEntries: Entry[] = [
  {
    id: 'setup-shuffle',
    status: 'rule',
    eventKind: 'setup-shuffle-decks',
    zones: ['quest deck', 'companion deck', 'dungeon deck', 'little monster deck', 'big monster deck', 'map tile stack'],
    trigger: 'At setup, before any round.',
    effects: [
      { op: 'set_counter', counter: 'quest deck size', to: 6 },
      { op: 'set_counter', counter: 'companion deck size', to: 16 },
      { op: 'set_counter', counter: 'dungeon deck size', to: 24 },
      { op: 'set_counter', counter: 'little monster deck size', to: 12 },
      { op: 'set_counter', counter: 'big monster deck size', to: 12 },
      { op: 'set_counter', counter: 'map tile stack size', to: 10 },
    ],
    citation: {
      section: '2',
      quote: 'Shuffle the Quest, Companion, Dungeon, Little Monster and Big Monster decks separately',
    },
  },
  {
    id: 'setup-artifacts',
    status: 'rule',
    eventKind: 'setup-artifact-supply',
    zones: ['artifact supply'],
    trigger: 'At setup, before any round.',
    effects: [
      { op: 'move_token', token: 'all 5 artifact cards', from: 'box', to: 'artifact supply' },
    ],
    citation: {
      section: '2',
      quote: 'Put the 5 artifact cards face up beside the decks. This is the artifact supply.',
    },
  },
  {
    id: 'setup-standee',
    status: 'rule',
    eventKind: 'setup-standee-colour',
    zones: ['player standee', 'player tokens'],
    trigger: 'At setup, each player picks a standee and colour.',
    effects: [
      { op: 'player_choice', chooser: 'each player', choiceOf: 'an Adventurer standee and a colour', then: [
        { op: 'move_token', token: 'the 10 tokens of that colour', from: 'box', to: 'player tokens' },
      ] },
    ],
    citation: {
      section: '2',
      quote: 'Each player chooses an Adventurer standee and a colour, and takes the 10 tokens of that colour.',
    },
  },
  {
    id: 'setup-quests',
    status: 'rule',
    eventKind: 'setup-quest-draw',
    zones: ['quest deck', 'in-play quests', 'quest box'],
    trigger: 'At setup, after the standee/colour pick.',
    effects: [
      { op: 'draw', from: 'quest deck', to: 'in-play quests', count: 'players + 1' },
      { op: 'set_counter', counter: 'quest deck size', to: '6 - (players + 1)' },
    ],
    citation: {
      section: '2',
      quote: 'Draw **number of players + 1** Quest cards and place them face up',
    },
  },
  {
    id: 'setup-starting-tile',
    status: 'rule',
    eventKind: 'setup-starting-tile',
    zones: ['map tile stack', 'map (tiles/hexes/icons)'],
    trigger: 'At setup, after the quest draw.',
    effects: [
      { op: 'move_token', token: 'the top map tile', from: 'map tile stack', to: 'map (tiles/hexes/icons)' },
      { op: 'set_counter', counter: 'map tile stack size', to: 9 },
    ],
    citation: {
      section: '2',
      quote: 'Shuffle the 10 map tiles face down into a stack. Turn the top tile face up',
    },
  },
  {
    id: 'setup-standee-placement',
    status: 'rule',
    eventKind: 'setup-standee-placement',
    zones: ['map (tiles/hexes/icons)', 'player standee'],
    trigger: 'At setup, after the starting tile is placed.',
    effects: [
      { op: 'move_token', token: 'every player standee', from: 'box', to: 'map (tiles/hexes/icons) (centre hex of the starting tile)' },
    ],
    citation: {
      section: '2',
      quote: 'Every player places their standee on the centre hex of the starting tile.',
    },
  },
  {
    id: 'setup-starting-stats',
    status: 'rule',
    eventKind: 'setup-starting-stats',
    zones: ['companion held'],
    trigger: 'At setup, every player starts with the baseline stats.',
    effects: [
      { op: 'set_counter', counter: 'charisma', to: 1 },
      { op: 'set_counter', counter: 'strength', to: 1 },
      { op: 'set_counter', counter: 'movement', to: 2 },
    ],
    citation: {
      section: '2',
      quote: 'Every player starts with:',
    },
  },
];

// ---------------------------------------------------------------------------
// Entries — round & turn
// ---------------------------------------------------------------------------

const roundEntries: Entry[] = [
  {
    id: 'round-roll-order',
    status: 'rule',
    eventKind: 'round-roll-turn-order',
    zones: ['initiative tokens'],
    trigger: 'At the start of every round.',
    effects: [
      { op: 'player_choice', chooser: 'each player', choiceOf: 'roll 2 dice and report the total', then: [
        { op: 'set_counter', counter: 'initiative tokens', to: 'assigned 1-4 by descending total' },
      ] },
    ],
    citation: {
      section: '4.1',
      quote: 'Every player rolls 2 dice. The highest total goes first',
    },
  },
  {
    id: 'round-roll-tie',
    status: 'rule',
    eventKind: 'round-roll-turn-order',
    zones: ['initiative tokens'],
    trigger: 'Two or more players tie on the 2-dice total.',
    effects: [
      { op: 'conditional', condition: 'a tie exists', then: [
        { op: 'player_choice', chooser: 'the tied players', choiceOf: 'roll again to settle their places', then: [
          { op: 'set_counter', counter: 'initiative tokens', to: 'assigned after the re-roll' },
        ] },
      ] },
    ],
    citation: {
      section: '4.1',
      quote: 'Players who tie roll again to settle their places.',
    },
  },
  {
    id: 'round-take-turns',
    status: 'rule',
    eventKind: 'round-take-turns',
    zones: ['initiative tokens', 'map (tiles/hexes/icons)'],
    trigger: 'After the turn order is set.',
    effects: [
      { op: 'conditional', condition: 'every player has had a turn', then: [
        { op: 'set_counter', counter: 'initiative tokens', to: 'a new round begins with a new roll' },
      ] },
    ],
    citation: {
      section: '4.2',
      quote: 'In turn order, each player takes one turn',
    },
  },
  {
    id: 'turn-move',
    status: 'rule',
    eventKind: 'turn-move',
    zones: ['map (tiles/hexes/icons)', 'player standee'],
    trigger: 'On a player\'s turn, before any icon trigger or explore.',
    effects: [
      { op: 'conditional', condition: 'stepsLeft > 0 and the hex is adjacent and not opponent-occupied and not an uncompleted icon (or is a completed icon)', then: [
        { op: 'move_token', token: 'the player standee', from: 'current hex', to: 'adjacent hex' },
        { op: 'adjust_counter', counter: 'steps left this turn', by: -1 },
      ] },
    ],
    citation: {
      section: '5.1',
      quote: 'Each step moves your standee to an adjacent hex.',
    },
  },
  {
    id: 'turn-stop',
    status: 'rule',
    eventKind: 'turn-stop',
    zones: ['map (tiles/hexes/icons)'],
    trigger: 'A player chooses to stop moving.',
    effects: [
      { op: 'set_counter', counter: 'steps left this turn', to: 0 },
    ],
    citation: {
      section: '5',
      quote: 'You have used all your steps, or you choose to stop.',
    },
  },
  {
    id: 'turn-try-again',
    status: 'rule',
    eventKind: 'turn-try-again',
    zones: ['map (tiles/hexes/icons)', 'companion deck', 'little monster deck', 'big monster deck', 'dungeon deck'],
    trigger: 'A player starts their turn standing on an uncompleted icon hex.',
    effects: [
      { op: 'player_choice', chooser: 'the player', choiceOf: 'stay and try again, or move away', then: [
        { op: 'conditional', condition: 'stay', then: [
          { op: 'draw', from: 'the matching deck', to: 'resolve', count: 1 },
          { op: 'set_counter', counter: 'steps left this turn', to: 0 },
        ] },
      ] },
    ],
    citation: {
      section: '5.2',
      quote: 'you may stay and try again instead of moving. The icon triggers again as if you had just stepped on it, with a fresh card from the top of the deck.',
    },
  },
  {
    id: 'turn-explore',
    status: 'rule',
    eventKind: 'turn-explore',
    zones: ['map tile stack', 'map (tiles/hexes/icons)', 'player tokens'],
    trigger: 'A player has at least one step left and is standing on a hex touching an empty tile slot.',
    effects: [
      { op: 'draw', from: 'map tile stack', to: 'map (tiles/hexes/icons)', count: 1 },
      { op: 'move_token', token: 'one of the player\'s tokens', from: 'player tokens', to: 'map (tiles/hexes/icons) (centre hex of the new tile)' },
      { op: 'set_counter', counter: 'steps left this turn', to: 0 },
      { op: 'set_counter', counter: 'map tile stack size', to: 'map tile stack size - 1' },
    ],
    citation: {
      section: '5.3',
      quote: 'Take the top tile from the map tile stack and turn it face up',
    },
  },
  {
    id: 'turn-forced-explore',
    status: 'rule',
    eventKind: 'turn-forced-explore',
    zones: ['map tile stack', 'map (tiles/hexes/icons)', 'player tokens'],
    trigger: 'Every icon on the map has been completed; the next player to take a turn.',
    effects: [
      { op: 'conditional', condition: 'map tile stack size > 0', then: [
        { op: 'draw', from: 'map tile stack', to: 'map (tiles/hexes/icons)', count: 1 },
        { op: 'move_token', token: 'one of the player\'s tokens', from: 'player tokens', to: 'map (tiles/hexes/icons) (centre hex of the new tile)' },
        { op: 'set_counter', counter: 'map tile stack size', to: 'map tile stack size - 1' },
      ] },
    ],
    citation: {
      section: '5.4',
      quote: 'must explore at the **start** of their turn, before moving',
    },
  },
];

// ---------------------------------------------------------------------------
// Entries — icons & tests
// ---------------------------------------------------------------------------

const iconEntries: Entry[] = [
  {
    id: 'icon-trigger',
    status: 'rule',
    eventKind: 'icon-trigger',
    zones: ['map (tiles/hexes/icons)'],
    trigger: 'A player steps onto (or stays on) an uncompleted icon hex.',
    effects: [
      { op: 'conditional', condition: 'the icon is uncompleted', then: [
        { op: 'player_choice', chooser: 'the player', choiceOf: 'resolve the icon (recruit/fight/dungeon/artifact)', then: [
          { op: 'set_counter', counter: 'steps left this turn', to: 0 },
        ] },
      ] },
    ],
    citation: {
      section: '6',
      quote: 'When you step onto an uncompleted icon (or stay on one to try again), it triggers. Resolve it, then your turn ends.',
    },
  },
  {
    id: 'icon-complete',
    status: 'rule',
    eventKind: 'icon-complete',
    zones: ['map (tiles/hexes/icons)', 'player tokens'],
    trigger: 'A player succeeds on an icon test.',
    effects: [
      { op: 'move_token', token: 'one of the player\'s tokens', from: 'player tokens', to: 'map (tiles/hexes/icons) (the icon hex)' },
      { op: 'set_counter', counter: 'the icon\'s completed flag', to: 'true' },
    ],
    citation: {
      section: '6',
      quote: '**If you succeed**, put one of your tokens on that icon\'s hex. The icon is now',
    },
  },
  {
    id: 'icon-fail',
    status: 'rule',
    eventKind: 'icon-fail',
    zones: ['map (tiles/hexes/icons)'],
    trigger: 'A player fails an icon test.',
    effects: [
      { op: 'set_counter', counter: 'the icon\'s completed flag', to: 'false (stays open)' },
    ],
    citation: {
      section: '6',
      quote: '**If you fail**, nothing is placed. The icon stays open.',
    },
  },
  {
    id: 'city-recruit',
    status: 'rule',
    eventKind: 'city-recruit',
    zones: ['companion deck', 'companion held'],
    trigger: 'A player resolves a City icon (or a Dungeon Companion card).',
    effects: [
      { op: 'draw', from: 'companion deck', to: 'resolve', count: 1 },
      { op: 'conditional', condition: 'roll (Charisma dice) >= the card number', then: [
        { op: 'move_token', token: 'the companion card', from: 'resolve', to: 'companion held' },
      ], otherwise: [
        { op: 'move_token', token: 'the companion card', from: 'resolve', to: 'companion deck (bottom)' },
      ] },
    ],
    citation: {
      section: '6.1',
      quote: 'Draw the top Companion card. Note its number (top right).',
    },
  },
  {
    id: 'monster-fight',
    status: 'rule',
    eventKind: 'monster-fight',
    zones: ['little monster deck', 'big monster deck'],
    trigger: 'A player resolves a Little/Big Monster icon (or a Dungeon monster card).',
    effects: [
      { op: 'draw', from: 'the matching deck', to: 'resolve', count: 1 },
      { op: 'conditional', condition: 'roll (Strength dice) >= the card number', then: [
        { op: 'move_token', token: 'the monster card', from: 'resolve', to: 'companion held (defeated, kept)' },
      ], otherwise: [
        { op: 'move_token', token: 'the monster card', from: 'resolve', to: 'the matching deck (bottom)' },
      ] },
    ],
    citation: {
      section: '6.2',
      quote: 'Draw the top card from the matching deck (Little Monster or Big Monster).',
    },
  },
  {
    id: 'monster-deck-empty',
    status: 'rule',
    eventKind: 'monster-fight',
    zones: ['little monster deck', 'big monster deck'],
    trigger: 'The matching monster deck is empty when a fight is required.',
    effects: [
      { op: 'conditional', condition: 'deck size == 0', then: [
        { op: 'set_counter', counter: 'the icon\'s completed flag', to: 'false (stays open, nothing happens)' },
      ] },
    ],
    citation: {
      section: '6.2',
      quote: '**If the deck is empty** (defeated monsters are kept, so the Little Monster deck',
    },
  },
  {
    id: 'dungeon-draw',
    status: 'rule',
    eventKind: 'dungeon-draw',
    zones: ['dungeon deck'],
    trigger: 'A player resolves a Dungeon icon (or stays to try again).',
    effects: [
      { op: 'draw', from: 'dungeon deck', to: 'resolve', count: 1 },
      { op: 'conditional', condition: 'the card is resolved (success or fail)', then: [
        { op: 'move_token', token: 'the dungeon card', from: 'resolve', to: 'dungeon deck (bottom)' },
      ] },
    ],
    citation: {
      section: '6.3',
      quote: 'Draw the top Dungeon card and do what it says. When you are done with it, whatever happened, put it at the bottom of the Dungeon deck.',
    },
  },
  {
    id: 'dungeon-draw-again',
    status: 'rule',
    eventKind: 'dungeon-draw-again',
    zones: ['dungeon deck'],
    trigger: 'A Dungeon card gives nothing (declined artifact, empty stack, empty monster deck, 2x with empty deck before the first fight).',
    effects: [
      { op: 'move_token', token: 'the dungeon card', from: 'resolve', to: 'dungeon deck (bottom)' },
      { op: 'draw', from: 'dungeon deck', to: 'resolve', count: 1 },
    ],
    citation: {
      section: '6.3',
      quote: 'If a Dungeon card gives you nothing, put it at the bottom of the Dungeon deck and draw another.',
    },
  },
  {
    id: 'dungeon-termination',
    status: 'rule',
    eventKind: 'dungeon-draw-again',
    zones: ['dungeon deck', 'companion deck', 'big monster deck'],
    trigger: 'The draw-again loop runs.',
    effects: [
      { op: 'conditional', condition: 'the Dungeon deck always contains Companion and Big Monster cards, and those decks never run out', then: [
        { op: 'set_counter', counter: 'the loop', to: 'always ends (reaches a resolvable card)' },
      ] },
    ],
    citation: {
      section: '6.3',
      quote: 'This always ends: the Dungeon deck always contains Companion cards and Big Monster cards, and those decks never run out.',
    },
  },
  {
    id: 'dungeon-complete',
    status: 'rule',
    eventKind: 'dungeon-complete',
    zones: ['map (tiles/hexes/icons)', 'player tokens'],
    trigger: 'A player successfully resolves a Dungeon card.',
    effects: [
      { op: 'move_token', token: 'one of the player\'s tokens', from: 'player tokens', to: 'map (tiles/hexes/icons) (the Dungeon hex)' },
      { op: 'set_counter', counter: 'the icon\'s completed flag', to: 'true' },
    ],
    citation: {
      section: '6.3',
      quote: 'The Dungeon is completed when…',
    },
  },
  {
    id: 'dungeon-fail',
    status: 'rule',
    eventKind: 'dungeon-fail',
    zones: ['map (tiles/hexes/icons)'],
    trigger: 'A player fails the resolved Dungeon card.',
    effects: [
      { op: 'set_counter', counter: 'the icon\'s completed flag', to: 'false (stays open)' },
    ],
    citation: {
      section: '6.3',
      quote: 'If you fail the card you end up resolving, the Dungeon is not completed.',
    },
  },
  {
    id: 'artifact-hex',
    status: 'rule',
    eventKind: 'artifact-hex-take',
    zones: ['artifact supply', 'artifact held', 'map (tiles/hexes/icons)', 'player tokens'],
    trigger: 'A player steps onto an artifact hex.',
    effects: [
      { op: 'move_token', token: 'the matching artifact card', from: 'artifact supply (or another player)', to: 'artifact held' },
      { op: 'move_token', token: 'one of the player\'s tokens', from: 'player tokens', to: 'map (tiles/hexes/icons) (the artifact hex)' },
      { op: 'set_counter', counter: 'the hex\'s completed flag', to: 'true' },
    ],
    citation: {
      section: '6.4',
      quote: 'Take the matching artifact card from **wherever it is** — the',
    },
  },
  {
    id: 'artifact-star',
    status: 'rule',
    eventKind: 'artifact-star',
    zones: ['artifact supply', 'artifact held', 'map (tiles/hexes/icons)'],
    trigger: 'A player attempts to take the Star.',
    effects: [
      { op: 'conditional', condition: 'the Star is on Tile 6\'s hex', then: [
        { op: 'move_token', token: 'the Star', from: 'artifact supply (or another player)', to: 'artifact held' },
      ], otherwise: [
        { op: 'set_counter', counter: 'the take', to: 'denied (the Star can only be taken from its own hex)' },
      ] },
    ],
    citation: {
      section: '6.5',
      quote: '**The Star** can only be taken from its own map hex (Tile 6).',
    },
  },
  {
    id: 'artifact-transfer',
    status: 'rule',
    eventKind: 'artifact-transfer',
    zones: ['artifact supply', 'artifact held'],
    trigger: 'A player resolves an "Any artifact" Dungeon card.',
    effects: [
      { op: 'player_choice', chooser: 'the player', choiceOf: 'one of the four suit artifacts, from the supply or from another player (or decline)', then: [
        { op: 'move_token', token: 'the chosen artifact', from: 'artifact supply (or another player)', to: 'artifact held' },
      ] },
    ],
    citation: {
      section: '6.5',
      quote: 'An "Any artifact" Dungeon card can take any of the four **suit** artifacts',
    },
  },
];

// ---------------------------------------------------------------------------
// Entries — stats & quests
// ---------------------------------------------------------------------------

const statEntries: Entry[] = [
  {
    id: 'stat-compute',
    status: 'rule',
    eventKind: 'stat-compute',
    zones: ['companion held'],
    trigger: 'Whenever a stat is read (for a roll or a move).',
    effects: [
      { op: 'set_counter', counter: 'charisma', to: '1 + sum of companion Charisma bonuses' },
      { op: 'set_counter', counter: 'strength', to: '1 + sum of companion Strength bonuses' },
      { op: 'set_counter', counter: 'movement', to: '2 + sum of companion Movement bonuses' },
    ],
    citation: {
      section: '7',
      quote: 'Your stat is your starting value plus the bonuses on every companion you have recruited.',
    },
  },
];

const questEntries: Entry[] = [
  {
    id: 'quest-claim-explore3',
    status: 'rule',
    eventKind: 'quest-claim',
    zones: ['map (tiles/hexes/icons)', 'in-play quests'],
    trigger: 'A player places their 3rd tile (by exploring, a Dungeon Map card, or a forced explore).',
    effects: [
      { op: 'move_token', token: 'the "Explore 3 tiles" quest card', from: 'in-play quests', to: 'claimed (the player)' },
      { op: 'adjust_counter', counter: 'quest points', by: 1 },
    ],
    citation: {
      section: '8',
      quote: '**Explore 3 tiles** | Tiles with your token on the centre hex.',
    },
  },
  {
    id: 'quest-endgame-most-dungeons',
    status: 'rule',
    eventKind: 'quest-endgame-score',
    zones: ['map (tiles/hexes/icons)', 'in-play quests'],
    trigger: 'At the end of the game.',
    effects: [
      { op: 'conditional', condition: 'exactly one player has completed the most Dungeons', then: [
        { op: 'move_token', token: 'the "Most dungeons" quest card', from: 'in-play quests', to: 'claimed (that player)' },
        { op: 'adjust_counter', counter: 'quest points', by: 1 },
      ], otherwise: [
        { op: 'set_counter', counter: 'the quest', to: 'no one gets the point (tie)' },
      ] },
    ],
    citation: {
      section: '8',
      quote: '**Most dungeons** | Dungeon hexes with your token on them.',
    },
  },
  {
    id: 'quest-endgame-most-companions',
    status: 'rule',
    eventKind: 'quest-endgame-score',
    zones: ['companion held', 'in-play quests'],
    trigger: 'At the end of the game.',
    effects: [
      { op: 'conditional', condition: 'exactly one player holds the most companions', then: [
        { op: 'move_token', token: 'the "Most companions" quest card', from: 'in-play quests', to: 'claimed (that player)' },
        { op: 'adjust_counter', counter: 'quest points', by: 1 },
      ], otherwise: [
        { op: 'set_counter', counter: 'the quest', to: 'no one gets the point (tie)' },
      ] },
    ],
    citation: {
      section: '8',
      quote: '**Most companions** | Companions you hold at the end, from Cities or from Dungeons.',
    },
  },
  {
    id: 'quest-endgame-most-little',
    status: 'rule',
    eventKind: 'quest-endgame-score',
    zones: ['in-play quests'],
    trigger: 'At the end of the game.',
    effects: [
      { op: 'conditional', condition: 'exactly one player has the most Little Monsters defeated', then: [
        { op: 'move_token', token: 'the "Most Little Monsters" quest card', from: 'in-play quests', to: 'claimed (that player)' },
        { op: 'adjust_counter', counter: 'quest points', by: 1 },
      ], otherwise: [
        { op: 'set_counter', counter: 'the quest', to: 'no one gets the point (tie)' },
      ] },
    ],
    citation: {
      section: '8',
      quote: '**Most Little Monsters** | Little Monster cards you defeated, from icons and from Dungeons.',
    },
  },
  {
    id: 'quest-endgame-most-big',
    status: 'rule',
    eventKind: 'quest-endgame-score',
    zones: ['in-play quests'],
    trigger: 'At the end of the game.',
    effects: [
      { op: 'conditional', condition: 'exactly one player has the most Big Monsters defeated', then: [
        { op: 'move_token', token: 'the "Most Big Monsters" quest card', from: 'in-play quests', to: 'claimed (that player)' },
        { op: 'adjust_counter', counter: 'quest points', by: 1 },
      ], otherwise: [
        { op: 'set_counter', counter: 'the quest', to: 'no one gets the point (tie)' },
      ] },
    ],
    citation: {
      section: '8',
      quote: '**Most Big Monsters** | Big Monster cards you defeated, from icons and from Dungeons.',
    },
  },
  {
    id: 'quest-endgame-most-artifacts',
    status: 'rule',
    eventKind: 'quest-endgame-score',
    zones: ['artifact held', 'in-play quests'],
    trigger: 'At the end of the game.',
    effects: [
      { op: 'conditional', condition: 'exactly one player holds the most artifacts (the Star included)', then: [
        { op: 'move_token', token: 'the "Most artifacts" quest card', from: 'in-play quests', to: 'claimed (that player)' },
        { op: 'adjust_counter', counter: 'quest points', by: 1 },
      ], otherwise: [
        { op: 'set_counter', counter: 'the quest', to: 'no one gets the point (tie)' },
      ] },
    ],
    citation: {
      section: '8',
      quote: '**Most artifacts** | Artifact cards you hold at the end, the Star included.',
    },
  },
  {
    id: 'quest-points',
    status: 'rule',
    eventKind: 'quest-points',
    zones: ['in-play quests'],
    trigger: 'A quest is claimed (instant or end-of-game).',
    effects: [
      { op: 'adjust_counter', counter: 'quest points', by: 1 },
    ],
    citation: {
      section: '3',
      quote: 'Each quest you claim is worth **1 quest point**.',
    },
  },
];

// ---------------------------------------------------------------------------
// Entries — game end
// ---------------------------------------------------------------------------

const endEntries: Entry[] = [
  {
    id: 'game-end-trigger',
    status: 'rule',
    eventKind: 'game-end-trigger',
    zones: ['map tile stack', 'map (tiles/hexes/icons)'],
    trigger: 'The last map tile is placed (by exploring, a Dungeon Map card, or a forced explore).',
    effects: [
      { op: 'set_counter', counter: 'map tile stack size', to: 0 },
      { op: 'set_counter', counter: 'the game', to: 'ending sequence begins' },
    ],
    citation: {
      section: '9',
      quote: 'The game ends when the **last map tile is placed**, whether by exploring, by a',
    },
  },
  {
    id: 'game-end-sequence',
    status: 'rule',
    eventKind: 'game-end-sequence',
    zones: ['map (tiles/hexes/icons)', 'in-play quests'],
    trigger: 'The ending sequence is in progress.',
    effects: [
      { op: 'conditional', condition: 'the current round is finished and one more full round is played', then: [
        { op: 'game_end', winner: 'the player with the most quest points (ties share)', reason: 'the last map tile was placed' },
      ] },
    ],
    citation: {
      section: '9',
      quote: 'Finish the current round as normal.',
    },
  },
];

// ---------------------------------------------------------------------------
// Silent entries (the book is silent — a ruling is needed)
// ---------------------------------------------------------------------------

const silentEntries: Entry[] = [
  {
    id: 'gap-token-exhaustion',
    status: 'silent',
    eventKind: 'turn-explore',
    zones: ['player tokens', 'map (tiles/hexes/icons)'],
    situation: 'A player has no tokens left and must complete an icon or explore a tile.',
    rulingNeeded: 'Is a completion still legal (the token is a marker, not a cost) or does a player who cannot place a token fail to complete that icon / explore that tile?',
    citation: {
      section: '12',
      quote: 'The port should still handle a player with no tokens left, and ask the designer what happens if it ever comes up.',
    },
  },
  {
    id: 'gap-star-symbol',
    status: 'silent',
    eventKind: 'setup-artifact-supply',
    zones: ['artifact supply'],
    situation: 'The Star artifact and the Quest card backs both show a star in the placeholder art.',
    rulingNeeded: 'Confirm this is a final-art-only concern (the final art will use different symbols) and has no rules effect.',
    citation: {
      section: '12',
      quote: 'The Star artifact and the Quest card backs both show a star. The final art will need different symbols. This doesn\'t affect the rules.',
    },
  },
];

// ---------------------------------------------------------------------------
// Vague entries (the book supports two readings)
// ---------------------------------------------------------------------------

const vagueEntries: Entry[] = [];

// ---------------------------------------------------------------------------
// Not-applicable cells
// ---------------------------------------------------------------------------

const NA_REASONS: Record<string, string> = {
  'setup-shuffle-decks': 'Setup only touches the deck zones and the starting-tile zones; it does not move cards into held zones, the artifact supply, or the initiative tokens, and it does not resolve icons, quests, or the game-end sequence.',
  'setup-artifact-supply': 'Setup places the artifacts in the supply; it does not move standees, tokens, or initiative tokens, and it does not resolve icons, quests, or the game-end sequence.',
  'setup-standee-colour': 'Setup assigns standees and tokens; it does not shuffle decks, place the starting tile, or resolve icons/quests/game-end.',
  'setup-quest-draw': 'Setup draws the in-play quests; it does not move standees, tokens, or initiative tokens, and it does not resolve icons or the game-end sequence.',
  'setup-starting-tile': 'Setup places the starting tile; it does not move standees into held zones, the artifact supply, or the initiative tokens, and it does not resolve icons/quests/game-end.',
  'setup-standee-placement': 'Setup places the standees; it does not shuffle decks, move artifacts, or resolve icons/quests/game-end.',
  'setup-starting-stats': 'Setup sets the baseline stats; it does not move cards, tokens, or resolve icons/quests/game-end.',
  'round-roll-turn-order': 'The turn-order roll only touches the initiative tokens; it does not move standees, cards, or resolve icons/quests/game-end.',
  'round-take-turns': 'The take-turns step only advances the active-seat pointer; it does not move standees, cards, or resolve icons/quests/game-end (the turn mechanics are their own events).',
  'turn-move': 'A move only touches the standee and the map; it does not shuffle decks, move artifacts, or resolve quests/game-end (icon triggers are their own events).',
  'turn-stop': 'Stopping only ends the turn; it does not move cards, artifacts, or resolve icons/quests/game-end.',
  'turn-try-again': 'Staying to try again re-triggers the icon (its own event) and ends the turn; it does not move artifacts, the initiative tokens, or resolve quests/game-end.',
  'turn-explore': 'Exploring places a tile and a token; it does not move cards (companion/monster/dungeon), the artifacts, or the initiative tokens, and it does not resolve quests/game-end (the tile placement may feed a quest, but the quest-claim is its own event).',
  'turn-forced-explore': 'Forced explore places a tile and a token; it does not move cards, the artifacts, or the initiative tokens, and it does not resolve quests/game-end (the tile placement may feed a quest, but the quest-claim is its own event).',
  'icon-trigger': 'An icon trigger dispatches to a recruit/fight/dungeon/artifact event; it does not itself move cards between the held zones, the artifact supply, or the initiative tokens, and it does not resolve quests/game-end (the resolution is its own event).',
  'icon-complete': 'Completing an icon places a token on the hex; it does not move cards between the held zones, the artifact supply, or the initiative tokens, and it does not resolve quests/game-end (the completion may feed a quest, but the quest-claim is its own event).',
  'icon-fail': 'Failing an icon leaves it open; it does not move cards, artifacts, or the initiative tokens, and it does not resolve quests/game-end.',
  'city-recruit': 'A recruit moves a companion card between the deck and the held zone; it does not touch the monster decks, the dungeon deck, the artifacts, the initiative tokens, or the quests/game-end (the recruit may feed a quest, but the quest-claim is its own event).',
  'monster-fight': 'A fight moves a monster card between the deck and the held zone; it does not touch the companion deck, the dungeon deck, the artifacts, the initiative tokens, or the quests/game-end (the defeat may feed a quest, but the quest-claim is its own event).',
  'dungeon-draw': 'A Dungeon draw moves a Dungeon card to the resolve zone; it does not touch the companion/monster decks, the artifacts, the initiative tokens, or the quests/game-end (the resolution is its own event).',
  'dungeon-resolve': 'A Dungeon resolution dispatches to a recruit/fight/artifact/explore event; it does not itself move cards between the held zones, the artifact supply, or the initiative tokens, and it does not resolve quests/game-end (the resolution is its own event).',
  'dungeon-draw-again': 'The draw-again loop cycles Dungeon cards to the bottom and draws the next; it does not touch the companion/monster decks, the artifacts, the initiative tokens, or the quests/game-end (the resolution is its own event).',
  'dungeon-complete': 'Completing a Dungeon places a token on the hex; it does not move cards between the held zones, the artifact supply, or the initiative tokens, and it does not resolve quests/game-end (the completion may feed a quest, but the quest-claim is its own event).',
  'dungeon-fail': 'Failing a Dungeon leaves it open; it does not move cards, artifacts, or the initiative tokens, and it does not resolve quests/game-end.',
  'artifact-hex-take': 'An artifact-hex take moves an artifact to the held zone and a token to the hex; it does not touch the card decks, the initiative tokens, or the quests/game-end (the take may feed a quest, but the quest-claim is its own event).',
  'artifact-transfer': 'An artifact transfer moves an artifact between the supply and a held zone; it does not touch the card decks, the initiative tokens, or the quests/game-end (the take may feed a quest, but the quest-claim is its own event).',
  'artifact-star': 'Taking the Star moves it to the held zone; it does not touch the card decks, the initiative tokens, or the quests/game-end (the take may feed a quest, but the quest-claim is its own event).',
  'stat-compute': 'Computing a stat reads the companion bonuses; it does not move cards, tokens, or resolve icons/quests/game-end.',
  'quest-claim': 'A quest claim moves a quest card to the claimed zone and increments quest points; it does not move standees, the card decks, the artifacts, or the initiative tokens, and it does not resolve the game-end sequence (the claim feeds the quest-point total, which is read at game end).',
  'quest-endgame-score': 'An end-of-game quest score moves a quest card to the claimed zone and increments quest points; it does not move standees, the card decks, the artifacts, or the initiative tokens.',
  'quest-points': 'Quest points are a per-seat counter; they are not a zone the events above move tokens through.',
  'game-end-trigger': 'The end trigger sets the ending flag; it does not move standees, cards, or the initiative tokens (the end sequence is its own event).',
  'game-end-sequence': 'The end sequence runs the final round and scoring; it does not move standees, the card decks, the artifacts, or the initiative tokens (the scoring is its own event).',
};

const notApplicable: NotApplicableCell[] = [];
for (const eventKind of EVENTS) {
  const touched = new Set<string>();
  for (const entry of [...setupEntries, ...roundEntries, ...iconEntries, ...statEntries, ...questEntries, ...endEntries, ...silentEntries, ...vagueEntries]) {
    if (entry.eventKind === eventKind) for (const z of entry.zones) touched.add(z);
  }
  for (const zone of ZONES) {
    if (!touched.has(zone)) {
      notApplicable.push({ zone, eventKind, reason: NA_REASONS[eventKind] ?? 'No rule or recorded gap touches this zone under this event.' });
    }
  }
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

const encoding: GameRulesEncoding = {
  gameId: 'adventurer-olympics',
  rulesVersion: 'v1-2026-09-27',
  rulesFile: 'packages/adventurer-olympics/src/dev/verify/rules-v2-2026-09-30.txt',
  universe: {
    zones: [...ZONES],
    counters: COUNTERS,
    eventKinds: [...EVENTS],
  },
  entries: [
    ...setupEntries,
    ...roundEntries,
    ...iconEntries,
    ...statEntries,
    ...questEntries,
    ...endEntries,
    ...silentEntries,
    ...vagueEntries,
  ],
  notApplicable,
};

export default encoding;
