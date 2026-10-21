// Rules encoding for Cybernoir 2127, authored from the rulebook text ALONE
// (rules-pre-v2.3.txt, next to this file). No game-module knowledge used.
import type { EncodingEntry, GameRulesEncoding, NotApplicableCell } from '@zekel/dev/verify/types';

// ---------------------------------------------------------------------------
// Universe
// ---------------------------------------------------------------------------

const ZONES = [
  'location deck',
  'detective hand',
  'board',
  'location discard pile',
  'safehouse',
  'contacts deck',
  'hacker hand',
  'hacker discard pile',
  'evidence area',
  'poi deck',
  'informant area',
  'jail track',
  'clue supply',
  'clue display',
] as const;
type ZoneName = (typeof ZONES)[number];

const EVENTS = [
  'setup',
  'detective-mandatory-draw',
  'detective-mandatory-play',
  'informant-upkeep',
  'make-arrest',
  'recruit-informant',
  'extra-location-draw',
  'mid-game-guess',
  'buy-clue',
  'jail-advance',
  'draw-contact',
  'play-person',
  'play-evidence',
  'play-motive-set',
  'win-back-contact',
  'jailbreak',
  'overclock',
  'burn-the-safehouse',
  'informant-block',
  'gain-clue',
  'give-negative-clue',
  'contacts-reshuffle',
  'ability-draw-contacts',
  'ability-force-hand-discard',
  'ability-board-discard',
  'ability-reveal-informant',
  'ability-retrieve-discard',
  'anansi-removal',
  'iceden-rider',
  'endgame-evidence-complete',
  'endgame-deck-exhausted',
  'final-guess',
] as const;
type EventKind = (typeof EVENTS)[number];

const COUNTERS = [
  'detective action points',
  'hacker action points',
  'informant count',
  'jail slot position',
  'truthful clue categories revealed',
  'negative clues declared',
  'mid-game guess remaining',
  'burn the safehouse remaining',
  'overclock uses this turn',
  'location card population',
  'person play cost',
  'witness evidence played',
  'motive sets completed',
  'evidence pieces complete',
  'detective hand size',
  'hacker hand size',
  'location deck size',
];

// Entries are typed against the universe so a typo'd zone or event kind fails
// typecheck instead of silently punching a hole in coverage.
type Entry = EncodingEntry & { eventKind: EventKind; zones: ZoneName[] };

// ---------------------------------------------------------------------------
// Entries — setup and turn order
// ---------------------------------------------------------------------------

const setupEntries: Entry[] = [
  {
    id: 'setup-choose-hideout',
    status: 'rule',
    eventKind: 'setup',
    zones: ['location deck', 'safehouse'],
    trigger: 'At setup, before any turn is taken.',
    effects: [
      {
        op: 'player_choice',
        chooser: 'Hacker',
        choiceOf: 'one of the 18 locations as the secret hideout',
        then: [
          { op: 'move_token', token: 'the chosen Location card', from: 'location deck', to: 'safehouse' },
          { op: 'set_counter', counter: 'location deck size', to: 17 },
        ],
      },
    ],
    citation: {
      section: '4',
      quote:
        'The Hacker secretly chooses their hideout from the 18 locations, and takes that Location card out of the Location deck',
    },
  },
  {
    id: 'setup-hideout-attributes',
    status: 'rule',
    eventKind: 'setup',
    zones: ['safehouse', 'clue supply'],
    trigger: 'The hideout is chosen; its card defines what the Clue tokens can reveal.',
    effects: [
      {
        op: 'set_counter',
        counter: 'truthful clue categories revealed',
        to: 0,
      },
    ],
    citation: {
      section: '3',
      quote: "The Hacker's hideout is defined by three attributes, each matching a Clue token type",
    },
    notes: 'The three attributes are Borough (3 values), Population (0-3), Affiliation (6 values).',
  },
  {
    id: 'setup-gather-residents',
    status: 'rule',
    eventKind: 'setup',
    zones: ['contacts deck', 'hacker hand'],
    trigger: 'Immediately after the hideout is chosen.',
    effects: [
      {
        op: 'move_token',
        token: 'the Contacts cards of the people resident at the hideout (0-3 cards)',
        from: 'contacts deck',
        to: 'hacker hand',
      },
    ],
    citation: {
      section: '4',
      quote:
        'The Hacker secretly gathers the Contacts cards for the people resident at that location (0–3 cards).',
    },
  },
  {
    id: 'setup-etiquette-search',
    status: 'rule',
    eventKind: 'setup',
    zones: ['contacts deck'],
    trigger: 'While gathering resident Contacts, even when the hideout has population 0.',
    effects: [],
    citation: {
      section: '4',
      quote:
        'always go through the motions of searching the Contacts deck, even if your location has population 0',
    },
    notes: 'Pure information-hygiene rule: the search motion happens regardless, so hand assembly leaks nothing.',
  },
  {
    id: 'setup-hacker-draw-to-3',
    status: 'rule',
    eventKind: 'setup',
    zones: ['contacts deck', 'hacker hand'],
    trigger: 'After gathering resident Contacts. The remaining Contacts deck (including the Weapon) is shuffled.',
    effects: [
      { op: 'draw', from: 'contacts deck', to: 'hacker hand', count: 'until the Hacker holds 3 cards total' },
    ],
    citation: {
      section: '4',
      quote: 'draws until they hold 3 cards total (residents + random draws)',
    },
  },
  {
    id: 'setup-detective-draw-3',
    status: 'rule',
    eventKind: 'setup',
    zones: ['location deck', 'detective hand'],
    trigger: 'At setup, after the Hacker has removed the safehouse card.',
    effects: [{ op: 'draw', from: 'location deck', to: 'detective hand', count: 3 }],
    citation: { section: '4', quote: 'The Detective shuffles the Location deck and draws 3' },
  },
  {
    id: 'setup-detective-poi',
    status: 'rule',
    eventKind: 'setup',
    zones: ['poi deck'],
    trigger: 'At setup.',
    effects: [],
    citation: {
      section: '4',
      quote: 'The Detective takes the POI deck for designating informants and tracking arrests.',
    },
    notes: 'The POI deck stays hidden and facedown for the whole game (section 6).',
  },
  {
    id: 'setup-turn-order',
    status: 'rule',
    eventKind: 'setup',
    zones: [],
    trigger: 'When play begins.',
    effects: [],
    citation: { section: '5', quote: 'The Detective always goes first. Players alternate turns.' },
  },
  {
    id: 'setup-action-points',
    status: 'rule',
    eventKind: 'setup',
    zones: [],
    trigger: 'Each turn, the active player receives their action point allotment.',
    effects: [
      { op: 'set_counter', counter: 'detective action points', to: '4 on each Detective turn' },
      { op: 'set_counter', counter: 'hacker action points', to: '3 on each Hacker turn' },
    ],
    citation: { section: '2', quote: 'Detective has 4 AP, Hacker has 3 AP' },
  },
  {
    id: 'vague-component-counts',
    status: 'vague',
    eventKind: 'setup',
    zones: ['location deck', 'contacts deck', 'poi deck'],
    situation:
      'How many Locations and People exist? The components table says 19 Location cards (7 in Boonies) and lists 25 People (8.1 heading, Anansi included; Little Ghana included in 8.2), but 2.1 says "18 Locations (6 per borough)" and "24 People", 4 says the hideout is chosen "from the 18 locations" and the deck "is therefore 17 cards", 5.3 says "The deck starts at 17", the 8.2 balance check says populations sum to 24, and the playtest mapping (10) has only 24 people and 18 locations.',
    readings: [
      'The v2.0 additions (Anansi the Spider, Little Ghana) are in: 19 Locations and 25 People, so the Location deck after setup is 18 cards, and every "18 locations"/"24 People"/"17 cards" sentence is stale text.',
      'The stated counts 18/24/17 are normative and the v2.0 additions replace something or are optional, so the component table and 8.x lists are wrong.',
    ],
    citation: { section: '2.1', quote: '18 Locations (6 per borough)' },
    notes:
      'Internal contradiction, not just vagueness: 19 vs 18 locations, 25 vs 24 people, deck 18 vs 17. Everything downstream (guess space, deck timer) depends on the answer.',
  },
];

// ---------------------------------------------------------------------------
// Entries — Detective's turn
// ---------------------------------------------------------------------------

