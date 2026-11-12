# Sweetlands Imperium — table reference for the designer

This document describes the physical game so you can draw its digital table without ever having seen the box. Where the rulebook and the code disagree, the code wins (the rulebook is an unfinished design doc). Sources are listed at the end.

A note on words. "Unit" means a playing piece. "Space" means one square on the board. "Region" means one of the four quarters of the board, each owned by one faction. "Intel" is the name of the game's card deck. "Influence" is the game's money. "Sugar cubes" are both a resource and the dice you roll in a fight.

---

## What it is

Sweetlands Imperium is an area-control race for 2 to 5 players on a candy-land map. The Sugar King is dead and five dessert-themed factions scramble for the throne. Each player owns three pieces (a Leader, a Knight and an Ambassador) and moves them around a ring of four colored regions by playing colored Intel cards. Along the way they collect taxes, gather influence, capture rival pieces, and fight the monster that guards the Candy Castle in the middle of the board. The first player to reach **5 points** wins (the engine also stops the game after 60 rounds and the leader on points wins). The tone is bright, cartoon candy: saturated primary colors, a milkshake duchess, a fudge knight, a jellybean princess, a cheesecake vizier, and a deposed quiche queen wandering the desert.

---

## Everything on the table

| Component | Count | Notes |
|---|---|---|
| Board | 1 | 80 colored spaces + 1 castle in the middle. See "The board". |
| Intel cards (one shared deck) | 80 | 60 single-color + 12 double-color + 8 treat. See "The Intel deck". |
| Leader pieces | 5 | one per faction |
| Knight pieces | 5 | one per faction |
| Ambassador pieces | 5 | one per faction |
| Foe pieces | 3 | Dragon, Orc, Fiend. Only ONE is used per game. |
| Faction boards | 5 | one per faction; holds that player's resources |
| Secret objective cards | 12 | each player keeps 1 (Nomads keep none) |
| Intel tokens | 24 | 4 of each of the 6 colors; a shared supply |
| Sugar cubes | 30 | a shared bank; each cube is also a custom die |
| Tax trackers | 4 | one per region, showing tax level 0 to 3 |
| Special-location tiles | 4 | the four "random treat" tiles, placed at setup |
| Starting tiles | 4 | one per region |
| Public objective trackers | 16 | markers showing who has scored which public objective |
| Point markers | 5 | one per player |
| Point tracker | 1 | a track from 0 to 5 |
| Player aids | 5 | reference cards (not modeled digitally) |

Starting resources per player: 3 sugar cubes, 2 influence, 3 Intel cards, 1 secret objective. The Nomads start with 0 sugar cubes and no secret objective. Every region's tax starts at 0.

---

## The board

The board is a big loop made of four regions, with the Candy Castle in the center. Each region has exactly 20 spaces:

- **12 ring spaces** — the outer loop
- **6 road spaces** — a short path that leaves the ring and curls in toward the castle
- **1 regional treat space** — printed on the board, named for the region's faction
- **1 random treat slot** — a dotted "?" square where a random treat tile is placed at setup

That makes 4 × 20 = **80 spaces**, plus the castle (drawn as a 2×2 block, but it is ONE location in play). Each region also has a **start tile** just beside the ring where that faction's three units begin and return to when captured.

### The color cycle

Every ring and road space is one of six colors, always in this order: **red, orange, yellow, green, blue, purple**, then red again. A region's 12 ring spaces are two full runs of that cycle. A region's 6 road spaces are one run.

Movement is by color, not by counting. When you play a red card, your unit jumps forward to the **next red space** — however far that is (1 to 6 spaces). So the "adjacency" a designer needs is simply: each space leads to the next space in the sequence. Nothing else connects.

### Direction and order

Units move **counter-clockwise** only. Regions are numbered 1 to 4 and the loop runs 1 → 2 → 3 → 4 → 1. Physically:

- **Region 1** (Milkshake) is the **bottom**
- **Region 2** (Fudge) is the **right**
- **Region 3** (Jellybean) is the **top**
- **Region 4** (Cheesecake) is the **left**

Within a region the ring runs from an "entry red" (space 0) through to an "exit purple" (space 11). The exit purple of one region leads to the entry red of the next.

### Junction and road

Each region's **first purple** ring space (space 5, halfway round) is a **junction**. A unit standing there — or passing over it — may either keep going round the ring OR turn onto that region's road. The road is 6 spaces, red through purple, running toward the castle. The road's final purple space is the **castle entrance**. Playing a purple card while on the road (or at the junction) lets a unit step into the castle. The castle is a dead end: the only way out is to recall the unit home.

