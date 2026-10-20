# Adventurer Olympics — Rules

Design doc for the port. Built from the draft rulebook
`port/adventurer-olympics/Adventurer Olympics.pdf` (7 pages, including the table
photo on page 6 and the companion-card photo on page 7) plus the designer's
rulings of 2026-09-27. Where this doc and the PDF disagree, this doc wins.

Rules change 2026-09-30 (designer): "Complete 2 dungeons" and "Recruit 2
companions" became end-of-game quests, "Most dungeons" and "Most companions".
Explore 3 tiles is still claimed the moment someone gets there.

All names and symbols on cards and tiles are placeholders for now.

- **Players:** 2–4
- **Goal:** complete the most quests.

---

## 1. Components

| Component | Count | Notes |
|---|---|---|
| Map tiles | 10 | Each tile is 7 hexes: one centre hex and one on each of its six sides. |
| Quest cards | 6 | Card backs show a star. |
| Companion cards | 16 | |
| Dungeon cards | 24 | |
| Little Monster cards | 12 | |
| Big Monster cards | 12 | |
| Artifact cards | 5 | Hearts, Spades, Diamonds, Clubs, and the Star. |
| Initiative tokens | 4 | Marked 1, 2, 3, 4. |
| Player tokens | 10 per colour | Red, blue, yellow, purple. |
| Player standees | 4 | |
| Six-sided dice | 8 | |

The full contents of every deck and every tile are in §10 and §11.

---

## 2. Setup

1. Shuffle the Quest, Companion, Dungeon, Little Monster and Big Monster decks
   separately. Put them where everyone can reach them. Leave a big space in the
   middle of the table for the map.
2. Put the 5 artifact cards face up beside the decks. This is the artifact supply.
3. Each player chooses an Adventurer standee and a colour, and takes the 10
   tokens of that colour.
4. Draw **number of players + 1** Quest cards and place them face up where
   everyone can see them. These are the only quests in this game. Put the rest
   of the Quest deck back in the box.
5. Shuffle the 10 map tiles face down into a stack. Turn the top tile face up
   and place it in the middle of the map area. This is the **starting tile**. It
   has no player token on it.
6. Every player places their standee on the centre hex of the starting tile.

### Starting stats

Every player starts with:

- **Charisma 1**
- **Strength 1**
- **Movement 2**

Companions raise these stats (§6.1). Stats never go down.

---

## 3. Winning

- Each quest you claim is worth **1 quest point**.
- At the end of the game, the player with the most quest points wins.
- If players tie for the most points, they share the victory.

---

## 4. A round

Each round has two parts.

### 4.1 Roll for turn order

Every player rolls 2 dice. The highest total goes first, then the next highest,
and so on. Players who tie roll again to settle their places. Hand out the
initiative tokens (1, 2, 3, 4) to show the order.

### 4.2 Take turns

In turn order, each player takes one turn (§5). When everyone has had a turn,
the round ends and a new round begins with a new roll for turn order.

---

## 5. Your turn

On your turn you may move, and while you move you may explore. Your turn ends
when any of these happens:

- You have used all your steps, or you choose to stop.
- You step onto a hex with an icon that has not been completed. The icon
  triggers (§6) and your turn ends right after it is resolved, even if you had
  steps left.
- You explore (§5.3). Exploring uses up all your remaining steps.

### 5.1 Moving

- You may take **up to** as many steps as your Movement. You may choose not to
  move at all.
- Each step moves your standee to an adjacent hex. You may step back onto a hex
  you already passed through this turn.