const detectiveEntries: Entry[] = [
  {
    id: 'det-mandatory-draw',
    status: 'rule',
    eventKind: 'detective-mandatory-draw',
    zones: ['location deck', 'detective hand'],
    trigger: "Start of every Detective turn, first mandatory step.",
    effects: [
      {
        op: 'conditional',
        condition: 'the Location deck has at least 1 card',
        then: [{ op: 'draw', from: 'location deck', to: 'detective hand', count: 1 }],
        otherwise: [
          { op: 'set_counter', counter: 'location deck size', to: 0 },
        ],
      },
    ],
    citation: {
      section: '5.1',
      quote:
        'Draw a Location card. (Free, mandatory. The Location deck does not reshuffle — if you cannot draw, the endgame triggers: see §5.3.)',
    },
    notes: 'The failed-draw branch hands off to the endgame-deck-exhausted event.',
  },
  {
    id: 'det-deck-never-reshuffles',
    status: 'rule',
    eventKind: 'detective-mandatory-draw',
    zones: ['location deck', 'location discard pile'],
    trigger: 'Whenever the Location deck empties for any reason.',
    effects: [],
    citation: {
      section: '5.3',
      quote:
        'The deck never reshuffles, so every board discard, forced hand discard, bought Clue, and Overclock draw quietly shortens the game',
    },
    notes: 'The single exception is Burn the Safehouse (5.2a), which folds the discard pile back in.',
  },
  {
    id: 'silent-detective-hand-limit',
    status: 'silent',
    eventKind: 'detective-mandatory-draw',
    zones: ['detective hand'],
    situation:
      'The Detective buys extra draws or receives Overclock draws over several turns and their hand grows large. The book states "There is no hand limit for the Hacker" but never says whether the Detective has a hand limit.',
    rulingNeeded: 'Is the Detective hand also unlimited, or is there a cap with a forced discard?',
    citation: { section: '5.2a', quote: 'There is no hand limit for the Hacker.' },
  },
  {
    id: 'det-mandatory-play',
    status: 'rule',
    eventKind: 'detective-mandatory-play',
    zones: ['detective hand', 'board'],
    trigger: 'Start of every Detective turn, second mandatory step, immediately after the mandatory draw.',
    effects: [
      {
        op: 'player_choice',
        chooser: 'Detective',
        choiceOf: 'one Location card from hand',
        then: [{ op: 'move_token', token: 'the chosen Location card', from: 'detective hand', to: 'board' }],
      },
    ],
    citation: { section: '5.1', quote: 'Play 1 Location card face up to the board.' },
    notes:
      'Because the draw precedes the play, the Detective always has a card to play — except on the deck-exhausted turn (see silent-exhausted-turn-mandatory-play).',
  },
  {
    id: 'det-board-never-hideout',
    status: 'rule',
    eventKind: 'detective-mandatory-play',
    zones: ['board', 'safehouse'],
    trigger: 'Whenever a Location card is face up on the board.',
    effects: [],
    citation: { section: '4', quote: 'a face-up Location on the board can never be the hideout' },
    notes: 'Deduction consequence of the safehouse card being out of the deck; stated explicitly by the book.',
  },
  {
    id: 'det-informant-upkeep',
    status: 'rule',
    eventKind: 'informant-upkeep',
    zones: ['informant area', 'poi deck'],
    trigger: 'Every Detective turn, after the mandatory draw and play, for each informant recruited on a previous turn.',
    effects: [
      {
        op: 'player_choice',
        chooser: 'Detective',
        choiceOf: 'for each informant: pay 1 AP or release it',
        then: [
          {
            op: 'conditional',
            condition: 'the Detective pays 1 AP for this informant',
            then: [{ op: 'adjust_counter', counter: 'detective action points', by: -1 }],
            otherwise: [
              { op: 'move_token', token: 'the unpaid informant POI card', from: 'informant area', to: 'poi deck' },
            ],
          },
        ],
      },
    ],
    citation: {
      section: '5.1',
      quote:
        "pay 1 AP per informant you have from previous turns. Any informant you don't pay for is released (returned facedown to your hidden POI deck).",
    },
  },
  {
    id: 'det-upkeep-timing',
    status: 'rule',
    eventKind: 'informant-upkeep',
    zones: ['informant area'],
    trigger: 'Each Detective turn after the informant was recruited.',
    effects: [],
    citation: {
      section: '6',
      quote:
        'every informant costs 1 AP upkeep (paid after the mandatory location draw and play) or must be released.',
    },
  },
  {
    id: 'det-release-by-declining',
    status: 'rule',
    eventKind: 'informant-upkeep',
    zones: ['informant area', 'poi deck'],
    trigger: 'During upkeep, the Detective declines to pay for any informant, revealed or facedown.',
    effects: [
      { op: 'move_token', token: 'the released informant POI card', from: 'informant area', to: 'poi deck' },
    ],
    citation: {
      section: '6',
      quote: 'The Detective may release any informant (revealed or not) on their turn by declining upkeep.',
    },
  },
  {
    id: 'poi-deck-privacy',
    status: 'rule',
    eventKind: 'informant-upkeep',
    zones: ['poi deck', 'informant area', 'jail track'],
    trigger: 'Whenever a person is released from the informant area or the jail track.',
    effects: [
      { op: 'move_token', token: 'the released POI card', from: 'informant area', to: 'poi deck' },
    ],
    citation: {
      section: '6',
      quote:
        'POI cards only leave it to become informants or to sit on the jail track; whenever a person is released from either, their card goes back facedown into the hidden deck.',
    },
    notes:
      'The Hacker only knows where a person was last seen; a released card vanishes back into the hidden deck.',
  },
  {
    id: 'det-make-arrest',
    status: 'rule',
    eventKind: 'make-arrest',
    zones: ['board', 'poi deck', 'jail track'],
    trigger: 'Detective spends 1 AP; target is any person at a face-up location on the board.',
    effects: [
      { op: 'adjust_counter', counter: 'detective action points', by: -1 },
      { op: 'move_token', token: "the arrested person's POI card", from: 'poi deck', to: 'jail track' },
      { op: 'set_counter', counter: 'jail slot position', to: '1 (Booked)' },
    ],
    citation: {
      section: '5.1',
      quote:
        "Make an Arrest — target any person at a face-up location you have played. Place the matching POI card on Booked (slot 1) of the jail track: that person can't be played or used as evidence while jailed.",
    },
  },
  {
    id: 'arrest-evidence-safe',
    status: 'rule',
    eventKind: 'make-arrest',
    zones: ['evidence area'],
    trigger: 'Detective attempts to arrest a person whose card was played as Evidence.',
    effects: [],
    citation: {
      section: '9',
      quote: "Played Evidence is safe: it can't be arrested and can't be an informant.",
    },
    notes: 'The arrest is not available against played Evidence.',
  },
  {
    id: 'arrest-weapon-impossible',
    status: 'rule',
    eventKind: 'make-arrest',
    zones: ['evidence area'],
    trigger: 'The Weapon is never a legal arrest target.',
    effects: [],
    citation: {
      section: '7',
      quote:
        'The Weapon has no POI copy, so it can never be an informant, never be blocked, and never be arrested.',
    },
  },
  {
    id: 'silent-arrest-informant',
    status: 'silent',
    eventKind: 'make-arrest',
    zones: ['informant area', 'jail track'],
    situation:
      "The Detective wants to arrest a person whose POI card is currently in the informant area (facedown or revealed). The arrest rule says to place 'the matching POI card' on the jail track, but that card is not in the POI deck — it is serving as an informant.",
    rulingNeeded:
      'Is arresting a current informant legal? If so, does the informant state end (card moves to jail), and does this cost only the 1 AP arrest?',
    citation: {
      section: '5.1',
      quote: 'Place the matching POI card on Booked (slot 1) of the jail track',
    },
  },
  {
    id: 'silent-arrest-slot-occupied',
    status: 'silent',
    eventKind: 'make-arrest',
    zones: ['jail track'],
    situation:
      'The Detective makes two or more arrests in the same turn. Jail cards only advance at end of turn, so every arrest that turn goes to slot 1 (Booked) while it may already hold a card.',
    rulingNeeded:
      'Can a jail slot hold multiple cards at once, or is there a per-slot (or per-track) capacity limiting arrests?',
    citation: {
      section: '2',
      quote: "A track with 3 slots; arrested people's cards sit here and advance one slot per Detective turn",
    },
  },
  {
    id: 'det-recruit-informant',
    status: 'rule',
    eventKind: 'recruit-informant',
    zones: ['poi deck', 'informant area'],
    trigger: 'Detective spends 3 AP; target is any person.',
    effects: [
      { op: 'adjust_counter', counter: 'detective action points', by: -3 },
      { op: 'move_token', token: "the person's POI card, facedown", from: 'poi deck', to: 'informant area' },
      { op: 'adjust_counter', counter: 'informant count', by: 1 },
    ],
    citation: {
      section: '5.1',
      quote:
        'Recruit Informant — target any person: place their POI card facedown as an informant. (It will require upkeep starting next turn)',
    },
  },
  {
    id: 'recruit-evidence-safe',
    status: 'rule',
    eventKind: 'recruit-informant',
    zones: ['evidence area'],
    trigger: 'Detective attempts to recruit a person whose card was played as Evidence.',
    effects: [],
    citation: {
      section: '5.2',
      quote: 'Evidence cards, once played, cannot be arrested or turned into informants',
    },
  },
  {
    id: 'silent-recruit-jailed',
    status: 'silent',
    eventKind: 'recruit-informant',
    zones: ['jail track', 'informant area'],
    situation:
      "The Detective wants to recruit a person whose POI card currently sits on the jail track. 'Target any person' has no stated exception for jailed people, but the POI card is not in the deck to be placed facedown.",
    rulingNeeded:
      'Can a jailed person be recruited as an informant? If so, does the card leave the jail track immediately?',
    citation: { section: '5.1', quote: 'Recruit Informant — target any person' },
  },
  {
    id: 'det-extra-draw',
    status: 'rule',
    eventKind: 'extra-location-draw',
    zones: ['location deck', 'detective hand'],
    trigger: 'Detective spends 4 AP.',
    effects: [
      { op: 'adjust_counter', counter: 'detective action points', by: -4 },
      { op: 'draw', from: 'location deck', to: 'detective hand', count: 1 },
    ],
    citation: { section: '5.1', quote: 'Draw an extra Location card' },
  },
  {
    id: 'silent-extra-draw-empty-deck',
    status: 'silent',
    eventKind: 'extra-location-draw',
    zones: ['location deck'],
    situation:
      'The Detective pays 4 AP for an extra Location draw while the Location deck is empty. The endgame trigger (5.3) is worded only for the mandatory start-of-turn draw.',
    rulingNeeded:
      'Is the purchase illegal with an empty deck, wasted, or does an impossible bought draw also trigger the endgame?',
    citation: {
      section: '5.3',
      quote: 'if the Detective cannot make their mandatory start-of-turn draw, the city has gone cold.',
    },
  },
  {
    id: 'det-midgame-guess',
    status: 'rule',
    eventKind: 'mid-game-guess',
    zones: ['safehouse'],
    trigger: 'Detective spends 4 AP and has not used the mid-game guess before.',
    effects: [
      { op: 'adjust_counter', counter: 'detective action points', by: -4 },
      { op: 'set_counter', counter: 'mid-game guess remaining', to: 0 },
      {
        op: 'conditional',
        condition: 'the named location matches the safehouse card',
        then: [{ op: 'game_end', winner: 'Detective', reason: 'correct mid-game location guess' }],
        otherwise: [],
      },
    ],
    citation: {
      section: '5.1',
      quote:
        "Guess the Hacker's Location — you get exactly one mid-game chance. Correct = you win. Wrong = play continues, but your guess is spent; your only remaining shot is the endgame guess (§5.3)",
    },
  },
  {
    id: 'silent-guess-verification',
    status: 'silent',
    eventKind: 'mid-game-guess',
    zones: ['safehouse'],
    situation:
      'The Detective names a location for the mid-game guess. The book never says how correctness is verified (does the Hacker reveal the facedown safehouse card on a correct guess, or merely answer yes/no on any guess?).',
    rulingNeeded:
      'What is the verification procedure for a guess, and is the safehouse card shown on a wrong guess (it should not be) or on a correct one (it must be, to prove the win)?',
    citation: { section: '5.1', quote: 'Correct = you win. Wrong = play continues' },
  },
  {
    id: 'det-buy-clue',
    status: 'rule',
    eventKind: 'buy-clue',
    zones: ['detective hand', 'location discard pile', 'clue supply', 'clue display'],
    trigger: 'Detective discards 4 Location cards from hand (see vague-buy-clue-cost: 9 says 3).',
    effects: [
      {
        op: 'move_token',
        token: '4 Location cards (per the 5.1 table)',
        from: 'detective hand',
        to: 'location discard pile',
      },
    ],
    citation: { section: '5.1', quote: 'Gain a Clue — Hacker chooses which category.' },
    notes: 'The gained Clue resolves via the gain-clue event (Hacker picks the category, 3).',
  },
  {
    id: 'vague-buy-clue-cost',
    status: 'vague',
    eventKind: 'buy-clue',
    zones: ['detective hand', 'location discard pile'],
    situation:
      'What does a bought Clue cost? The 5.1 action table prices it at "Discard 4 Locations" (and the hand-economy note "draw-1/play-1 leaves 3 spares, so a purchase needs the extra-draw action" is consistent with 4), but 9 calls the same purchase "Discard 3 Locations for a Clue".',
    readings: [
      'The cost is 4 Locations, as the 5.1 action table states; the "3" in section 9 is stale.',
      'The cost is 3 Locations, as section 9 states (which would let the 3 spare cards buy a Clue without the extra-draw action, contradicting the hand-economy note).',
    ],
    citation: { section: '9', quote: 'Discard 3 Locations for a Clue' },
    notes: 'Internal contradiction between the 5.1 table and section 9.',
  },
  {
    id: 'det-empty-hand-legal',
    status: 'rule',
    eventKind: 'buy-clue',
    zones: ['detective hand'],
    trigger: 'Buying a Clue empties (or nearly empties) the Detective hand.',
    effects: [],
    citation: { section: '9', quote: 'Empty Detective hand is legal — and never blocks play.' },
  },
  {
    id: 'det-hand-no-other-function',
    status: 'rule',
    eventKind: 'buy-clue',
    zones: ['detective hand'],
    trigger: 'Always: Location cards in the Detective hand only serve the mandatory play and the Clue purchase.',
    effects: [],
    citation: { section: '9', quote: 'Location cards in hand have no other mechanical function.' },
  },
  {
    id: 'det-jail-advance',
    status: 'rule',
    eventKind: 'jail-advance',
    zones: ['jail track', 'poi deck'],
    trigger: 'End of every Detective turn.',
    effects: [
      { op: 'advance_track', track: 'jail track (every card on it)', by: 1 },
      {
        op: 'conditional',
        condition: 'a card advances off the third slot',
        then: [
          { op: 'move_token', token: 'the released POI card, facedown', from: 'jail track', to: 'poi deck' },
        ],
      },
    ],
    citation: {
      section: '5.1',
      quote:
        'advance each card on the jail track one slot. A card advancing off the third slot is released — the POI card returns facedown into the hidden POI deck, and that person may be played again.',
    },
  },
  {
    id: 'silent-ap-carryover',
    status: 'silent',
    eventKind: 'jail-advance',
    zones: [],
    situation:
      'A player ends their turn with unspent AP. The book states the per-turn allotments (4 and 3) and one way to gain more (Overclock, "+1 AP this turn") but never says whether unspent AP are lost at end of turn.',
    rulingNeeded: 'Do unspent action points carry over between turns, or are they lost?',
    citation: { section: '2', quote: 'Detective has 4 AP, Hacker has 3 AP' },
  },
];