### Treat spaces

The 8 treat spaces sit beside the ring, not on it. You cannot reach one by color movement — only by playing a treat card of the matching treat. When a unit on a treat space later moves by color, it re-joins the ring at a fixed nearby space (see the table). Treat spaces have no color, so they are never a landing spot for a color move. Units on a treat space are exempt from taxes.

The 4 **regional treats** are printed permanently: **Milkshake** (region 1), **Fudge** (region 2), **Jellybean** (region 3), **Cheesecake** (region 4). The 4 **random treats** — **ice cream, chocolate bar, gummy bear, cupcake** — are tiles placed into the four "?" slots at setup, so which tile is where changes each game and must be shown on screen.

### Grid layout

The printed board is a plain square grid, rows 1–11 and columns 0–13 (row 0 is the top). Here is the exact layout, transcribed from the code. Letters are colors (R O Y G B P). A trailing digit is the region. Arrows mark road spaces and point toward the castle. `S` is a start tile. `MS FD JB CC` are the regional treats. `?` is a random treat slot. `XX` is the castle.

```
       0  1  2  3  4  5  6  7  8  9 10 11 12 13
 r1    .  . B3 G3  ? Y3 O3  . B3 G3 Y3 S3  .  .
 r2    .  . P3  .  .  . R3 JB P3  . O3 R3 P2  .
 r3    . S4 R4  .  .  . Y< O< Rv  .  .  . B2  .
 r4    . Y4 O4  .  .  . Gv B> P>  .  .  . G2  ?
 r5    . G4  .  .  .  .  . XX XX P< B^  .  . Y2
 r6    . B4 P4 R> O> B^ P> XX XX  . G^  . R2 O2
 r7    .  . CC  . Yv G>  .  . P^  . Y^  . FD  .
 r8    . O4 R4  .  .  .  .  . B^  . O< R< P2 B2
 r9    ? Y4  .  .  .  . O^ Y> G>  .  .  .  . G2
 r10  G4  .  . O1 Y1 G1 R^ R1 O1 Y1  .  . O2 Y2
 r11  B4 P4 MS R1 S1 B1 P1  ?  . G1 B1 P1 R2 S2
```

### Every space, by region

Coordinates are (row, column). "Ring 0–11" and "Road 0–5" are the engine's indices; the color of any index is simply the cycle position (0 red, 1 orange, 2 yellow, 3 green, 4 blue, 5 purple, then repeat).

**Region 1 — bottom — Arch Duchess of Milkshake**

| Space | Color | Position |
|---|---|---|
| Start tile | — | (11,4) |
| Ring 0 | red | (11,3) |
| Ring 1 | orange | (10,3) |
| Ring 2 | yellow | (10,4) |
| Ring 3 | green | (10,5) |
| Ring 4 | blue | (11,5) |
| Ring 5 — junction | purple | (11,6) |
| Ring 6 | red | (10,7) |
| Ring 7 | orange | (10,8) |
| Ring 8 | yellow | (10,9) |
| Ring 9 | green | (11,9) |
| Ring 10 | blue | (11,10) |
| Ring 11 — exit | purple | (11,11) |
| Road 0–5 | red, orange, yellow, green, blue, purple | (10,6) (9,6) (9,7) (9,8) (8,8) (7,8) |
| Regional treat: Milkshake | none | (11,2) — rejoins ring at Ring 0 |
| Random treat slot "?" | none | (11,7) — rejoins ring at Ring 6 |

**Region 2 — right — General Fudge**

| Space | Color | Position |
|---|---|---|
| Start tile | — | (11,13) |
| Ring 0–5 | red, orange, yellow, green, blue, purple (junction) | (11,12) (10,12) (10,13) (9,13) (8,13) (8,12) |
| Ring 6–11 | red, orange, yellow, green, blue, purple (exit) | (6,12) (6,13) (5,13) (4,12) (3,12) (2,12) |
| Road 0–5 | red, orange, yellow, green, blue, purple | (8,11) (8,10) (7,10) (6,10) (5,10) (5,9) |
| Regional treat: Fudge | none | (7,12) — rejoins at Ring 6 |
| Random treat slot "?" | none | (4,13) — rejoins at Ring 9 |

**Region 3 — top — Princess Jellybean**

