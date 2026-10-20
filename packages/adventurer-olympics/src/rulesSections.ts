// Adventurer Olympics — rules sections (docs/rules-teaching.md). The getRulesText
// blob is DERIVED from these via core/rulesSections.ts renderRulesText so the
// blob and the sections can never drift.
import type { RuleSection } from '@zekel/game-kit';

export const AORuleSections: RuleSection[] = [
  {
    id: 'ao-setup',
    title: 'Setup',
    text: [
      'What you\'ll need:',
      '- 5 decks: Quest, Companion, Little Monster, Big Monster, Dungeon',
      '- 10 map tiles (7 hexes each)',
      '- 5 artifact cards: Hearts, Spades, Diamonds, Clubs, and the Star',
      '- an Adventurer standee for each player',
      '- 10 tokens in each player\'s colour',
      '- 4 initiative tokens, marked 1, 2, 3, 4',
      '- six-sided dice (the box has 8)',
      '',
      '',
    ].join('\n') + 'Shuffle the five decks and the 10 map tiles. Put the 5 artifact cards face up as the supply. Each player chooses an Adventurer standee and a colour and takes that colour\'s 10 tokens. Draw (number of players + 1) Quest cards face up — these are the only quests in the game. Turn the top map tile face up as the starting tile; every standee begins on its centre hex. Starting stats: Charisma 1, Strength 1, Movement 2. Companions raise stats; stats never go down.',
    tags: { move_types: ['setup_standee'], phases: ['setup'] },
  },
  {
    id: 'ao-reporting',
    title: 'Real cards and dice: what the players report',
    text: 'The decks and dice are on the table. Each player rolls their own dice and says the total. At a table where anyone uses the real cards, the players draw the real cards and say what they drew — the quest cards and the starting tile at setup, then every map tile, Companion, Monster and Dungeon card during play. The server does not know the real order, so when an AI player draws, a human draws that card for the AI and says what it is. The server does know which cards went under each deck and in what order, so it only accepts a card that could really be on top. A player on the digital version presses Roll or Reveal instead, and the server rolls or deals for them. The setup draw can be reported all at once or one card at a time.',
    tags: { move_types: ['setup_report', 'report_card', 'resolve_report'], phases: ['setup', 'icon', 'explore'] },
  },
  {
    id: 'ao-naming',
    title: 'Naming hexes, slots and turns',
    text: 'Every hex is on exactly one tile, so a hex is named by its tile and the hex name printed on that tile: "the NE hex of Tile 3", "the centre of Tile 1". An empty slot is named by the side it sits against: "side NE–SE of Tile 4". The starting tile is placed unturned; a new tile\'s turn is named by where its printed N hex points, in terms of the starting tile — "its N hex points where the starting tile\'s SE hex points".',
    tags: { move_types: ['step', 'move_away', 'explore'], phases: ['move', 'explore'] },
  },
  {
    id: 'ao-round-order',
    title: 'Round & turn order',
    text: 'Each round: every player rolls 2 dice; the highest total goes first, descending. Ties re-roll to settle their places; initiative tokens 1–4 show the order. In turn order each player takes one turn; when everyone has had a turn the round ends and a new turn-order roll begins.',
    tags: { move_types: ['report_turn_order_roll'], phases: ['roll-order'] },
  },
  {
    id: 'ao-moving',
    title: 'Your turn & moving',
    text: 'On your turn you may move and, while you move, you may explore. You may take up to Movement steps and may choose not to move. Each step goes to an adjacent hex. You may not enter or pass through a hex with another player\'s standee. Stepping onto an uncompleted icon triggers it immediately (even mid-move) and ends your turn after it resolves; you cannot walk through an uncompleted icon. An icon with a player token on it is plain ground — walk over it or stop, nothing happens.',
    tags: { move_types: ['step', 'stop'], phases: ['turn', 'move'] },
  },
  {
    id: 'ao-try-again',
    title: 'Staying to try again',
    text: 'If you start your turn standing on an uncompleted icon (because you failed it earlier), you may stay and try again instead of moving — the icon triggers again with a fresh card from the top of the deck, and your turn ends after it resolves. While you stand there no one else can use that icon (they cannot enter your hex).',
    tags: { move_types: ['try_again', 'move_away'], phases: ['turn'] },
  },
  {
    id: 'ao-explore',
    title: 'Exploring',
    text: 'You may explore when you have at least one step left and are standing on a hex that touches an empty tile slot. Take the top tile from the stack, place it in an empty slot touching your hex, turn it any way (6 options), and put one of your tokens on its centre hex. Your remaining steps are used up and your turn ends — you do not get to step onto the new tile this turn. If the stack is empty you cannot explore.',
    tags: { move_types: ['explore'], phases: ['explore'] },
  },
  {
    id: 'ao-tile-fit',
    title: 'How tiles fit together',
    text: 'Each tile has six sides (N–NE, NE–SE, SE–S, S–SW, SW–NW, NW–N); each side is a tile slot. A tile placed in a slot nestles against the two outer hexes that form the side — the two tiles never share a hex. Every new tile covers 7 fresh hexes and always touches the map with at least those two hexes; there are no gaps or holes. Each outer hex belongs to two sides, so a player on an outer hex can explore into up to two slots. The centre hex touches no slot — you can never explore from a centre hex.',
    tags: { phases: ['explore'] },
  },
  {
    id: 'ao-tile-glance',
    title: 'Hexes and tiles at a glance',
    text: [
      'One tile, printed N at the top:',
      '',
      '          N',
      '    NW         NE',
      '        centre',
      '    SW         SE',
      '          S',
      '',
      'The six sides run between neighbouring outer hexes: N–NE, NE–SE, SE–S, S–SW, SW–NW, NW–N. A new tile placed against side NE–SE touches the old tile only at its NE and SE hexes; the new tile brings 7 hexes of its own.',
      'The centre hex touches no slot, so you can never explore from a centre hex.',
    ].join('\n'),
    tags: {},
  },
  {
    id: 'ao-forced-explore',
    title: 'Forced explore',
    text: 'When every icon on the map has been completed, the next player to take a turn must explore at the start of their turn, before moving: take the top tile, place it in any empty slot touching the map (any rotation), put a token on its centre, then take the rest of the turn normally. "The next player" can be the first player of the next round. If the stack is empty there is no forced explore (the game is ending).',
    tags: { move_types: ['explore'], phases: ['turn'] },
  },
  {
    id: 'ao-rolling',
    title: 'Rolling (all tests)',
    text: 'Every test works the same way: roll a number of dice equal to one of your stats and add up all the pips. If the total is equal to or higher than the number on the card, you succeed. Charisma (start 1) is used to recruit companions; Strength (start 1) to fight monsters; Movement (start 2) sets your steps per turn. Your stat is your starting value plus the bonuses on every companion you hold.',
    tags: { move_types: ['report_test_roll'], phases: ['test'] },
  },
  {
    id: 'ao-icons',
    title: 'Icons (City / Dungeon / Monster / Artifact)',
    text: 'When you step onto an uncompleted icon (or stay on one to try again) it triggers; resolve it, then your turn ends. Success: put one of your tokens on the hex — the icon is completed and can never trigger again. Failure: nothing is placed; the icon stays open and anyone may try later. City = recruit a companion (Charisma roll). Dungeon = draw a Dungeon card (see below). Little or Big Monster = fight (Strength roll). Artifact = take it (no roll).',
    tags: { phases: ['icon'] },
  },
  {
    id: 'ao-city',
    title: 'City — recruit a companion',
    text: 'Draw the top Companion card and note its number. Roll dice equal to your Charisma. Success: you recruit the companion — keep it in front of you and its stat bonuses add to your stats for the rest of the game. Fail: put the companion card at the bottom of the Companion deck.\n\n' +
      'Example: you have Charisma 1 and Movement 2. Your first step lands on the uncompleted City icon on the SW hex of Tile 1, so it triggers at once. ' +
      'You draw the top Companion card: number 2, bonus +1 Strength. You roll 1 die (your Charisma) and get a 3. 3 ≥ 2, so you recruit it — your token goes on the City hex, the card stays in front of you, and your Strength is now 2. ' +
      'Your turn ends; your second step is lost.',
    tags: { move_types: ['report_test_roll'], phases: ['icon', 'recruit'] },
  },
  {
    id: 'ao-monster',
    title: 'Little & Big Monster — fight',
    text: 'Draw the top card from the matching deck and note its number. Roll dice equal to your Strength. Success: you defeat the monster — keep the card in front of you (it counts toward quests). Fail: put the monster card at the bottom of its deck. If the deck is empty there is nothing to fight: on a map icon nothing happens, the icon stays open, and your turn ends.\n\n' +
      'Example: you have Strength 2 (1 to start, +1 from a companion). You step onto the uncompleted Little Monster icon on the S hex of Tile 2, so it triggers at once. ' +
      'You draw the top Little Monster card: number 4. You roll 2 dice and get 1 and 2 — total 3. 3 is lower than 4, so you fail: the card goes to the bottom of the Little Monster deck, no token is placed, and your turn ends. ' +
      'You are still standing on the icon, so next turn you may stay and try again against a fresh card.',
    tags: { move_types: ['report_test_roll'], phases: ['icon', 'fight'] },
  },
  {
    id: 'ao-dungeon',
    title: 'Dungeon',
    text: 'Draw the top Dungeon card and do what it says; whatever happened, put it at the bottom of the Dungeon deck. Little Monster / Big Monster: fight it — the Dungeon is completed when you defeat it. 2x Little Monsters: fight two one at a time; lose the first and you do not fight the second; keep any you defeat; completed when you defeat both. Companion: recruit it (Charisma roll); a failed recruit fails the Dungeon. Any artifact: take any one of the four suit artifacts from the supply or another player, or decline. Map: explore, but place the tile in any empty slot touching the map (not only one touching your hex); completed when you place it.\n\n' +
      'Example: you have Strength 2. You step onto the uncompleted Dungeon icon on the NE hex of Tile 1, so it triggers at once. You draw a Dungeon card: Any artifact. You decline, so it gives you nothing — it goes to the bottom of the Dungeon deck and you draw again (see Dungeon — drawing again). ' +
      'The next card is Little Monster. You draw the top Little Monster card (number 3), roll 2 dice and get 4 and 2 — total 6. 6 ≥ 3, so you defeat it: you keep the monster card, your token goes on the Dungeon hex, and the Dungeon card goes to the bottom of the Dungeon deck. Your turn ends.',
    tags: { move_types: ['report_test_roll', 'explore', 'take_artifact', 'decline_artifact'], phases: ['dungeon'] },
  },
  {
    id: 'ao-dungeon-draw-again',
    title: 'Dungeon — drawing again',
    text: 'If a Dungeon card gives you nothing, put it at the bottom of the Dungeon deck and draw another; keep going until you draw a card you must resolve. A card gives nothing when: Any artifact (you decline, or you already hold all four suits); Map (the tile stack is empty); Little/Big Monster (that deck is empty); 2x Little Monsters (the Little Monster deck is empty before the first fight). If you beat the first of the 2x Little Monsters and the deck is then empty, keep the monster you beat; the card gives you nothing more, so draw again. This always ends: the Dungeon deck always contains Companion and Big Monster cards, and those decks never run out.',
    tags: { phases: ['dungeon'] },
  },
  {
    id: 'ao-artifacts',
    title: 'Artifacts',
    text: [
      'There are 5. All 5 count toward the "Most artifacts" quest.',
      '- Hearts — map hex: the NE hex of Tile 3. A suit artifact.',
      '- Spades — map hex: the N hex of Tile 8. A suit artifact.',
      '- Diamonds — map hex: the S hex of Tile 7. A suit artifact.',
      '- Clubs — map hex: the NW hex of Tile 2. A suit artifact.',
      '- The Star — map hex: the SW hex of Tile 6. The Star can only be taken from its own map hex (Tile 6); an "Any artifact" card can never take it, and whoever takes the Star keeps it for the rest of the game. The Star has no other effect.',
      'An artifact can change hands — stepping on its map hex takes it from whoever holds it (only once per hex, since the hex is then completed), and an "Any artifact" Dungeon card can take any of the four suit artifacts from the supply or from any player.',
      '',
      'Example: earlier, another player drew an "Any artifact" Dungeon card and took Clubs from the supply. Now you step onto the uncompleted Clubs icon on the NW hex of Tile 2, so it triggers at once. There is no roll: you take Clubs from that player. Your token goes on the hex, so it can never trigger again. Your turn ends.',
    ].join('\n'),
    tags: { move_types: ['take_artifact'], phases: ['artifact'] },
  },
  {
    id: 'ao-quests',
    title: 'Quests',
    text: [
      'Only the quests turned face up at setup (players + 1) are in play.',
      'Claimed the moment someone achieves it — the FIRST player to achieve it takes the card and scores 1 point:',
      '- Explore 3 tiles (claimed at once, by the first to do it) — tiles with your token on the centre hex; exploring, a Dungeon Map card, and a forced explore all count; the starting tile never counts.',
      'Scored at the end of the game — the player with STRICTLY the most takes the card and scores 1 point; if players tie for the most, no one gets the point:',
      '- Most dungeons (end of game; a tie scores for no one) — Dungeon hexes with your token.',
      '- Most companions (end of game; a tie scores for no one) — companions you hold at the end.',
      '- Most Little Monsters (end of game; a tie scores for no one).',
      '- Most Big Monsters (end of game; a tie scores for no one).',
      '- Most artifacts (end of game; a tie scores for no one) — the Star included.',
    ].join('\n'),
    tags: { phases: ['quest'] },
  },
  {
    id: 'ao-ending',
    title: 'Ending the game',
    text: 'The game ends when the last map tile is placed, whether by exploring, by a Dungeon Map card, or by a forced explore: finish the current round as normal, play one more full round (with a new turn-order roll), then the game is over — award the end-of-game quests, then count quest points. The player with the most quest points wins; a tie shares the victory. If the last tile is never placed, the game does not end (this only happens if nobody chooses to explore).',
    tags: { phases: ['ending'] },
  },
];