// ---------------------------------------------------------------------------
// Entries — Hacker's turn
// ---------------------------------------------------------------------------

const hackerEntries: Entry[] = [
  {
    id: 'hacker-draw-contact',
    status: 'rule',
    eventKind: 'draw-contact',
    zones: ['contacts deck', 'hacker hand'],
    trigger: 'Hacker spends 1 AP.',
    effects: [
      { op: 'adjust_counter', counter: 'hacker action points', by: -1 },
      { op: 'draw', from: 'contacts deck', to: 'hacker hand', count: 1 },
    ],
    citation: { section: '5.2', quote: 'Draw a Contact' },
  },
  {
    id: 'hacker-no-hand-limit',
    status: 'rule',
    eventKind: 'draw-contact',
    zones: ['hacker hand'],
    trigger: 'Always.',
    effects: [],
    citation: { section: '5.2a', quote: 'There is no hand limit for the Hacker.' },
  },
  {
    id: 'silent-draw-nothing-left',
    status: 'silent',
    eventKind: 'draw-contact',
    zones: ['contacts deck', 'hacker discard pile'],
    situation:
      'The Hacker pays 1 AP to draw while the Contacts deck AND the Hacker discard pile are both empty (every card is in hand, on the table as Evidence, jailed as blocked plays, etc.). The reshuffle rule needs a discard pile to reshuffle.',
    rulingNeeded: 'Is the draw action illegal in this state, or is the AP spent for nothing?',
    citation: {
      section: '5.2a',
      quote: 'if the Contacts deck runs out, reshuffle the discard pile into a new deck.',
    },
  },
  {
    id: 'contacts-reshuffle',
    status: 'rule',
    eventKind: 'contacts-reshuffle',
    zones: ['contacts deck', 'hacker discard pile'],
    trigger: 'The Contacts deck runs out while a draw is owed.',
    effects: [
      { op: 'move_token', token: 'the whole Hacker discard pile, shuffled', from: 'hacker discard pile', to: 'contacts deck' },
    ],
    citation: {
      section: '5.2a',
      quote: 'if the Contacts deck runs out, reshuffle the discard pile into a new deck.',
    },
  },
  {
    id: 'hacker-play-person',
    status: 'rule',
    eventKind: 'play-person',
    zones: ['hacker hand', 'hacker discard pile'],
    trigger: "Hacker pays the person's printed play cost in AP.",
    effects: [
      { op: 'adjust_counter', counter: 'hacker action points', by: 'minus the printed play cost' },
      {
        op: 'conditional',
        condition: 'the play is not blocked by an informant (see informant-block)',
        then: [
          { op: 'move_token', token: 'the played person card (after resolving its ability)', from: 'hacker hand', to: 'hacker discard pile' },
        ],
      },
    ],
    citation: {
      section: '5.2',
      quote: 'Play a Person — use their ability, then place the card in your discard pile.',
    },
  },
  {
    id: 'jailed-person-cannot-be-played',
    status: 'rule',
    eventKind: 'play-person',
    zones: ['jail track', 'hacker hand'],
    trigger: "The Hacker attempts to play a person whose POI card is on the jail track.",
    effects: [],
    citation: {
      section: '5.1',
      quote: "that person can't be played or used as evidence while jailed",
    },
    notes: 'The play is simply unavailable — this is not an informant block and earns no Clue.',
  },
  {
    id: 'anansi-as-plain-person',
    status: 'rule',
    eventKind: 'play-person',
    zones: ['hacker hand', 'hacker discard pile'],
    trigger: 'The Hacker plays Anansi the Spider as a person (not as Evidence).',
    effects: [],
    citation: { section: '8.1', quote: 'Played as a person he is a plain witness' },
  },
  {
    id: 'silent-witness-played-as-person',
    status: 'silent',
    eventKind: 'play-person',
    zones: ['hacker hand', 'hacker discard pile'],
    situation:
      'The Hacker wants to play a Witness (a None person) as a person, for its "ability". Witnesses show no printed play cost and no ability in the card list — the Win Back action has to special-case them ("Witnesses: X") precisely because they lack a printed cost.',
    rulingNeeded:
      'Can a Witness be played as a person at all? If so, at what cost, and with what effect (a pure discard)?',
    citation: { section: '5.2', quote: 'Printed play cost (Witnesses: X)' },
  },
  {
    id: 'vague-play-into-revealed-informant',
    status: 'vague',
    eventKind: 'play-person',
    zones: ['informant area', 'hacker hand'],
    situation:
      'The Hacker plays (as person or Evidence) a card matching a REVEALED informant. The informant check in 5.2 is worded for facedown informants; for revealed ones the book only says the informant "continues to block that person".',
    readings: [
      'The play is simply illegal/unavailable while the revealed informant is in play — no AP is spent, no new Clue is earned.',
      'The play may be attempted and is automatically blocked: the Detective earns a Clue, the AP is lost, and the card returns to hand, exactly like a facedown block, every time.',
    ],
    citation: {
      section: '6',
      quote:
        'A revealed informant stays in play face up — it continues to block that person and still requires upkeep.',
    },
  },
  {
    id: 'informant-block-check',
    status: 'rule',
    eventKind: 'informant-block',
    zones: ['informant area', 'hacker hand', 'clue supply', 'clue display'],
    trigger:
      'The Hacker plays a person (for an ability or as Evidence) whose card matches a facedown informant; the Detective chooses to reveal it.',
    effects: [
      { op: 'move_token', token: 'the matching informant POI card, flipped face up', from: 'informant area', to: 'informant area' },
      { op: 'move_token', token: 'one Clue token (category chosen by the Hacker)', from: 'clue supply', to: 'clue display' },
      { op: 'move_token', token: 'the blocked card', from: 'hacker hand', to: 'hacker hand' },
    ],
    citation: {
      section: '5.2',
      quote:
        "if the played card matches a facedown informant, the Detective may reveal it to block the play. If blocked, the Detective gains a Clue (Hacker chooses which), the AP spent is lost, and the blocked card returns to the Hacker's hand",
    },
    notes:
      'The AP spent on the blocked play is lost. Revealing is optional ("may") — the Detective can let a play pass to keep the informant hidden.',
  },
  {
    id: 'revealed-informant-stays',
    status: 'rule',
    eventKind: 'informant-block',
    zones: ['informant area'],
    trigger: 'After a block, the revealed informant remains in play.',
    effects: [],
    citation: {
      section: '6',
      quote:
        'A revealed informant stays in play face up — it continues to block that person and still requires upkeep.',
    },
  },
  {
    id: 'people-are-unique',
    status: 'rule',
    eventKind: 'informant-block',
    zones: [],
    trigger: 'Whenever a Contact is matched against a POI card (blocks, win-backs, arrests).',
    effects: [],
    citation: {
      section: '9',
      quote: 'People are unique individuals. Contact/POI matching works by card identity',
    },
  },
  {
    id: 'hacker-play-evidence',
    status: 'rule',
    eventKind: 'play-evidence',
    zones: ['hacker hand', 'evidence area'],
    trigger: 'Hacker plays a card as Evidence. Free (no AP).',
    effects: [
      {
        op: 'conditional',
        condition: 'the play is not blocked by an informant',
        then: [{ op: 'move_token', token: 'the Evidence card, face up', from: 'hacker hand', to: 'evidence area' }],
      },
    ],
    citation: {
      section: '5.2',
      quote:
        'Play Evidence — the card stays face up on the table permanently. Same informant check and penalty as above. Evidence cards, once played, cannot be arrested or turned into informants',
    },
  },
  {
    id: 'evidence-stays-forever',
    status: 'rule',
    eventKind: 'play-evidence',
    zones: ['evidence area'],
    trigger: 'Once an Evidence card lands.',
    effects: [],
    citation: { section: '5.2a', quote: 'A card played as Evidence stays on the table for the rest of the game.' },
  },
  {
    id: 'weapon-evidence',
    status: 'rule',
    eventKind: 'play-evidence',
    zones: ['hacker hand', 'evidence area'],
    trigger: 'Hacker plays the Weapon as Evidence (free, unblockable).',
    effects: [
      { op: 'move_token', token: 'the Weapon card', from: 'hacker hand', to: 'evidence area' },
      { op: 'adjust_counter', counter: 'evidence pieces complete', by: 1 },
    ],
    citation: {
      section: '7',
      quote:
        'The Weapon has no POI copy, so it can never be an informant, never be blocked, and never be arrested.',
    },
  },
  {
    id: 'witness-evidence-requirement',
    status: 'rule',
    eventKind: 'play-evidence',
    zones: ['evidence area'],
    trigger: 'The Witnesses Evidence piece is complete when 3 Witness cards have been played as Evidence.',
    effects: [{ op: 'adjust_counter', counter: 'witness evidence played', by: 1 }],
    citation: { section: '7', quote: 'reveal/play 3 Witness cards' },
    notes: 'All 7 None-affiliation people are Witnesses; any 3 of them serve.',
  },
  {
    id: 'no-double-counting',
    status: 'rule',
    eventKind: 'play-evidence',
    zones: ['evidence area'],
    trigger: 'Whenever a played card could satisfy more than one Evidence requirement.',
    effects: [],
    citation: {
      section: '7',
      quote: 'No double-counting: a card counts toward exactly one piece of Evidence.',
    },
  },
  {
    id: 'silent-surplus-evidence',
    status: 'silent',
    eventKind: 'play-evidence',
    zones: ['evidence area'],
    situation:
      'The Hacker plays a card as Evidence that satisfies no open requirement — a 4th Witness, or a lone gang/corp person outside any Motive set (since v2.1, Motive cards only enter as complete trios). Evidence status would make the card permanently safe from arrest and informants, which is strategically real.',
    rulingNeeded:
      'Is "Play Evidence" restricted to cards that currently satisfy an Evidence requirement, or can any card be parked face up as (useless but safe) Evidence?',
    citation: { section: '5.2', quote: 'Play Evidence — the card stays face up on the table permanently.' },
  },
  {
    id: 'motive-set-composition',
    status: 'rule',
    eventKind: 'play-motive-set',
    zones: ['hacker hand', 'evidence area'],
    trigger: 'Hacker plays a Motive set: 3 cards at once.',
    effects: [
      {
        op: 'conditional',
        condition:
          'the 3 people are unique, of 3 different affiliations, at most one gang among them, and the affiliation trio differs from every set already played',
        then: [
          { op: 'move_token', token: 'the 3 set cards, face up', from: 'hacker hand', to: 'evidence area' },
          { op: 'adjust_counter', counter: 'motive sets completed', by: 1 },
        ],
      },
    ],
    citation: {
      section: '7',
      quote:
        'Each set holds 3 unique people from 3 DIFFERENT affiliations — any affiliations, including None (Witnesses), with at most ONE gang per set, and no two sets may use the same three affiliations',
    },
    notes: 'The Motive Evidence piece is complete at 3 played sets.',
  },
  {
    id: 'motive-complete-trio-only',
    status: 'rule',
    eventKind: 'play-motive-set',
    zones: ['hacker hand', 'evidence area'],
    trigger: 'Always: Motive cards never enter play one at a time.',
    effects: [],
    citation: {
      section: '7',
      quote: 'a set is played as a COMPLETE trio — all 3 cards at once, in a single action.',
    },
  },
  {
    id: 'motive-sets-any-order',
    status: 'rule',
    eventKind: 'play-motive-set',
    zones: ['evidence area'],
    trigger: 'Across the game, the 3 sets may come in any order.',
    effects: [],
    citation: { section: '7', quote: 'Completed sets may be played in any order.' },
  },
  {
    id: 'motive-set-informant-checks',
    status: 'rule',
    eventKind: 'play-motive-set',
    zones: ['informant area', 'hacker hand', 'clue supply', 'clue display'],
    trigger: 'A Motive set is declared; each card is checked against facedown informants in declared order.',
    effects: [
      {
        op: 'conditional',
        condition: 'the Detective accepts a block on any one card of the set',
        then: [
          { op: 'move_token', token: 'the whole set (all 3 cards)', from: 'hacker hand', to: 'hacker hand' },
          { op: 'move_token', token: 'one Clue token (category chosen by the Hacker)', from: 'clue supply', to: 'clue display' },
        ],
      },
    ],
    citation: {
      section: '7',
      quote:
        "Each card of the set gets the informant check (§5.2/§6), in declared order — ONE accepted block bounces the WHOLE set back to the Hacker's hand",
    },
    notes: 'Declining every check lets the set land. One block = one Clue; checking stops at the first accepted block.',
  },
  {
    id: 'jailed-person-not-in-set',
    status: 'rule',
    eventKind: 'play-motive-set',
    zones: ['jail track'],
    trigger: 'A jailed person cannot be part of a played Motive set (Evidence).',
    effects: [],
    citation: { section: '5.1', quote: "that person can't be played or used as evidence while jailed" },
  },
  {
    id: 'hacker-win-back',
    status: 'rule',
    eventKind: 'win-back-contact',
    zones: ['hacker hand', 'hacker discard pile', 'informant area', 'poi deck'],
    trigger: "Hacker pays the Contact's printed play cost (Witnesses: 1 AP) and plays the Contact matching a REVEALED informant.",
    effects: [
      { op: 'adjust_counter', counter: 'hacker action points', by: 'minus the printed play cost (Witnesses: 1)' },
      { op: 'move_token', token: 'the revealed informant POI card, facedown', from: 'informant area', to: 'poi deck' },
      { op: 'move_token', token: 'the played Contact', from: 'hacker hand', to: 'hacker discard pile' },
      { op: 'adjust_counter', counter: 'informant count', by: -1 },
    ],
    citation: {
      section: '5.2',
      quote:
        'Win Back a Contact — play the Contact matching a revealed informant to remove that informant: the POI card returns facedown to the Detective\'s hidden POI deck, and your Contact goes to your discard.',
    },
  },
  {
    id: 'win-back-unblockable',
    status: 'rule',
    eventKind: 'win-back-contact',
    zones: ['informant area'],
    trigger: 'The win-back play targets the informant itself.',
    effects: [],
    citation: {
      section: '5.2',
      quote:
        'Only works on revealed informants — this play cannot be blocked (the informant is the target, not an obstacle)',
    },
  },
  {
    id: 'win-back-facedown-excluded',
    status: 'rule',
    eventKind: 'win-back-contact',
    zones: ['informant area'],
    trigger: 'The Hacker tries to win back a facedown informant.',
    effects: [],
    citation: { section: '6', quote: 'Facedown informants cannot be targeted this way.' },
  },
  {
    id: 'win-back-not-evidence',
    status: 'rule',
    eventKind: 'win-back-contact',
    zones: ['hacker discard pile', 'evidence area'],
    trigger: 'The Contact spent on a win-back goes to the discard, not the table.',
    effects: [],
    citation: { section: '6', quote: 'it does not count as Evidence' },
  },
  {
    id: 'hacker-jailbreak',
    status: 'rule',
    eventKind: 'jailbreak',
    zones: ['jail track', 'poi deck', 'clue supply', 'clue display'],
    trigger: 'Hacker gives the Detective a Negative Clue (the action is otherwise free).',
    effects: [
      { op: 'move_token', token: 'one Clue token, declared false by the Hacker', from: 'clue supply', to: 'clue display' },
      { op: 'move_token', token: "the freed person's POI card", from: 'jail track', to: 'poi deck' },
    ],
    citation: { section: '5.2', quote: 'Jailbreak — free one person from arrest' },
    notes:
      'The cost line is "Free (give the Detective a Negative Clue)". Destination of the freed card is inferred from the jail-release rule; see silent-jailbreak-details.',
  },
  {
    id: 'silent-jailbreak-details',
    status: 'silent',
    eventKind: 'jailbreak',
    zones: ['jail track', 'poi deck'],
    situation:
      'A Jailbreak is played while several people sit on the jail track. The book says only "free one person from arrest" — it never says who picks the person (presumably the Hacker), from which slot, or where the freed POI card goes (the end-of-turn release rule sends cards to the hidden POI deck, but Jailbreak is not that rule).',
    rulingNeeded:
      'Who chooses the freed person, and does the freed card return facedown to the POI deck like an end-of-track release?',
    citation: { section: '5.2', quote: 'Jailbreak — free one person from arrest' },
  },
  {
    id: 'silent-jailbreak-no-negative-available',
    status: 'silent',
    eventKind: 'jailbreak',
    zones: ['clue supply'],
    situation:
      'The Hacker wants to Jailbreak (or must price any Negative Clue) but no legal Negative Clue exists: every token is either already declared false or belongs to a category already truthfully revealed. The new-information constraint makes this state reachable late in a game.',
    rulingNeeded:
      'When no token qualifies as new information, is Jailbreak simply unavailable, or may the Hacker pay with a non-new (worthless) token?',
    citation: { section: '3', quote: 'A Negative Clue must be new information' },
  },
  {
    id: 'negative-clue-new-information',
    status: 'rule',
    eventKind: 'give-negative-clue',
    zones: ['clue supply', 'clue display'],
    trigger: 'Whenever the Hacker gives a Negative Clue (e.g., to pay for a Jailbreak).',
    effects: [
      {
        op: 'conditional',
        condition:
          'the chosen token was not previously declared false and does not belong to a category already truthfully revealed',
        then: [
          { op: 'move_token', token: 'the declared-false token', from: 'clue supply', to: 'clue display' },
          { op: 'adjust_counter', counter: 'negative clues declared', by: 1 },
        ],
      },
    ],
    citation: { section: '3', quote: 'A Negative Clue must be new information' },
  },
  {
    id: 'vague-negative-clue-truthfulness',
    status: 'vague',
    eventKind: 'give-negative-clue',
    zones: ['clue display'],
    situation:
      'Must a Negative Clue be TRUE (the token really does not match the hideout)? Section 3 says truthful reveals are "truthfully" given, but for Negative Clues it only says the Hacker "declares false" a token — it never states the declaration must be accurate, and the new-information constraint is about novelty, not truth.',
    readings: [
      'A Negative Clue must be factually true: the Hacker may only declare false a token that genuinely does not match the hideout (the natural reading, mirroring "reveal truthfully").',
      'The Hacker may bluff: any not-yet-used token may be declared false, including one matching the hideout, since the text constrains only novelty.',
    ],
    citation: { section: '3', quote: 'A Negative Clue is a token the Hacker declares false' },
  },
  {
    id: 'hacker-overclock',
    status: 'rule',
    eventKind: 'overclock',
    zones: ['location deck', 'detective hand'],
    trigger: 'Once per Hacker turn; the Hacker gives the Detective 2 Location draws.',
    effects: [
      { op: 'adjust_counter', counter: 'hacker action points', by: 1 },
      { op: 'adjust_counter', counter: 'overclock uses this turn', by: 1 },
      { op: 'draw', from: 'location deck', to: 'detective hand', count: 2 },
    ],
    citation: { section: '5.2', quote: 'Overclock — gain +1 AP this turn. Once per turn' },
    notes: 'Cost line: "Free (give the Detective 2 Location draws)".',
  },
  {
    id: 'silent-overclock-timing',
    status: 'silent',
    eventKind: 'overclock',
    zones: ['detective hand'],
    situation:
      'The Hacker Overclocks. The book prices it as "give the Detective 2 Location draws" but never says WHEN the Detective draws — immediately during the Hacker turn, or on the Detective\'s next turn.',
    rulingNeeded: 'When do the two gifted Location draws happen?',
    citation: { section: '5.2', quote: 'Free (give the Detective 2 Location draws)' },
  },
  {
    id: 'silent-overclock-short-deck',
    status: 'silent',
    eventKind: 'overclock',
    zones: ['location deck'],
    situation:
      'The Hacker Overclocks while the Location deck holds 0 or 1 cards. The endgame trigger (5.3) is worded only for the Detective\'s mandatory start-of-turn draw, and the book never says whether a partial or impossible gifted draw is allowed, forfeited, or forbidden.',
    rulingNeeded:
      'Can Overclock be played when the deck cannot supply 2 cards, and does an impossible gifted draw trigger or hasten the endgame?',
    citation: { section: '5.2', quote: 'Free (give the Detective 2 Location draws)' },
  },
  {
    id: 'burn-cost-and-limit',
    status: 'rule',
    eventKind: 'burn-the-safehouse',
    zones: ['safehouse'],
    trigger: 'Hacker spends 3 AP; only available once per game.',
    effects: [
      { op: 'adjust_counter', counter: 'hacker action points', by: -3 },
      { op: 'set_counter', counter: 'burn the safehouse remaining', to: 0 },
    ],
    citation: { section: '5.2', quote: 'Burn the Safehouse — relocate to a new hideout. Once per game.' },
  },
  {
    id: 'burn-step-1-gather',
    status: 'rule',
    eventKind: 'burn-the-safehouse',
    zones: ['location discard pile', 'location deck', 'safehouse'],
    trigger: 'Burn the Safehouse, first step.',
    effects: [
      { op: 'move_token', token: "the Detective's Location discard pile", from: 'location discard pile', to: 'location deck' },
      { op: 'move_token', token: 'the old safehouse card', from: 'safehouse', to: 'location deck' },
    ],
    citation: {
      section: '5.2a',
      quote:
        "The Hacker collects the Detective's Location discard pile and the remaining Location deck into one pile, and adds their old safehouse card to it. (Cards in the Detective's hand and face up on the board stay where they are.)",
    },
    notes: 'Gathering the pile shows the Hacker every card in it — so, by elimination, which Locations the Detective holds.',
  },
  {
    id: 'burn-step-2-choose',
    status: 'rule',
    eventKind: 'burn-the-safehouse',
    zones: ['location deck', 'safehouse'],
    trigger: 'Burn the Safehouse, second step.',
    effects: [
      {
        op: 'player_choice',
        chooser: 'Hacker',
        choiceOf: 'a different location from the gathered pile as the new hideout',
        then: [
          { op: 'move_token', token: 'the new safehouse card', from: 'location deck', to: 'safehouse' },
        ],
      },
    ],
    citation: {
      section: '5.2a',
      quote:
        'The Hacker secretly chooses a different location from that pile and takes its card as the new safehouse card. The Hacker shuffles the rest of the pile facedown — it becomes the new Location deck.',
    },
  },
  {
    id: 'burn-step-3-clear-clues',
    status: 'rule',
    eventKind: 'burn-the-safehouse',
    zones: ['clue display', 'clue supply'],
    trigger: 'Burn the Safehouse, third step.',
    effects: [
      { op: 'move_token', token: 'every Clue token on the table, truthful and Negative', from: 'clue display', to: 'clue supply' },
      { op: 'set_counter', counter: 'truthful clue categories revealed', to: 0 },
      { op: 'set_counter', counter: 'negative clues declared', to: 0 },
    ],
    citation: {
      section: '5.2a',
      quote:
        'Clear the clues: every Clue token on the table — truthful and Negative — is returned to the supply.',
    },
    notes: 'Clue categories can be earned again as normal afterwards.',
  },
  {
    id: 'burn-whole-turn',
    status: 'rule',
    eventKind: 'burn-the-safehouse',
    zones: [],
    trigger: 'The 3 AP price equals the Hacker turn allotment.',
    effects: [],
    citation: {
      section: '5.2a',
      quote: "the burn costs the Hacker's whole normal turn (3 AP) unless they Overclock first.",
    },
  },
  {
    id: 'silent-burn-no-different-location',
    status: 'silent',
    eventKind: 'burn-the-safehouse',
    zones: ['location deck', 'location discard pile', 'safehouse'],
    situation:
      'Burn the Safehouse is played when the gathered pile (discard pile + remaining deck + old safehouse) contains only the old safehouse card — reachable late, with every other Location in the Detective hand or on the board. Step 2 requires choosing "a different location from that pile", which is impossible.',
    rulingNeeded: 'Is the burn illegal in this state, or does it resolve with some fallback?',
    citation: {
      section: '5.2a',
      quote: 'The Hacker secretly chooses a different location from that pile',
    },
  },
  {
    id: 'silent-burn-midgame-guess',
    status: 'silent',
    eventKind: 'burn-the-safehouse',
    zones: ['safehouse'],
    situation:
      'The Detective spent the mid-game guess before the Hacker burns. The burn text says the investigation "restarts from zero" for clues, but says nothing about the guess — does the one mid-game chance come back for the new hideout?',
    rulingNeeded: 'Does a spent mid-game guess reset after Burn the Safehouse, or stay spent?',
    citation: { section: '5.2a', quote: 'clue categories can be earned again as normal.' },
  },
];