| Space | Color | Position |
|---|---|---|
| Start tile | — | (1,11) |
| Ring 0–5 | red, orange, yellow, green, blue, purple (junction) | (2,11) (2,10) (1,10) (1,9) (1,8) (2,8) |
| Ring 6–11 | red, orange, yellow, green, blue, purple (exit) | (2,6) (1,6) (1,5) (1,3) (1,2) (2,2) |
| Road 0–5 | red, orange, yellow, green, blue, purple | (3,8) (3,7) (3,6) (4,6) (4,7) (4,8) |
| Regional treat: Jellybean | none | (2,7) — rejoins at Ring 6 |
| Random treat slot "?" | none | (1,4) — rejoins at Ring 9 |

**Region 4 — left — Grand Vizier Cheesecake**

| Space | Color | Position |
|---|---|---|
| Start tile | — | (3,1) |
| Ring 0–5 | red, orange, yellow, green, blue, purple (junction) | (3,2) (4,2) (4,1) (5,1) (6,1) (6,2) |
| Ring 6–11 | red, orange, yellow, green, blue, purple (exit) | (8,2) (8,1) (9,1) (10,0) (11,0) (11,1) |
| Road 0–5 | red, orange, yellow, green, blue, purple | (6,3) (6,4) (7,4) (7,5) (6,5) (6,6) |
| Regional treat: Cheesecake | none | (7,2) — rejoins at Ring 6 |
| Random treat slot "?" | none | (9,0) — rejoins at Ring 9 |

**Castle** — one location, drawn at (5,7) (5,8) (6,7) (6,8). The four road purples — (7,8), (5,9), (4,8), (6,6) — all enter it. The foe piece sits here until defeated. The castle has no color and no region.

### What is printed on a space

Each colored space carries a small region number in its top-left corner (1, 2, 3 or 4). Road spaces carry an arrow instead, pointing toward the castle. Random treat slots are dotted-outline squares with a big "?". Nothing else is printed. The rulebook notes a wish for "rule hints on the map"; none exist yet, so the digital table is free to add them (for example, a color legend: red = attack, orange = influence, yellow = taxes, green = push, blue = intel, purple = castle).

### Region distance

Several rules depend on how far a unit is from home, counted forward round the loop: home = 0, next region = 1, then 2, then 3. From Region 1, Region 2 is distance 1 and Region 4 is distance 3. This matters for gaining Intel (Ambassador) and gaining influence (Leader).

---

## The factions

Each faction has three units: one **Leader** (claims the castle, gathers influence), one **Knight** (fights and captures), one **Ambassador** (gathers Intel). All three start on the faction's start tile. The colors below are the player colors from the rulebook, and the hex values are what the existing digital board code uses for those pieces.

| Faction (printed name) | Home region | Player color | Hex in code | Ability |
|---|---|---|---|---|
| **Arch Duchess of Milkshake** | Region 1 (bottom) | yellow | `#f5a623` (drawn as a warm orange-yellow so it does not vanish against the yellow spaces) | You never pay taxes. |
| **General Fudge** | Region 2 (right) | brown | `#8b5a2b` | Discard 2 Intel (instead of 4) to convert into one Intel of any color. |
| **Princess Jellybean** | Region 3 (top) | purple | `#9013fe` | Your Knight always wins battles when attacking another Knight (not the castle foe). |
| **Grand Vizier Cheesecake** | Region 4 (left) | white | `#f0f0f0` | Treat Intel cards can be used to move to ANY special treat location. |
| **Deposed Queen Quiche** (the Unsweetened Nomads) | none | black | `#2c2c2c` | 5-player games only. Units start OFF the board and pick a region to enter the first time each moves. Always gains +3 influence (orange) and always gains +2 Intel. Cannot collect taxes. Starts with 0 sugar cubes and no secret objective. |

Only the first four factions are available in 2–4 player games. A 5-player game is always all four plus the Nomads.

Faction art (`docs/design/assets/sweet-*.jpg`): Milkshake is a duchess in a peach-and-cream ball gown holding a giant sundae; Fudge is a stout knight in fudge-square armor with a closed castle-turret helmet that hides his face, an orange sash and a chocolate sword; Jellybean is a small princess in a pink dress among green plants that grow candy; Cheesecake is a tall, thin, mustached old vizier in a brown coat and yellow vest holding cake on a plate; Quiche is not candy: a tomato-red queen in vegetable armor with a lettuce cape, a golden crown and a cheese sword. Each faction also has two small one-color icons (`docs/design/assets/treat-*.png`): its regional treat and its random treat (milkshake + ice cream cone, fudge cube + chocolate bar, jellybean + gummy bear, cheesecake slice + cupcake/cream puff, quiche + tomato).