- You may **not** enter or pass through a hex with another player's standee on
  it. Go around them. (The only time standees share a hex is at the start of the
  game, on the starting tile's centre hex.)
- Stepping onto a hex with an icon that has **not** been completed triggers it
  immediately, even in the middle of a move (§6). You cannot walk through an
  uncompleted icon; you must go around it if you don't want to trigger it.
- An icon with a player token on it has been completed. That hex is plain ground:
  you can walk over it or stop on it, and nothing happens.

### 5.2 Staying to try again

If you start your turn standing on an icon hex that is **not** completed (because
you failed it on an earlier turn), you may stay and try again instead of moving.
The icon triggers again as if you had just stepped on it, with a fresh card from
the top of the deck. Your turn ends after it is resolved.

While you stand there, no one else can use that icon, because no one can enter
your hex.

### 5.3 Exploring

You may explore when both of these are true:

- You have **at least one step left** this turn (taken or not — a player who has
  not moved yet has all their steps).
- You are standing on a hex that touches an empty **tile slot** (see "How tiles
  fit together" below).

To explore:

1. Take the top tile from the map tile stack and turn it face up.
2. Place it in an empty tile slot that touches the hex you are standing on.
3. Turn the tile to face any way you like (6 options).
4. Put one of your tokens on the new tile's centre hex. This marks that you
   explored it.
5. Your remaining steps are used up and your turn ends. You do **not** get to
   step onto the new tile this turn.

If the map tile stack is empty, you cannot explore.

#### How tiles fit together

Tiles always sit in a fixed pattern. Each tile has six **sides**. A side is the
gap between two neighbouring outer hexes:

- N–NE
- NE–SE
- SE–S
- S–SW
- SW–NW
- NW–N

Each side is a **tile slot**. A tile placed in a slot nestles against those two
outer hexes, so every new tile always touches the map with at least two hexes.
There are no gaps or holes in the map.

Each outer hex belongs to two sides. So a player standing on an outer hex can
explore into up to two slots: the empty ones among that hex's two sides. The
centre hex touches no slot, so you can never explore from a centre hex.

### 5.4 Forced explore

If **every icon on the map has been completed**, the next player to take a turn
must explore at the **start** of their turn, before moving:

1. Take the top tile from the stack.
2. Place it in **any** empty slot touching the map, turned any way.
3. Put one of your tokens on its centre hex.
4. Then take the rest of your turn as normal (move, explore again if you can,
   and so on).

"The next player" can be the first player of the next round, if the icons were
all completed on the last turn of a round. If the tile stack is empty, there is
no forced explore (the game is already ending, see §9).

---

## 6. Icons

When you step onto an uncompleted icon (or stay on one to try again), it
triggers. Resolve it, then your turn ends.

**If you succeed**, put one of your tokens on that icon's hex. The icon is now
completed and can never trigger again.

**If you fail**, nothing is placed. The icon stays open. You may stay on it next
turn and try again (§5.2), or walk away. Anyone may try it later.

| Icon (placeholder art) | What happens |
|---|---|
| Square buildings — **City** | Recruit a companion (§6.1). |
| Round buildings — **Dungeon** | Draw a Dungeon card and resolve it (§6.3). |
| Angry face — **Little Monster** | Fight a Little Monster (§6.2). |
| Skull — **Big Monster** | Fight a Big Monster (§6.2). |
| Card suit or star — **Artifact** | Take that artifact (§6.4). |

### Rolling

Every test works the same way: roll a number of dice equal to one of your stats
and **add up all the pips**. If the total is **equal to or higher than** the
number on the card, you succeed.

### 6.1 City — recruit a companion

1. Draw the top Companion card. Note its number (top right).
2. Roll dice equal to your **Charisma**.
3. **Success:** you recruit the companion. Keep the card in front of you. Its stat
   bonuses are added to your stats for the rest of the game.
4. **Fail:** put the companion card at the bottom of the Companion deck.

### 6.2 Little Monster and Big Monster — fight

1. Draw the top card from the matching deck (Little Monster or Big Monster).
   Note its number.
2. Roll dice equal to your **Strength**.
3. **Success:** you defeat the monster. Keep the card in front of you. It counts
   toward quests.
4. **Fail:** put the monster card at the bottom of its deck.

**If the deck is empty** (defeated monsters are kept, so the Little Monster deck
can run out), there is nothing to fight. On a map icon, nothing happens, the icon
stays open, and your turn ends. Inside a Dungeon, the card gives you nothing
(§6.3).

### 6.3 Dungeon

Draw the top Dungeon card and do what it says. When you are done with it,
whatever happened, put it at the bottom of the Dungeon deck.

| Dungeon card | What happens | The Dungeon is completed when… |
|---|---|---|
| **Little Monster** | Fight a Little Monster (§6.2). | You defeat it. |
| **Big Monster** | Fight a Big Monster (§6.2). | You defeat it. |
| **2x Little Monsters** | Fight two Little Monsters, one at a time. If you lose the first, you don't fight the second. You keep any monster you defeat. | You defeat **both**. |
| **Companion** | Recruit a companion (§6.1). | You recruit it. A failed recruit fails the Dungeon. |
| **Any artifact** | Take any one of the four suit artifacts (Hearts, Spades, Diamonds, Clubs) from the supply **or from another player**. You may decline. | You take an artifact. |
| **Map** | Explore (§5.3), but place the tile in **any** empty slot touching the map, not only one touching your hex. | You place the tile. |

Monster and Companion cards drawn inside a Dungeon follow the normal rules: keep
them on a success; put them at the bottom of their deck on a failure.

#### Drawing again when a Dungeon card gives you nothing

If a Dungeon card gives you nothing, put it at the bottom of the Dungeon deck
and draw another. Keep going until you draw a card you must resolve. A card
gives you nothing when:

- **Any artifact** — you choose to decline it, or there is no suit artifact you
  could take (you already hold all four).
- **Map** — the map tile stack is empty.
- **Little Monster** or **Big Monster** — that monster deck is empty.
- **2x Little Monsters** — the Little Monster deck is empty before the first
  fight. If you beat the first monster and the deck is then empty, keep the
  monster you beat; the card gives you nothing more, so draw again.

This always ends: the Dungeon deck always contains Companion cards and Big
Monster cards, and those decks never run out. Only a win removes a card, and
each icon can be won once: at most 8 companions (3 Cities + 5 Dungeons) and
8 Big Monsters (3 skulls + 5 Dungeons) can ever be won, against decks of 16
and 12.

If you fail the card you end up resolving, the Dungeon is not completed. You may
stay and try again next turn with a fresh Dungeon card (§5.2).

### 6.4 Artifact hexes

There is no roll. Take the matching artifact card from **wherever it is** — the
supply, or another player. Then put your token on the hex. The hex is completed
and can never be used again.

If you already hold that artifact, you keep it, and the hex still takes your
token and is completed.

### 6.5 Artifacts

- There are 5 artifacts: **Hearts, Spades, Diamonds, Clubs** and the **Star**.
- An artifact can change hands:
  - Stepping on its map hex takes it from whoever holds it (only once per hex,
    since the hex is then completed).
  - An "Any artifact" Dungeon card can take any of the four **suit** artifacts
    from the supply or from any player.
- **The Star** can only be taken from its own map hex (Tile 6). An "Any artifact"
  card can never take it. Since its hex is used up once taken, whoever takes the
  Star keeps it for the rest of the game.
- All 5 artifacts count toward the "Most artifacts" quest. The Star has no other
  effect.

---

## 7. Stats

Your stat is your starting value plus the bonuses on every companion you have
recruited.

| Stat | Starts at | Used for |
|---|---|---|
| Charisma | 1 | Dice rolled to recruit companions. |
| Strength | 1 | Dice rolled to fight monsters. |
| Movement | 2 | The most steps you can take on your turn. |

---

## 8. Quests

Only the quests turned face up at setup (players + 1 of them) are in play.

### Claimed the moment someone achieves it

The **first** player to achieve this takes the card and scores 1 point.
Nobody else can claim it after that.

| Quest | What counts |
|---|---|
| **Explore 3 tiles** | Tiles with your token on the centre hex. Every way of placing a tile counts: exploring, a Dungeon Map card, and a forced explore. The starting tile never counts. |

### Scored at the end of the game

At the end of the game, the player with **strictly the most** of the thing named
takes the card and scores 1 point. **If players tie for the most, no one gets
the point.**

| Quest | What counts |
|---|---|
| **Most dungeons** | Dungeon hexes with your token on them. |
| **Most companions** | Companions you hold at the end, from Cities or from Dungeons. |
| **Most Little Monsters** | Little Monster cards you defeated, from icons and from Dungeons. |
| **Most Big Monsters** | Big Monster cards you defeated, from icons and from Dungeons. |
| **Most artifacts** | Artifact cards you hold at the end, the Star included. |

---

## 9. Ending the game

The game ends when the **last map tile is placed**, whether by exploring, by a
Dungeon Map card, or by a forced explore:

1. Finish the current round as normal.
2. Play **one more full round** (with a new roll for turn order).
3. The game is over. Award the end-of-game quests (§8), then count quest points
   (§3).

If the last tile is never placed, the game does not end. The designer has
accepted this: it only happens if nobody chooses to explore.

---

## 10. Card lists

### Quest cards (6)

1. Explore 3 tiles
2. Most dungeons — end of game
3. Most companions — end of game
4. Most Little Monsters — end of game
5. Most Big Monsters — end of game
6. Most artifacts — end of game

### Companion cards (16)

Number to beat | bonus. Checked against the photo on page 7 of the PDF: the
person icon is Charisma, the sword is Strength, the boot is Movement.

| # | Number | Bonus |
|---|---|---|
| 1 | 2 | +1 Strength |
| 2 | 2 | +1 Strength |
| 3 | 2 | +1 Charisma |
| 4 | 2 | +1 Strength, +1 Charisma |
| 5 | 6 | +3 Charisma, +3 Movement |
| 6 | 4 | +3 Movement |
| 7 | 2 | +1 Strength, +1 Movement |
| 8 | 6 | +4 Movement |
| 9 | 4 | +3 Charisma |
| 10 | 2 | +1 Movement |
| 11 | 2 | +1 Movement |
| 12 | 2 | +1 Charisma |
| 13 | 4 | +3 Strength |
| 14 | 4 | +2 Strength, +2 Movement |
| 15 | 6 | +4 Strength |
| 16 | 6 | +4 Charisma |

### Little Monster cards (12)

Numbers to beat: 4, 3, 4, 3, 3, 2, 2, 2, 2, 4, 3, 4
(four each of 2, 3 and 4).

### Big Monster cards (12)

Numbers to beat: 5, 5, 7, 7, 7, 6, 5, 7, 6, 6, 6, 5
(four each of 5, 6 and 7).

### Dungeon cards (24)

| Card | Count |
|---|---|
| Little Monster | 6 |
| 2x Little Monsters | 2 |
| Big Monster | 3 |
| Companion | 6 |
| Any artifact | 4 |
| Map | 3 |

### Artifact cards (5)

Hearts, Spades, Diamonds, Clubs, Star.

---

## 11. Map tiles

Each tile's hexes are named C (centre), N, NE, SE, S, SW, NW. Positions below are
the tile's printed orientation; the explorer can turn it any way when placing
it. No tile has an icon on its centre hex. Hexes not listed are blank.

| Tile | Icons |
|---|---|
| 1 | SW: City · NE: Dungeon |
| 2 | NW: Clubs · N: Dungeon · S: Little Monster |
| 3 | NW: Big Monster · NE: Hearts · SW: City |
| 4 | SW: Little Monster · NE: Big Monster |
| 5 | SW: Little Monster |
| 6 | N: Little Monster · S: Big Monster · SW: **Star** |
| 7 | NW: Dungeon · S: Diamonds · NE: Little Monster · SE: Little Monster |
| 8 | NW: Little Monster · N: Spades · NE: Dungeon |
| 9 | N: Little Monster · S: City |
| 10 | SW: Little Monster · NE: Little Monster · SE: Dungeon |

Changes from the PDF:

- **Tile 2** says "Spade" in the PDF, but the photo shows Clubs. Clubs is right;
  otherwise Spades would appear twice and Clubs never.
- **Tile 6** gains the Star at SW (designer addition, 2026-09-27).

Icon totals across the map: 10 Little Monster, 3 Big Monster, 3 City,
5 Dungeon, 5 artifact (26 in all).

---

## 12. Notes for the port

These are not rules. They are what the port needs to know about how the game
plays on a real table with the server keeping track.

### What is hidden, and who handles it

- **Every deck is shared and drawn face down:** Quest (only at setup), Companion,
  Dungeon, Little Monster, Big Monster, and the map tile stack. No player ever
  holds a secret hand: every card drawn is resolved face up at once, and
  everything a player keeps (companions, monsters, artifacts) sits face up in
  front of them.
- The physical decks are on the table, so the human draws the real cards. The
  report-a-draw pattern fits (the shared helper in `@zekel/game-kit`,
  `reportHand`): the human reports what was drawn, and the server
  tracks what it can. The server knows where failed and skipped cards go (the
  bottom of their deck).

### Dice

- The human rolls their own dice and reports the total: turn-order rolls, the
  roll-offs, and every test.
- The server rolls for AI players.

### Choices that belong to the player (never make them for the human)

- Which standee and colour (setup).
- Their whole move: which path, how far, and whether to move at all.
- Whether to explore, which slot, and which way to turn the tile.
- Whether to stay on a failed icon and try again.
- For an "Any artifact" card: which artifact, and from whom — or to decline and
  draw again.
- For a Dungeon Map card or a forced explore: which slot anywhere on the map, and
  which way to turn the tile.

### The map

- The server must know exactly where every hex is, because movement, blocking
  and triggering all depend on it. The human will need a simple way to report
  where they put a tile, such as "side NE–SE of tile 4, with its N hex pointing
  south-west". The port plan should settle the exact form.
- 7-hex tiles fit together in a fixed pattern, but it comes in two mirror-image
  versions. The first tile placed next to the starting tile decides which one
  the table is using. The port should pick one and show it in a picture in the
  setup instructions, so the physical map always matches the server's.

### Player tokens

Each player has 10. A player uses one per tile explored and one per icon
completed. The designer is keeping 10 for now; running short is very unlikely.
The port should still handle a player with no tokens left, and ask the designer
what happens if it ever comes up.

### Final art

The Star artifact and the Quest card backs both show a star. The final art will
need different symbols. This doesn't affect the rules.