// ---------------------------------------------------------------------------
// Entries — Clues
// ---------------------------------------------------------------------------

const clueEntries: Entry[] = [
  {
    id: 'clue-token-inventory',
    status: 'rule',
    eventKind: 'gain-clue',
    zones: ['clue supply'],
    trigger: 'The Clue token supply, fixed at 13 tokens.',
    effects: [],
    citation: { section: '2', quote: '3 Borough, 4 Population (0/1/2/3), 6 Affiliation' },
  },
  {
    id: 'gain-clue-hacker-chooses',
    status: 'rule',
    eventKind: 'gain-clue',
    zones: ['clue supply', 'clue display', 'safehouse'],
    trigger: 'The Detective gains a Clue (bought with Location discards, or earned by an accepted block).',
    effects: [
      {
        op: 'player_choice',
        chooser: 'Hacker',
        choiceOf: 'which of the three hideout categories to reveal truthfully',
        then: [
          { op: 'move_token', token: "the token matching the hideout's true value in the chosen category", from: 'clue supply', to: 'clue display' },
          { op: 'adjust_counter', counter: 'truthful clue categories revealed', by: 1 },
        ],
      },
    ],
    citation: {
      section: '3',
      quote: 'the Hacker chooses which of the three categories to reveal truthfully',
    },
  },
  {
    id: 'gain-clue-no-repeats',
    status: 'rule',
    eventKind: 'gain-clue',
    zones: ['clue display'],
    trigger: 'A Clue is earned while at least one category is still unrevealed.',
    effects: [
      {
        op: 'conditional',
        condition: 'at least one category is not yet revealed',
        then: [],
      },
    ],
    citation: {
      section: '3',
      quote:
        'No repeats: each truthful clue category can be given only once. When the Detective earns a Clue, the Hacker must choose a category not yet revealed.',
    },
  },
  {
    id: 'gain-clue-exhausted',
    status: 'rule',
    eventKind: 'gain-clue',
    zones: ['clue display'],
    trigger: 'A Clue is earned when all three categories are already revealed.',
    effects: [
      {
        op: 'conditional',
        condition: 'all three truthful categories are already revealed',
        then: [],
      },
    ],
    citation: {
      section: '3',
      quote:
        'If the Detective earns a Clue when all three categories are already revealed, it has no effect.',
    },
  },
  {
    id: 'vague-attribute-twins',
    status: 'vague',
    eventKind: 'gain-clue',
    zones: ['clue display', 'safehouse'],
    situation:
      'Section 3 claims "Borough + Affiliation alone uniquely identify a location" and section 9 says that with all three categories revealed "the Detective knows the location". But v2.0 added Little Ghana as "an attribute twin of Trailer Towers — Clues alone can never separate them": both are Boonies / None / population 1, so all three clues leave two candidate hideouts.',
    readings: [
      'The twins are intended (v2.0 text wins): full clue information can leave exactly two candidates, and the uniqueness sentences in 3 and 9 are stale pre-v2.0 text.',
      'The uniqueness sentences are normative and Little Ghana is not actually attribute-identical (or not in play), so clues always pin one location.',
    ],
    citation: { section: '3', quote: 'Borough + Affiliation alone uniquely identify a location' },
    notes:
      'Internal contradiction with 2.0: "twin of Trailer Towers — Clues alone can never separate them". Also breaks the 9 claim "at that point the Detective knows the location".',
  },
];