---

## The Intel deck

One shared face-down deck of **80 cards**:

| Kind | Count | Breakdown |
|---|---|---|
| Single-color | 60 | 10 red, 10 orange, 10 yellow, 10 green, 10 blue, 10 purple |
| Double-color | 12 | 2 red-red, 2 orange-orange, 2 yellow-yellow, 2 green-green, 2 blue-blue, 2 purple-purple |
| Treat | 8 | one each: Milkshake, Fudge, Jellybean, Cheesecake, ice cream, chocolate bar, gummy bear, cupcake |

No physical card faces exist yet (the rulebook says only "Dextrous for card making"). What a card must show:

- **Single-color card**: one big color field and that color's action name. Playing it: move ONE of your units forward to the next space of that color, then optionally take the action.
- **Double-color card**: the same color shown twice (two fields or a "×2"). Playing it: move a unit to the next space of that color and optionally act, then do the same again — the same unit both times.
- **Treat card**: a picture of the treat and its name. Playing it: move ONE of your units directly onto that treat's space, wherever it is on the board this game. No color action. Cheesecake may instead send the unit to any treat space.

The six color actions (what the card lets you do after moving):

| Color | Action | Which unit it reads |
|---|---|---|
| Red | Battle / Capture / Attack the castle foe | Knight |
| Orange | Acquire influence: +0 at home, +1 / +2 / +3 by region distance, +5 in the castle; Nomads always +3; cap 5 | Leader |
| Yellow | Collect taxes from every rival with a unit in your home region (they pay your region's tax level in influence; those who cannot pay have those units sent home), then optionally raise your tax by 1 (costs 1 influence, max 3) | none (your home region) |
| Green | Either move normally, OR discard the card without moving to unlock playing unlimited Intel cards this turn | any |
| Blue | Collect Intel: draw cards equal to your Ambassador's region distance (+1 home, +2, +3, +2); Nomads always +2 | Ambassador |
| Purple | Enter the castle from the road or junction. A Knight entering fights the foe. A Leader entering claims the castle (if the foe is dead and nobody else is inside) | Leader or Knight |

Cards go to a face-up discard pile when played. Any time on your turn you may discard 4 cards (Fudge: 2) to take one card of any color from the deck.

**Intel tokens** (24, 4 per color) are a kept, guaranteed color. Buy one for 1 influence (max one of each color per player). Spend it later exactly like a single card of its color; it then returns to the shared supply.

---

## Objectives

### Public objectives — 5, printed face-up for all

Each player may score each one ONCE, the first time they qualify.

| Objective | Points | When checked |
|---|---|---|
| Have a unit in each opposing region, all on matching-color spaces | 3 | end of round |
| Have a unit in each opposing region, all on special-treat spaces | 3 | end of round |
| Defeat the foe in the castle | 3 | immediately |
| Capture a Leader | 1 | immediately |
| Have a Leader in the castle, uncontested for one full round | 1 | end of round |

For the Nomads (no home region, 3 units, 4 regions) the two area objectives instead read: all three of your units on same-color spaces / all three on treat spaces.

Physically these are tracked by 16 small markers (one per player per objective they have scored). Digitally: a 5-row grid with one marker column per player.

### Secret objectives — 12 cards, each worth 2 points

Dealt 2 per player at setup; keep 1, pass the other to the right. Scored immediately when completed, hidden until then.

1. Defeat a Knight in battle
2. Capture a Leader (a single capture scores either this OR the public objective, not both)
3. Capture an Ambassador
4. Raise taxes to 3
5. Spend 5 influence without using it (a deliberate throw-away, not a purchase)
6. Discard 5 Intel
7. Gain 5 Intel in one turn
8. Collect taxes from an opponent
9. Collect 5 influence in one turn
10. Move one unit through 3 regions in one turn
11. Discard 5 sugar cubes
12. Enter the castle with your Leader

A secret card needs a short title, the "2 points" value and one line of text. Only the owner sees the face; everyone else sees a face-down card.

---

## Foes and dice

**Sugar cubes are the dice.** Every sugar cube a player owns is a custom six-sided die with faces **0, 0, 0, 1, 2, 3** (three blanks). In a fight you roll one die per cube you own and add the pips. Average is 1 pip per cube.

**The foe.** At setup the table chooses ONE of three monsters to guard the castle:

| Foe | Dice rolled |
|---|---|
| Dragon | 5 |
| Orc | 3 |
| Fiend | 2 |

The foe piece sits in the castle. The rulebook suggests stacking its dice under the miniature to show how many it rolls — a good digital cue.

**When dice are rolled:**
- **Knight vs Knight** — when a Knight plays red in a region holding an enemy Knight, both roll their sugar cubes. Higher total wins; **ties go to the defender**. Jellybean's Knight skips the roll and simply wins when attacking.
- **Knight vs foe** — when a Knight enters the castle with purple, or plays red while already inside. The Knight rolls its cubes; the foe rolls its fixed dice. Higher wins, tie to the foe. A win kills the foe and scores 3 points. A loss costs nothing; the Knight stays and may try again.
- **First-player tie-break** — at the end of a round the player with the most sugar cubes becomes first player; a tie is settled by a roll-off.

Losing a fight does not remove a sugar cube. Cubes are only lost by trading, voluntary discard, or being spent (which the engine currently treats as "discard").

---

## Each player's area

Every player has a faction board and, digitally, a tableau. It holds:

| Item | Visibility | Contents |
|---|---|---|
| Intel hand | hidden (owner only) | a fan of cards; opponents see only the count |
| Secret objective | hidden (owner only) | 1 card face-down to others; 0 for Nomads |
| Influence | public | 0 to 5 |
| Sugar cubes | public | a pile; also the number of battle dice |
| Intel tokens | public | 0 to 6 colored discs, at most one per color |
| Points | public | 0 to 5 on the shared track |
| Public objectives scored | public | which of the 5 this player has already claimed |
| Units off-board | public | for the Nomads only; their three units before entry or after recall. For other factions, "home" is the start tile on the map, not a side pool. |
| Home region tax level | public | 0 to 3 (this is really a shared value per region, but it belongs visually next to the region's owner) |

The active player also has a turn step indicator (recall → play → influence).

---

## The shared area

| Item | Primitive | Notes |
|---|---|---|
| Intel deck | card zone, pile, face-down | show count only (starts at 80 minus 3 per player) |
| Intel discard | card zone, pile, face-up | show the top card and the count; reshuffled into the deck when the deck runs out |
| Public objectives | grid or tableau | 5 rows × N player columns of markers |
| Point track | track | 0 to 5, one marker per player |
| Tax trackers | 4 tracks | one per region, 0 to 3 |
| Intel token supply | pool | 4 discs per color; shrinks as players buy |
| Sugar cube bank | pool | 30 minus all cubes held |
| Foe | piece in the castle | shows name, dice count, alive/defeated |
| Random treat placement | labels on the 4 "?" slots | which tile sits where this game |
| Round number, first player marker, active player | badges | |

---

## A turn, step by step

Play goes round the table from the first player. A **round** ends when every player has had a turn; then scoring happens and the first player may change.

**Step 1 — Recall** (player decides). Choose any number of your units to send back to your start tile (Nomads: off the board). Usually none. Cannot be skipped as a step — "recall nothing" is a choice.

**Step 2 — Gain Intel** (automatic). You draw cards equal to your Ambassador's region distance from home: home +1, next +2, then +3, then +2. Nomads always +2. Digitally: a **Draw** button appears; the server deals the cards face-down into your hand.

**Step 3 — Play** (player decides — the heart of the turn). Play exactly ONE Intel card from your hand, or spend one Intel token, or pass. Playing a color card bundles several decisions into a single move, and the interface must ask them all before committing:

1. **Which card** (or which token).
2. **Which unit moves** — Leader, Knight or Ambassador. The card's action reads a specific unit (red → Knight, orange → Leader, blue → Ambassador), but you may legally move a different unit and take a pointless action, or move and skip the action.
3. **Ring or road?** — only asked when the unit would pass its region's junction before reaching the next space of that color. Road leads toward the castle.
4. **Take the action?** — yes or no.
5. **Yellow only: raise taxes?** — after collecting, spend 1 influence to raise your home tax by 1 (max 3).
6. **Red only: whom to capture** — Leader or Ambassador of which rival in the Knight's region. (Known defect: the engine currently picks an enemy Leader automatically; the choice is still worth drawing so the interface is ready when fixed.)
7. **Nomads only: entry region** — when the moving unit is still off-board.
8. **Treat card: which unit** goes to the treat space; **Cheesecake only: which treat space**.
9. **Green with action** — discarding the card instead of moving unlocks unlimited further plays this turn. The play step then stays open until the player stops.
10. **Double card** — the whole sequence (move, then action) runs twice with the same unit and same choices.

A red or purple play that fights the foe also needs the player to **Roll** (a button; the server rolls both sides). Blue's action opens another **Draw**.

Also allowed at any time during the play step: discard 4 cards (Fudge 2) for one of any color; discard sugar cubes; throw away influence; record a trade with another player (cards, tokens, sugar, influence, or swapping two units' positions — table-agreed, no limits).

**Passing** instead of playing gives +1 influence and ends the turn immediately.

**Step 4 — Influence** (player decides). Spend influence: 1 for an Intel token (one of each color max, while supply lasts), 3 for a sugar cube (while the 30-cube bank lasts). Then **End turn**.

**Automatic after every move**: secret objectives are checked and scored at once; the castle claim is re-evaluated (Leader inside, foe dead, nobody else inside → "uncontested" clock starts).

**End of round** (automatic): public area/castle objectives are checked in turn order; new first player = most sugar cubes (tie → roll-off); round counter +1. If anyone has 5 points, the game ends.

---

## Randomness and hidden information

| Element | Kind | Digital handling |
|---|---|---|
| Intel deck order | hidden, random | shuffled by the server; **Draw** button whenever the player owes a draw (turn start, blue action, setup) |
| Each player's hand | hidden from others | count shown to opponents; the owner sees faces |
| Secret objective | hidden from others | revealed only when scored (or at game end) |
| Knight-vs-Knight roll | random | **Roll** button; show both players' dice faces |
| Knight-vs-foe roll | random | **Roll** button; show the Knight's cubes and the foe's dice |
| First-player roll-off | random | automatic, but worth a small animation |
| Random treat placement | random at setup | once placed, public for the game |
| Secret objective deal | random at setup | each player sees only their own 2, keeps 1 |

Everything else — unit positions, taxes, influence, sugar, tokens, points, which public objectives are scored, who holds the castle — is fully public.

---

## Setup choices

1. **Faction** — each player picks one of the four (or five, at 5 players; one seat must be the Nomads). All distinct.
2. **Foe** — the table picks Dragon (5 dice), Orc (3) or Fiend (2). One shared decision.
3. **Secret objective** — each non-Nomad player is dealt 2, keeps 1, passes 1 to the right. Private.
4. **Starting Intel** — each player draws 3 (Draw button).
5. Random treat tiles are placed automatically; first player is assigned randomly.

---

## Mapping to the eight primitives

| Table object | Primitive | Detail |
|---|---|---|
| The board | **map** | nodes = the 80 spaces + 4 start tiles + castle; edges = the counter-clockwise sequence, the junction fork, the treat rejoin links; pieces = up to 15 units + 1 foe. Node fill = space color; road nodes get an arrow glyph. |
| Each player's area | **tableau** | stats: points, influence, sugar, hand count, tokens, home region, tax |
| Hand | **card zone — fan** | owner only |
| Intel deck | **card zone — pile** (face-down, count) | |
| Intel discard | **card zone — pile** (face-up top, count) | |
| Secret objective | **card** (face-down to others) | |
| Intel tokens owned | **card zone — row** or **pool** | colored discs |
| Points | **track** 0–5 | one marker per player |
| Region taxes | **track** 0–3 × 4 | or one small dial per region on the map |
| Public objectives | **grid** 5 × players | markers |
| Sugar cubes | **pool** | per player, plus the shared bank |
| Off-board units (Nomads) | **pool** | 3 pieces |
| Token supply, sugar bank | **pool** | shared |

**What the existing board code already does** (`viz/board.ts`): it draws the map as a plain 14 × 12 **grid** of colored cells (not a true map primitive), placing every ring/road/start/treat/castle cell at its (row, col) coordinate and dropping labeled unit pieces on them. It adds one 16-space **track** for taxes (4 regions × 0–3), two count-only **piles** for deck and discard, and one **tableau** per seat with stats, an Intel-token **row**, a secret-objective **row** (owner only) and a hand **fan** (owner only). Phase, round and foe status are text badges stuffed onto the castle cell. It does not draw the movement sequence, junction forks, treat rejoin links, the score track, the public objective grid, the sugar bank, the token supply, or the foe as a piece — those are all yours to design.

---

## Moments to animate

| Moment | What moves | Suggested cue |
|---|---|---|
| Card played | card leaves the fan, flips onto the discard pile | short slide + flip |
| Unit moves along the ring | piece hops space to space counter-clockwise, 1–6 hops, stopping on the matching color | pulse the destination in the card's color |
| Unit takes the road | piece turns inward at the junction purple and follows the arrows | highlight the junction, then the road |
| Unit enters the castle | piece slides from the road purple into the castle block | castle glow |
| Treat card | piece lifts and drops onto the treat space (often far away) | arc flight, treat icon bounce |
| Knight vs Knight battle | both players' sugar cubes tumble; totals compare; loser's unit is sent home | dice roll, then the captured piece flies back to its start tile |
| Knight vs foe | Knight's cubes and the foe's fixed dice roll; on a win the foe piece is removed and 3 points score | big moment — the foe falling should be the game's loudest animation |
| Capture | rival Leader/Ambassador flies back to its own start tile; +1 point (Leader) | |
| Castle taken / lost | castle border adopts the holder's color; a small "uncontested since round N" clock appears; it vanishes when anyone intrudes | |
| Taxes collected | influence chips fly from each rival in your region to you; anyone who cannot pay has units fly home | |
| Taxes raised | the region's tax track ticks up; 1 influence chip leaves the player | |
| Influence gained (orange) | chips appear on the player's tableau, capped at 5 | |
| Intel drawn | face-down cards slide from the deck into the fan (Draw button) | |
| Points scored | marker advances on the 0–5 track; the objective row lights up | |
| Recall | selected units fly home to the start tile (Nomads: off the board) | |
| Token bought / spent | disc moves supply → tableau, later tableau → supply | |
| New first player | first-player marker moves; sugar-cube count comparison shown | |

---

## Colors and names

### The six space colors, in cycle order

Sampled from the printed board image (these are the true printed values) alongside what the code currently uses:

| Order | Name | Printed (sampled) | Code (viz/board.ts) |
|---|---|---|---|
| 1 | red | `#ff004d` (a hot pink-red) | `#ff0000` |
| 2 | orange | `#ffa300` | `#ffa500` |
| 3 | yellow | `#ffec27` | `#ffff00` |
| 4 | green | `#00e436` | `#00ff00` |
| 5 | blue | `#29adff` (sky blue) | `#00bfff` |
| 6 | purple | `#83769c` (a muted slate-lavender — clearly the odd one out) | `#bf00bf` |

The printed palette is the classic PICO-8 palette. Note the printed "purple" is a dull grey-lavender on paper; the code makes it a loud magenta. Pick one and use it for both the spaces and the purple cards.

### Other board colors

| Element | Printed | Code |
|---|---|---|
| Page background behind the board | pale cyan graph paper `#c6e7ec` | `#ffffff` |
| Board background / empty cells | white `#ffffff` | `#ffffff` |
| Grid lines | black | `#000000` |
| Castle | empty white in print (no art yet) | `#555555` grey |
| Treat spaces | white with black icon (regional); dotted outline with "?" (random) | `#d8bfd8` thistle |
| Start tiles | white with region number | `#f0e68c` khaki |

### Faction colors (from code)

Milkshake `#f5a623`, Fudge `#8b5a2b`, Jellybean `#9013fe`, Cheesecake `#f0f0f0`, Nomads `#2c2c2c`. Two of these collide with space colors (Milkshake with orange/yellow spaces, Jellybean with purple in the code palette), so unit pieces need a strong outline or a shape that does not depend on fill color alone.

### Names to print

Factions: Arch Duchess of Milkshake · General Fudge · Princess Jellybean · Grand Vizier Cheesecake · Deposed Queen Quiche. Units: Leader · Knight · Ambassador. Foes: Dragon · Orc · Fiend. Treats: Milkshake · Fudge · Jellybean · Cheesecake · Ice Cream · Chocolate Bar · Gummy Bear · Cupcake. Resources: Intel · Influence · Sugar Cubes · Intel Tokens. The castle: Candy Castle. Regions: Region 1–4 (the rulebook's flavor names — Ice Cream Tundra, Chocolatier Forest, Gummy Glades, Mount Cream Puff, Unsweetened Desert — are unused by the engine but free to use as labels).

---

## Phone

This is the hardest of the four games to fit on a phone: an 80-space map, up to 5 players each with 3 units, a hand, two tracks, and a 5-row objective grid. Concrete advice:

**Keep the map square and let it own the screen.** The board is 14 columns × 11 rows, nearly square. At 400 px wide each cell is ~28 px — readable for color, too small for text. Drop the region numbers and arrows at that size; use the color and a thin road outline instead. Let the user pinch-zoom; when zoomed, show region numbers and unit labels.

**Never hide these while the map is up:**
- The active player's name and color, and the current step (Recall / Play / Influence).
- The one action button that matters right now (Draw, Roll, End turn, or the card being played).
- The player's own hand, as a thin strip of card edges along the bottom (color swatches are enough; tap to expand into a fan).
- Points for all players, as a one-line row of colored numbers.

**Collapse into tabs or sheets:**
- Opponents' tableaux (influence, sugar, tokens, hand count) → a single swipe-up sheet, one row per player.
- Public objective grid and secret objective → a second sheet or tab.
- Deck and discard counts → tiny badges on a corner of the map.
- Tax levels → small dials drawn on each region's start tile rather than a separate track.

**The play-a-card flow needs a stepper, not a form.** Tap a card → the map highlights where each of your three units would land (three ghost pieces) → tap a unit → if a junction is involved, two ghosts appear (ring / road) → tap one → a bottom bar asks "Take the [color] action?" with Yes / No (and "Raise taxes?" for yellow) → confirm. Each step replaces the previous, so the map is never covered by more than one bottom bar.

**Battles take over the screen** briefly: a modal with both sides' dice, the Roll button, then the result. This is the one moment the map may be fully hidden.

**Units must be readable at 28 px.** Use one glyph per unit type (crown = Leader, sword = Knight, scroll = Ambassador) in the faction color with a dark outline. When two or more units share a space, stack them with an offset and a count badge.

**Orientation.** Keep the same orientation on every device (Region 1 bottom). Do not rotate the board to face the local player — the counter-clockwise rule and the region numbers make rotation confusing.

**Landscape** is worth supporting: map on the left, hand and stepper on the right, opponents' rows along the far right edge.

---

## Reference images

All copied to `docs/games/sweetlands-imperium/`.

| File | Caption |
|---|---|
| `board-full.png` | The printed board, cropped and hi-res: 80 colored squares on graph paper, four regions round an empty center, road arrows, dotted "?" slots. |
| `page08-board.png` | Rulebook page 8 — the same board in page context with the "Faction art" heading below. |
| `page01-components.png` | Rulebook page 1 — component list and setup steps (note the card counts here are superseded by the code). |
| `page02-turn.png` | Rulebook page 2 — the turn structure and color actions as originally written. |
| `page06-color-key.png` | Rulebook page 6 — the six colors with their action names printed in color, plus the faction color assignments (yellow 1, brown 2, purple 3, white 4, black 5). |

No card faces, faction boards, tokens, sugar-cube dice, foe miniatures, or unit pieces exist as images. Those must be designed from the descriptions above.

---

## Sources

Rules and flavor:
- `C:\Users\zekes\Code\zekel\port\sweetlands-imperium\SWEETLANDS-RULES.md`
- `C:\Users\zekes\Code\zekel\port\sweetlands-imperium\sweetlands.txt`
- `C:\Users\zekes\Code\zekel\port\sweetlands-imperium\assets\Sweetlands-Imperium-1-page1.png` through `page13.png`
- `C:\Users\zekes\Code\zekel\port\sweetlands-imperium\pages\board-full.png`, `page-08-hi.png`

Engine (source of truth for counts and rules):
- `C:\Users\zekes\Code\zekel\src\games\sweetlands-imperium\types.ts`
- `C:\Users\zekes\Code\zekel\src\games\sweetlands-imperium\data\board.ts`
- `C:\Users\zekes\Code\zekel\src\games\sweetlands-imperium\data\factions.ts`
- `C:\Users\zekes\Code\zekel\src\games\sweetlands-imperium\data\intel.ts`
- `C:\Users\zekes\Code\zekel\src\games\sweetlands-imperium\data\objectives.ts`
- `C:\Users\zekes\Code\zekel\src\games\sweetlands-imperium\geometry.ts`
- `C:\Users\zekes\Code\zekel\src\games\sweetlands-imperium\views.ts`
- `C:\Users\zekes\Code\zekel\src\games\sweetlands-imperium\index.ts`
- `C:\Users\zekes\Code\zekel\src\games\sweetlands-imperium\choices.ts`
- `C:\Users\zekes\Code\zekel\src\games\sweetlands-imperium\legalMoves.ts`
- `C:\Users\zekes\Code\zekel\src\games\sweetlands-imperium\engine.ts`
- `C:\Users\zekes\Code\zekel\src\games\sweetlands-imperium\rng.ts`
- `C:\Users\zekes\Code\zekel\src\games\sweetlands-imperium\viz\board.ts`
- `C:\Users\zekes\Code\zekel\src\games\sweetlands-imperium\VIZ-NOTES.md`
- `C:\Users\zekes\Code\zekel\src\games\sweetlands-imperium\DATA_TEMPLATE.md`