// ---------------------------------------------------------------------------
// Entries — People abilities
// ---------------------------------------------------------------------------

const abilityEntries: Entry[] = [
  {
    id: 'ability-draw-3',
    status: 'rule',
    eventKind: 'ability-draw-contacts',
    zones: ['contacts deck', 'hacker hand'],
    trigger: 'The Hacker plays Zero Kelvin or Permafrost (cost 2 AP) and the play is not blocked.',
    effects: [{ op: 'draw', from: 'contacts deck', to: 'hacker hand', count: 3 }],
    citation: { section: '8.1', quote: 'XX — Draw 3 Contacts' },
  },
  {
    id: 'silent-ability-draw-short',
    status: 'silent',
    eventKind: 'ability-draw-contacts',
    zones: ['contacts deck', 'hacker discard pile'],
    situation:
      'A "Draw 3 Contacts" ability resolves when the Contacts deck plus discard pile together hold fewer than 3 cards (the rest are in hand, on the table as Evidence, or jailed). The reshuffle rule cannot manufacture cards.',
    rulingNeeded: 'Does the Hacker draw as many as possible, or is the ability (or the play) restricted?',
    citation: {
      section: '5.2a',
      quote: 'if the Contacts deck runs out, reshuffle the discard pile into a new deck.',
    },
  },
  {
    id: 'ability-force-hand-discard',
    status: 'rule',
    eventKind: 'ability-force-hand-discard',
    zones: ['detective hand', 'location discard pile'],
    trigger:
      'The Hacker plays Blackice, Sleet, Frostbyte, or Hoarfrost (cost 2 AP) and the play is not blocked.',
    effects: [
      {
        op: 'conditional',
        condition: 'the Detective hand is not empty',
        then: [
          { op: 'move_token', token: 'one Location card, pulled blindly by the Hacker', from: 'detective hand', to: 'location discard pile' },
        ],
      },
    ],
    citation: { section: '8.1', quote: 'XX — Force the Detective to discard a Location from hand' },
  },
  {
    id: 'ability-hand-discard-random',
    status: 'rule',
    eventKind: 'ability-force-hand-discard',
    zones: ['detective hand'],
    trigger: 'Resolving a forced hand discard.',
    effects: [],
    citation: { section: '9', quote: "the Hacker pulls a card blindly from the Detective's (hidden) hand." },
  },
  {
    id: 'ability-hand-discard-empty-whiffs',
    status: 'rule',
    eventKind: 'ability-force-hand-discard',
    zones: ['detective hand'],
    trigger: 'A forced hand discard resolves against an empty Detective hand.',
    effects: [],
    citation: {
      section: '9',
      quote: 'the Iceden Collective discard-from-hand attacks having nothing to hit.',
    },
    notes: 'Empty hand is legal and never blocks play; the attack simply has no effect.',
  },
  {
    id: 'ability-board-discard',
    status: 'rule',
    eventKind: 'ability-board-discard',
    zones: ['board', 'location discard pile'],
    trigger:
      'The Hacker plays a Crimson Clan or Chimera person (cost 2 AP) and the play is not blocked.',
    effects: [
      { op: 'move_token', token: 'one face-up Location card', from: 'board', to: 'location discard pile' },
    ],
    citation: { section: '8.1', quote: 'XX — Discard a Location from the board (informants can block)' },
  },
  {
    id: 'silent-board-discard-chooser',
    status: 'silent',
    eventKind: 'ability-board-discard',
    zones: ['board'],
    situation:
      'A board-discard ability resolves with several Locations face up. The ability text says only "Discard a Location from the board" — it never states who picks the discarded Location (the Hacker, as the ability\'s owner, is the natural reading, but it is not written).',
    rulingNeeded: 'Who chooses which board Location is discarded?',
    citation: { section: '8.1', quote: 'XX — Discard a Location from the board (informants can block)' },
  },
  {
    id: 'silent-board-discard-empty',
    status: 'silent',
    eventKind: 'ability-board-discard',
    zones: ['board'],
    situation:
      'A board-discard person is played while the board is empty (reachable: earlier board discards can strip the single Location the Detective has played). The book never says whether the play is legal with no target, and whether the ability whiffs like the empty-hand case.',
    rulingNeeded: 'Can the person be played with an empty board, and does the ability simply have no effect?',
    citation: { section: '8.1', quote: 'XX — Discard a Location from the board (informants can block)' },
  },
  {
    id: 'ability-reveal-informant',
    status: 'rule',
    eventKind: 'ability-reveal-informant',
    zones: ['informant area'],
    trigger:
      'The Hacker plays an OmniSuperUltra Corp person (cost 3 AP) and the play is not blocked.',
    effects: [
      {
        op: 'player_choice',
        chooser: 'Hacker',
        choiceOf: 'any one facedown informant',
        then: [
          { op: 'move_token', token: 'the chosen informant POI card, flipped face up', from: 'informant area', to: 'informant area' },
        ],
      },
    ],
    citation: { section: '8.1', quote: 'XXX — Reveal an informant' },
  },
  {
    id: 'ability-revealed-behaves-normally',
    status: 'rule',
    eventKind: 'ability-reveal-informant',
    zones: ['informant area'],
    trigger: 'After the Hacker-forced reveal.',
    effects: [],
    citation: {
      section: '6',
      quote:
        'the Hacker chooses any one facedown informant and flips it face up. The revealed informant behaves exactly like one the Detective revealed: it keeps blocking its person and keeps costing upkeep.',
    },
  },
  {
    id: 'silent-reveal-no-facedown',
    status: 'silent',
    eventKind: 'ability-reveal-informant',
    zones: ['informant area'],
    situation:
      'An OmniSuperUltra Corp person is played while the Detective has no facedown informants (none at all, or only revealed ones). The book never says whether the 3-AP play is legal with no target or whether the ability whiffs.',
    rulingNeeded: 'Can the person be played with no facedown informant, and does the ability simply do nothing?',
    citation: { section: '8.1', quote: 'XXX — Reveal an informant' },
  },
  {
    id: 'ability-retrieve-discard',
    status: 'rule',
    eventKind: 'ability-retrieve-discard',
    zones: ['hacker discard pile', 'hacker hand'],
    trigger: 'The Hacker plays a Shizuoka Inc person (cost 1 AP) and the play is not blocked.',
    effects: [
      {
        op: 'player_choice',
        chooser: 'Hacker',
        choiceOf: 'one card from the Hacker discard pile',
        then: [
          { op: 'move_token', token: 'the chosen card', from: 'hacker discard pile', to: 'hacker hand' },
        ],
      },
    ],
    citation: { section: '8.1', quote: 'X — Gain a card from the discard pile' },
    notes:
      'The pile is the Hacker\'s own Contacts discard: 5.2a card flow says ability-played people are "retrievable via Shizuoka Inc or the reshuffle".',
  },
  {
    id: 'silent-retrieve-empty-discard',
    status: 'silent',
    eventKind: 'ability-retrieve-discard',
    zones: ['hacker discard pile'],
    situation:
      'A Shizuoka Inc person is played while the Hacker discard pile is empty (typical early game). The book never says whether the play is legal with no card to gain.',
    rulingNeeded: 'Can the person be played with an empty discard pile, and does the ability whiff?',
    citation: { section: '8.1', quote: 'X — Gain a card from the discard pile' },
  },
];

// ---------------------------------------------------------------------------
// Entries — Anansi and the Iceden rider
// ---------------------------------------------------------------------------

const riderEntries: Entry[] = [
  {
    id: 'anansi-removal',
    status: 'rule',
    eventKind: 'anansi-removal',
    zones: ['informant area', 'poi deck', 'evidence area'],
    trigger: 'The Hacker plays Anansi the Spider as Evidence and the play is not blocked.',
    effects: [
      {
        op: 'player_choice',
        chooser: 'Hacker',
        choiceOf: 'one informant: a facedown one by position, or a revealed one by name',
        then: [
          { op: 'move_token', token: 'the chosen informant POI card (facedown ones return unseen)', from: 'informant area', to: 'poi deck' },
          { op: 'adjust_counter', counter: 'informant count', by: -1 },
        ],
      },
    ],
    citation: {
      section: '8.1',
      quote: 'remove ONE informant of your choice — a facedown one by pointing at its position',
    },
    notes: 'Blocking Anansi\'s Evidence commit is therefore a premium block for the Detective.',
  },
  {
    id: 'anansi-removal-skipped-on-completion',
    status: 'rule',
    eventKind: 'anansi-removal',
    zones: ['evidence area'],
    trigger: "Anansi's Evidence commit completes all 3 pieces of Evidence.",
    effects: [
      {
        op: 'conditional',
        condition: 'this commit completes all 3 Evidence',
        then: [],
      },
    ],
    citation: {
      section: '8.1',
      quote:
        'If this commit completes all 3 Evidence, the final guess happens immediately and the removal is skipped.',
    },
  },
  {
    id: 'anansi-before-iceden',
    status: 'rule',
    eventKind: 'anansi-removal',
    zones: ['informant area'],
    trigger: 'A Motive set contains both Anansi and an Iceden Collective member.',
    effects: [],
    citation: {
      section: '6',
      quote:
        "A set holding BOTH Anansi and an Iceden member resolves Anansi's removal first, then the win-back.",
    },
  },
  {
    id: 'iceden-rider',
    status: 'rule',
    eventKind: 'iceden-rider',
    zones: ['informant area', 'poi deck', 'evidence area'],
    trigger: 'The Hacker lands a Motive set containing an Iceden Collective member. Once per set.',
    effects: [
      {
        op: 'conditional',
        condition: 'at least one revealed informant is in play',
        then: [
          {
            op: 'player_choice',
            chooser: 'Hacker',
            choiceOf: 'one revealed informant',
            then: [
              { op: 'move_token', token: 'the chosen revealed informant POI card, facedown', from: 'informant area', to: 'poi deck' },
              { op: 'adjust_counter', counter: 'informant count', by: -1 },
            ],
          },
        ],
      },
    ],
    citation: {
      section: '6',
      quote:
        'the Hacker removes one revealed informant of their choice, free (the Win Back effect with no Contact card spent).',
    },
  },
  {
    id: 'iceden-rider-facedown-out-of-reach',
    status: 'rule',
    eventKind: 'iceden-rider',
    zones: ['informant area'],
    trigger: 'The rider considers only revealed informants.',
    effects: [],
    citation: { section: '6', quote: 'Facedown informants are out of reach.' },
  },
  {
    id: 'iceden-rider-no-target',
    status: 'rule',
    eventKind: 'iceden-rider',
    zones: ['informant area'],
    trigger: 'The rider fires with no revealed informant in play.',
    effects: [],
    citation: { section: '6', quote: 'If there is no revealed informant, nothing happens.' },
  },
  {
    id: 'iceden-rider-skipped-on-completion',
    status: 'rule',
    eventKind: 'iceden-rider',
    zones: ['evidence area'],
    trigger: 'The Iceden-bearing set completes all 3 Evidence.',
    effects: [
      {
        op: 'conditional',
        condition: 'the set completes all 3 Evidence',
        then: [],
      },
    ],
    citation: {
      section: '6',
      quote: 'If the set completes all 3 Evidence, the final guess happens immediately and the rider is skipped.',
    },
  },
];

// ---------------------------------------------------------------------------
// Entries — Endgame
// ---------------------------------------------------------------------------

const endgameEntries: Entry[] = [
  {
    id: 'endgame-evidence-complete',
    status: 'rule',
    eventKind: 'endgame-evidence-complete',
    zones: ['evidence area', 'safehouse'],
    trigger: 'The Hacker completes all 3 pieces of Evidence (Weapon, 3 Witnesses, 3 Motive sets).',
    effects: [
      { op: 'set_counter', counter: 'evidence pieces complete', to: 3 },
    ],
    citation: {
      section: '5.3',
      quote:
        "the moment the Hacker completes all 3 pieces of Evidence, the Detective makes the final guess immediately — the Hacker's turn ends on the spot, and nothing else resolves first.",
    },
    notes: 'Preempts everything, including the Anansi removal and the Iceden rider (both explicitly skipped).',
  },
  {
    id: 'endgame-deck-exhausted',
    status: 'rule',
    eventKind: 'endgame-deck-exhausted',
    zones: ['location deck', 'safehouse'],
    trigger: 'The Detective cannot make the mandatory start-of-turn Location draw.',
    effects: [],
    citation: {
      section: '5.3',
      quote:
        'if the Detective cannot make their mandatory start-of-turn draw, the city has gone cold. The Detective must make the final guess by the end of that turn.',
    },
    notes: 'The Detective may still spend that turn\'s AP before guessing ("by the end of that turn").',
  },
  {
    id: 'silent-exhausted-turn-mandatory-play',
    status: 'silent',
    eventKind: 'endgame-deck-exhausted',
    zones: ['detective hand', 'board'],
    situation:
      'On the deck-exhausted turn the mandatory draw fails. The mandatory "Play 1 Location card" step is justified by "Because the draw always comes first, you can never be without a card to play" — which is false this turn if the hand is empty. The book never says whether the mandatory play still happens (from a non-empty hand) or is skipped.',
    rulingNeeded:
      'On the final turn, is the mandatory Location play still required when the hand has cards, and simply skipped when it is empty?',
    citation: {
      section: '5.1',
      quote: 'Because the draw always comes first, you can never be without a card to play.',
    },
  },
  {
    id: 'final-guess',
    status: 'rule',
    eventKind: 'final-guess',
    zones: ['safehouse'],
    trigger: 'Either endgame trigger fires; the Detective names one location.',
    effects: [
      {
        op: 'conditional',
        condition: 'the named location matches the safehouse card',
        then: [{ op: 'game_end', winner: 'Detective', reason: 'correct final location guess' }],
        otherwise: [{ op: 'game_end', winner: 'Hacker', reason: 'the Hacker is exonerated — wrong final guess' }],
      },
    ],
    citation: {
      section: '5.3',
      quote:
        'granted even if the mid-game guess was already spent. Correct = the Detective wins; wrong = the Hacker is exonerated and wins.',
    },
  },
];

// ---------------------------------------------------------------------------
// Assembly + coverage
// ---------------------------------------------------------------------------

const entries: Entry[] = [
  ...setupEntries,
  ...detectiveEntries,
  ...hackerEntries,
  ...clueEntries,
  ...abilityEntries,
  ...riderEntries,
  ...endgameEntries,
];

// Why each event leaves the remaining zones untouched. Combined with the union
// of zones the event's entries DO touch, this yields the not-applicable cells.
// Each reason is written to be true of every zone the event's entries omit.
const NA_REASONS: Record<EventKind, string> = {
  'setup':
    'Setup only builds the starting zones: the safehouse leaves the Location deck, hands are drawn, the POI deck is taken. The board, discard piles, evidence area, informant area, jail track and clue display all start empty and setup never touches them.',
  'detective-mandatory-draw':
    'The mandatory draw moves exactly one card from the Location deck to the Detective hand (its failure is handled by the endgame event). No People card, clue token, or Hacker-side zone is read or moved.',
  'detective-mandatory-play':
    'The mandatory play moves exactly one Location card from the Detective hand to the board (the safehouse is only implicated as the deduction that a board card is not it). No other zone holds a component this step reads or moves.',
  'informant-upkeep':
    'Upkeep only spends AP per informant or returns unpaid informant POI cards to the hidden POI deck (the jail track appears only in the shared release-to-deck rule). Location zones, Hacker zones, evidence and clues are untouched.',
  'make-arrest':
    'An arrest reads the board for a legal target and moves one POI card to jail slot 1; evidence-area and informant-area interactions are covered by their own entries. Location deck/hand/discard, Hacker zones, and clue zones play no part.',
  'recruit-informant':
    'Recruitment moves one POI card facedown to the informant area (evidence immunity and the jailed-person gap have their own entries). No Location zone, Hacker zone, or clue zone is read or moved.',
  'extra-location-draw':
    'The bought draw moves one card from the Location deck to the Detective hand. No other zone holds a component this action reads or moves.',
  'mid-game-guess':
    'The guess names a location and is checked against the facedown safehouse card only. No card or token moves in any other zone (a correct guess simply ends the game).',
  'buy-clue':
    'Buying a Clue discards Location cards from the Detective hand to the Location discard pile and hands off to the gain-clue event for the token. Board, deck, safehouse, Hacker zones, POI/informant/jail zones are untouched.',
  'jail-advance':
    'End-of-turn advancement moves cards along the jail track and returns cards leaving slot 3 to the hidden POI deck. No Location, Hacker, evidence, informant, or clue zone is touched.',
  'draw-contact':
    'The 1 AP draw moves one card from the Contacts deck to the Hacker hand (empty-deck handling belongs to the reshuffle event, the both-empty case to its silent entry). No Detective-side, evidence, POI, jail, or clue zone is involved.',
  'play-person':
    'Playing a person moves the card from hand to the Hacker discard pile and resolves its ability, which is encoded under the five ability events; the block itself is the informant-block event. Location zones, evidence area, POI deck and clue zones are not touched by the play itself.',
  'play-evidence':
    'An Evidence play moves one card from the Hacker hand to the evidence area (blocks are the informant-block event; Anansi\'s removal is its own event). Location zones, POI deck, jail track, and clue zones are untouched by the play itself.',
  'play-motive-set':
    'A set play moves three cards from the Hacker hand to the evidence area, with informant checks touching the informant area and clue zones, and the jailed-card restriction touching the jail track. Location zones, the Contacts deck/discard, POI deck, and safehouse are untouched.',
  'win-back-contact':
    'A win-back spends a Contact from hand to the Hacker discard pile and returns one revealed informant POI card to the hidden POI deck. Location zones, board, jail track, clue zones, Contacts deck and safehouse play no part.',
  'jailbreak':
    'A Jailbreak frees one person from the jail track (priced by a Negative Clue from the supply to the display). Location zones, Hacker card zones, evidence area, and informant area are untouched.',
  'overclock':
    'Overclock adjusts the Hacker AP counter and gifts the Detective 2 draws from the Location deck to the Detective hand. No card zone beyond those two is read or moved.',
  'burn-the-safehouse':
    'The burn rebuilds the Location deck from the discard pile and old safehouse, picks a new safehouse, and clears the clue display to the supply. Cards in the Detective hand and on the board explicitly stay; Hacker card zones, evidence, POI, informant and jail zones are untouched.',
  'informant-block':
    'A block flips one informant face up, bounces the played card back to the Hacker hand, and yields a Clue token from supply to display. Location zones, evidence area, POI deck, jail track, and the Contacts deck/discard are untouched.',
  'gain-clue':
    'Gaining a Clue moves one token from the supply to the display, truthfully matching the safehouse in the Hacker-chosen category. No card zone is read or moved.',
  'give-negative-clue':
    'A Negative Clue moves one declared-false token from the supply to the display. No card zone is read or moved.',
  'contacts-reshuffle':
    'The reshuffle turns the Hacker discard pile into the new Contacts deck. No other zone holds a component this step reads or moves.',
  'ability-draw-contacts':
    'The Draw 3 ability moves cards from the Contacts deck (with the discard pile involved only via reshuffle/shortage) to the Hacker hand. Detective-side zones, evidence, POI, informant, jail and clue zones are untouched.',
  'ability-force-hand-discard':
    'The forced discard pulls one blind card from the Detective hand to the Location discard pile. No other zone holds a component this ability reads or moves.',
  'ability-board-discard':
    'The board discard moves one face-up Location from the board to the Location discard pile. No other zone holds a component this ability reads or moves.',
  'ability-reveal-informant':
    'The reveal flips one facedown card inside the informant area. No card or token leaves any zone.',
  'ability-retrieve-discard':
    'The retrieval moves one card from the Hacker discard pile to the Hacker hand. No other zone holds a component this ability reads or moves.',
  'anansi-removal':
    'Anansi\'s removal returns one informant POI card from the informant area to the hidden POI deck (triggered from the evidence area, and skipped when Evidence completes). Location zones, Detective hand, Hacker card zones, jail track, and clue zones are untouched.',
  'iceden-rider':
    'The rider returns one revealed informant POI card from the informant area to the hidden POI deck (triggered by an Iceden member landing in the evidence area). Location zones, Hacker card zones, jail track and clue zones are untouched.',
  'endgame-evidence-complete':
    'This trigger only observes the evidence area reaching completion and hands play to the final guess against the safehouse. Nothing moves in any other zone ("nothing else resolves first").',
  'endgame-deck-exhausted':
    'This trigger only observes the empty Location deck at the mandatory draw (the that-turn mandatory play question is its own silent entry) and grants the final guess against the safehouse. Other zones are unaffected by the trigger itself.',
  'final-guess':
    'The final guess is checked against the facedown safehouse card and ends the game either way. No card or token moves in any other zone.',
};

const notApplicable: NotApplicableCell[] = [];
for (const eventKind of EVENTS) {
  const touched = new Set<string>();
  for (const entry of entries) {
    if (entry.eventKind === eventKind) for (const z of entry.zones) touched.add(z);
  }
  for (const zone of ZONES) {
    if (!touched.has(zone)) {
      notApplicable.push({ zone, eventKind, reason: NA_REASONS[eventKind] });
    }
  }
}

const encoding: GameRulesEncoding = {
  gameId: 'cybernoir-2127',
  rulesVersion: 'pre-v2.3',
  rulesFile: 'packages/cybernoir-2127/src/dev/verify/rules-pre-v2.3.txt',
  universe: {
    zones: [...ZONES],
    counters: COUNTERS,
    eventKinds: [...EVENTS],
  },
  entries,
  notApplicable,
};

export default encoding;
