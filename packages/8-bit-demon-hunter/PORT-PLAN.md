# 8-bit Demon Hunter — MCP port plan

Port of the video game in `../8-bit-demon-hunter` to a text-only zekel game
module, `@zekel/8-bit-demon-hunter`, following the designer's conversion notes
in `8-bit-deamon-hunter-mcp-variant.md` and the rulings of 2026-10-20. Where
the notes are silent, the original game's code is the rule. Every feature of
the original is kept unless this plan says how it changed.

Rulings of 2026-10-20 (designer): combat math as written below; Evil Eyes have
range 5; running away always succeeds on your action; skeletons and knights also
attack when you run away; death works as in the original (stats reset, respawn
in the last town); 5–8 clearings; an enemy spawns only in clearings when its
entry says so, otherwise anywhere; leaving a temple mid-gauntlet resets it; a
failed riddle has no consequence; harness bot may read the hidden demon id.
Ruling 2026-10-20 (later the same day): clearings may hold up to **4** major
connections and every town attaches to a clearing (Q1 accepted).
Ruling 2026-10-20 (evening): the player starts at **speed 4** (agility picks
then run 4, 8, 12, 16, 20; cap 20). This answers most of Q9.
Rulings 2026-10-21 (after the designer's playtest): townsfolk know nothing
specific about the temples, the creatures inside or the magic items, only
that temples are very old and dangerous; the accusation is a **demon-killing
knife** (`stab`): face to face in the person's town, the wrong person dies and
the townspeople turn on you (loss); a **bomb hits everything** on the node it
is set off in.
Rulings 2026-10-21 (second playtest): the player holds **any number of
accepted tasks** at once and overlapping ones progress and complete together;
**the wild respawns** (enemies, plants, trees as generated) whenever the
player steps out of a town or temple, as the original's reload did; **temple
nodes get enemies and resources** like clearings; **temples are mysterious**:
entering says only that a treasure awaits, guardians are named only as they
appear, their count is never given, the item is named when the chest opens;
**enemies have no numbers**: nothing the GM reads states an enemy's HP, speed,
range or damage, only its condition in words and its behaviour; the **Lady
Bandits' black market is a secret** to discover: nothing states it, townsfolk
may only pass it on as a rumour, and buying is offered only after the player
has talked to a Lady Bandit and heard her offer.
Ruling 2026-10-21 (third): **asking around town** (`search_town`): who here
keeps a pet, likes a colour, follows a trade, owns an item, wants help with
something, or claims to know the truth; and a **contradictions** check that
compares the clue book's rumours against the secrets held and names who
said what. Whoever it turns up counts as met: cards and rumours are recorded (ruling, same day).
Ruling 2026-10-21 (fourth): **travel** in one go to a place, a person's town
or the nearest inn, hop by hop under the walking rules, with an **edge stop**
before any place whose occupants would attack on the way out (bandits,
skeletons, undead knights, a mushroom crowd the tail would complete); travel
again to go through. Quietly, `via_inn` with the shuckles lets the route pay
an inn cart between towns when that is shorter; it is not advertised.
Ruling 2026-10-21 (fifth): **known places**. Travel only accepts places the
player knows of, and the view lists only those temples: every town from the
start, as the original's minimap showed them, plus everywhere the player has
stood and everywhere a path leads from there. The Sky Temple behind its wall
counts as seen from the next clearing. Unknown and non-existent names get
the same refusal, so a refusal gives nothing away.
Ruling 2026-10-21 (sixth): **amounts**. Buying and selling one at a time was
tedious: `buy`, `sell` and `buy_from_bandit` take an `amount` (default 1,
or `all`), bounded by the stock, the purse and the pack; an amount past the
bound is refused with the bound. A Lady Bandit still vanishes after her one
deal, however large.
Rulings 2026-10-21 (seventh): a **bomb hurts you by 2** as well, and one that
would kill you is refused with a warning until sent with `confirm`; every
arrival outdoors (a move, stepping out of a town or temple, the end of a
travel) **says what is here** (enemies by count with ids, resources) so
nobody has to look each time; **undead knights spawn one per clearing**
(`onePerNode`), so a map with fewer eligible clearings has fewer knights.
Playtest 2 (seed 33, 2026-10-21) fixes: the bomb no longer prints enemy HP;
an edge stop part-way says where you stand; a stop is forgotten by any other
action (no stale "press on"); arrival text leads with the place; a cart from
the town you stand in enters once; the inn offers level-ups; "an Undead Knight".

Open questions for the designer are marked **Q** and collected in §12.
Build status is in §14.

---

## 1. Package shape

Mirrors `packages/warble-way-galaxy` (the other solo narrative game).

```
packages/8-bit-demon-hunter/
  package.json                 @zekel/8-bit-demon-hunter, peer @zekel/game-kit
  tsconfig.json
  LICENSE
  PORT-PLAN.md                 this file
  src/
    index.ts                   Game class: schemas, guidance, rules text, views
    types.ts                   State, nodes, people, moves
    data/
      enemies.ts               stats from the original gameConfig + range + behaviour
      registries.ts            item names, person names, town names, bindings, tips
      progression.ts           XP curve, stat caps, agility steps
      resources.ts             base values, drop chances, inn pricing
      magicItems.ts            the five temple items
      riddles.ts               one riddle per temple (answers hidden from views)
    world/
      graph.ts                 seeded graph builder (§3)
      puzzle.ts                demon / clues / tasks, ported from DemonLogic.ts
      populate.ts              enemies, resources, ore, inn prices
    engine/
      apply.ts                 move dispatcher
      movement.ts              look, move, leaving-node reactions, flight
      combat.ts                the 1v1 resolver (§5)
      town.ts                  talk, tasks, powers, inn, houses, bindings
      temple.ts                gauntlet, riddle, chest, sky wall
      items.ts                 bombs, harvest, magic items, level up, death
      finale.ts                the knife, arena, demon phases
    legalMoves.ts
    views.ts                   player view (hidden data stripped), clue book
    nextStep.ts                describeNextStep per pending kind
    ai.ts                      harness bot (§10)
    lore.ts + lore/*.md        get_lore topics from loreRegistry
    voice.ts                   GM report voice (never-hint contract)
    rng.ts                     seeded RNG (server-rolled; no physical mode)
    __tests__/
```

Wire-up: `examples/serve.mjs`, `scripts/smoke.mjs` expected list, root
`package.json` workspace dev-dep, README table (players: 1).

Blocked until the incoming `@zekel/game-kit` package lands: nothing here builds
or tests without it. Data and world code can be written first; the Game class,
views and next_step need the real types.

---

## 2. State

```ts
interface DemonHunterState {
  seed; rng;                       // server-held randomness
  phase: 'playing' | 'dead' | 'arena' | 'won' | 'lost';
  graph: { nodes: Record<NodeId, Node>; edges: Edge[] };   // §3
  player: {
    at: NodeId;                    // current major node
    inside: null | 'town' | 'temple';
    level, xp, strength, agility, range, hp, maxHp, pendingLevelUps,
    shuckles: 5, resources: {plant_fiber, wood, demon_powder, demon_ichor, iron_ore, gold},
    bombs, lockpicks, magicItems: TempleType[], flying: boolean,
    knownClues: Clue[], metPeople: PersonId[], activeTask: Task | null,
    follower: PersonId | null,     // escort in progress
    suspects: PersonId[],          // clue-book marks, max towns × 2
    unlockedHouses: PersonId[], bindings: string[], locksmithCharges: number,
    visitedTowns: TownId[], lastTown: TownId, worldCleared: boolean,
  };
  towns: Town[];                   // people, inn prices + stock, houses
  demonId; items: Item[];          // hidden
  enemies: Record<EnemyId, Enemy>; // attached to major nodes, with hp
  combat: Combat | null;           // §5
  temple: TempleRun | null;        // §7
  pending: Pending | null;         // what the player must answer now
  log: GameLogEntry[];
  result: { winner: 'player' | 'demon'; summary } | null;
}
```

Persisted sessions are plain JSON; no classes in state.

---

## 3. World generation (graph)

Major nodes: 5 towns, 5 temples (sky, earth, space, light, fire), and `C`
clearings with `C` drawn from 5–8 (option `clearings` overrides).

Connection rules from the notes: towns 1 connection; temples 1 connection, to a
clearing; clearings connect to anything.

**Finding (needs a ruling, Q1):** a town–town edge makes an unreachable pair
(both ends have degree 1), so every town must connect to a clearing. And with
clearings capped at 3 connections the slot count does not work out: a connected
set of `C` clearings uses `2(C−1)` slots on its own tree, leaving `C+2` for the
10 town/temple leaves, so only `C = 8` fits and then the map is a saturated
path. Recommendation: raise the clearing cap to **4** major connections (enemy
and resource nodes do not count). Then every value 5–8 works and there is room
for a loop or two.

Algorithm (seeded, deterministic):

1. Create `C` clearings; build a random spanning tree over them (degree ≤ cap).
2. Attach the 5 towns, then the 5 temples, each to a random clearing with a
   free slot; prefer spreading them so no clearing holds two temples.
3. With remaining slots, add 0–2 extra clearing–clearing edges (cycles) when
   possible.
4. Starting town = towns[0]; the player begins **inside** it (the original
   auto-enters the starting town). Its people carry game tips; every other
   town's people carry lore lines, exactly as `WorldGenerator` assigns them.
5. Compute hop distance from the start town's node for enemy placement.
6. **Sky Temple wall:** the edge clearing→sky temple is flagged `walled`; it
   cannot be traversed until a bomb is used at that clearing (§8). Flying does
   not bypass it (the original ring blocks flight too: "only land if not over
   rock").

Validation (tests): connected; degree rules; each temple reachable; sky edge
walled; 5 towns / 5 temples; `C` in range.

### Enemies

Each enemy is its own small node with one edge to a major node. Counts and
stats are the original `gameConfig.enemies` (slime 15, mushroom 20, snake 20,
wizard 10, skeleton 5, bandit pairs 10, undead knight 5). Bandits still spawn
as a Dude + Lady pair on the same node.

| Enemy | HP | XP | Speed | Dmg | Range | Spawns | Min hops from start | Behaviour |
|---|---|---|---|---|---|---|---|---|
| Slime | 2 | 1 | 1.0 | 1 | 1 | anywhere | 0 | passive; fights if attacked |
| Mushroom | 3 | 1 | 3.0 | 1 | 1 | anywhere | 0 | aggressive; follows; 5+ block leaving |
| Snake | 4 | 2 | 3.5 | 1 | 1 | anywhere | 1 | passive; 50% flee when damaged |
| Wizard | 5 | 3 | 1.5 | 1 | 3 | clearings | 2 | passive; flees when attacked, 50% teleport |
| Skeleton | 6 | 6 | 2.0 | 1 | 4 | clearings | 2 | aggressive; attacks when you leave or flee |
| Dude Bandit | 7 | 4 | 6.0 | 1 | 1 | anywhere | 2 | aggressive; attacks when you leave |
| Lady Bandit | 7 | 4 | 6.0 | 1 | 1 | anywhere | 2 | as Dude; sells bombs/lockpicks until attacked |
| Undead Knight | 20 | 15 | 8.0 | 1 | 1 | clearings | 3 | aggressive; attacks when you leave or flee |

Min hops is measured from the starting town's node (its clearing is 1) and
replaces the original tile distance (slime 10 … knight 45 on a 200 tile map);
when no node qualifies the farthest node is used. Only slimes and mushrooms
can be at the starting town. "Anywhere" means
towns and clearings (the outskirts of a town are the town node).

Temple enemies (one temple each, counts = original `max`): Bee 8 (hp 6, dmg 1,
spd 16), Man Eater Flower 6 (7, 2, 14), Arachne 5 (10, 2, 3), Evil Eye 6 (8, 2,
2.5, **range 5**), Fire Skull 8 (5, 2, 14). Others range 1 (Q2).

### Resources

Plant nodes 50 (hp 1, yields 1 plant fiber), tree nodes 20 (hp 4, yields 1
wood), spread over all major nodes. Ore deposits: **8** nodes on clearings
(Q3); the original's rock formations have no fixed count. The view groups
small nodes by type ("4 plants, 2 trees, 3 slimes") but each keeps an id so a
move can target it.

### Puzzle, people, tasks, prices

`puzzle.ts` is a straight port of `DemonLogic.generatePuzzle`,
`regenerateClues`, `generateTasks`, `checkConflict` and
`WorldGenerator.generatePeople` (minus sprites), using the seeded RNG instead
of `Math.random`. Per-town price multipliers 1–6 per resource; inn stock
`(7 − mult) × 10`, both fixed at generation.

---

## 4. Movement and the overworld

The player stands at a major node, outside or inside it. Moves:

- `look` — the node: type, name, connections (names, walled flag), enemies and
  resources grouped by type with ids, the follower, whether a Lady Bandit will
  trade. Always legal.
- `move {to}` — to an adjacent major node. Triggers leaving-node reactions
  (below). Arriving at a town or temple node leaves you outside it.
- `enter` / `leave` — town or temple interior.
- `attack {target}` — start combat with an enemy node, or harvest a resource.
- `talk_bandit`, `buy_from_bandit {item}` — Lady Bandit trade (§6).
- `bomb` — §8.
- `fly` / `land`, `teleport {town}`, `aura` — §9.
- `level_up {stat}` — any time a level is pending.
- `mark_suspect {person}` / `unmark_suspect`, `clue_book` (read-only view).
- `stab {person}` — the demon-killing knife; only inside a town, on someone there (§6).

**Leaving a node** (on `move`), in this order:

1. If not flying, each aggressive non-mushroom enemy at the node that is alive
   (bandits, skeletons, knights) blocks: the first one starts combat and the
   move is cancelled. After the fight (win or flee) the player is still at the
   node and may try again; the next blocker then triggers. Flying skips
   bandits and knights; a skeleton (range 4 ≥ 3) still attacks a flying player.
2. If 5 or more mushrooms are at the node and the player is not flying, one
   mushroom attacks (combat) and the move is cancelled; the rest keep
   following.
3. Otherwise the move succeeds and every mushroom at the node re-attaches to
   the destination node (they follow). Mushrooms follow a flying player too
   (they cannot be fought from the air with range < 3, but they also cannot
   block).
4. Walled edge (sky temple) → rejected with the reason until bombed.

Enemies otherwise stay put. **Q4:** should anything roam on its own between
nodes over time (the notes say "some enemies can move"); current reading is
only mushrooms (follow), wizards (teleport) and snakes (flee).

**World cleared bonus:** when the last overworld enemy dies the player gains
100 XP once, as in the original (temples and arena excluded).

---

## 5. Combat (1v1, server-resolved)

`combat = { enemyId, round, playerActed, freeAttackDone, log }`. The player
always chooses; the enemy's action is automatic.

Order per combat:

1. **Range:** at the start of combat the side with the higher range gets one
   free attack (player per the notes; enemy symmetrically, Q5). Equal range:
   nothing.
2. **Speed:** the faster side acts first (player agility vs enemy speed; ties
   go to the player). An action is attack or run away. Attacks always hit.
   Attacks per action = `max(1, floor(own speed ÷ opponent speed))`.
3. The other side acts.
4. If nobody fled and both live, repeat from step 2 (the range bonus is once
   per combat per the stat description; Q5 covers the alternative reading).

Damage: player deals `strength` per attack; enemy deals its `damage` (1 for
overworld, per table for temple, 2 for the demon). Health = hits to take.

Player actions: `fight`, `flee`. Running away always succeeds; skeletons and
knights get one attack as you go (ruling). After fleeing the player is still at
the node.

Enemy actions:

- Slime, mushroom, bandits, skeleton, knight, temple enemies, demon: attack.
- Snake: if damaged this combat and alive, 50% flee (combat ends; the snake
  moves to a random adjacent major node), else attack.
- Wizard: never attacks. When attacked and alive it flees at once: 50% teleport
  to a random other clearing, else to an adjacent node. (So a wizard dies only
  to a one-action kill or a bomb, which keeps "kill 2 wizards" a real task.)
- Bees/flowers/skulls charge: no special rule, their speed already gives them
  multiple attacks.

The pending kind `combat_turn` carries both sides' HP, speeds, attacks per
action and what the enemy will do, as `facts.notes`, so the GM can relay it.

Death: HP ≤ 0 → phase `dead`, pending `continue`. `continue` resets level 1,
XP 0, strength/agility/range 1, max HP 3, full HP, clears pending level-ups,
ends combat/temple/arena, and respawns inside `lastTown`. Everything else is
kept (clues, items, shuckles, resources, bindings, magic items, task progress,
follower). Identical to the original's Continue button. Dying in the arena
returns to the world; stabbing it again later starts a fresh arena.

---

## 6. Towns (interior)

`enter` at a town node → `inside = 'town'`, town marked visited, `lastTown`
set, escort task completed if its target is this town (original `loadWorld`
check — works for walking, inn ride and cape).

People: 10 per town, listed by name and occupation; attributes (pet, colour,
item, town) and rumour shown on `talk`, exactly as the original dialogue
panel; tip or lore line shown on every talk. Talking records the bad clue in
the clue book automatically. With the Eye of Truth, `talk` flags demon and
minions as liars (the original's red rumour).

`talk {person}` returns the dialogue state and sets a pending with the same
branches as `DialogueUI.show`:

- Find-task match → `found_you` completes the active find task.
- Giver of the active, completed task → `claim_reward {clue|power}` (choice
  only if they hold a good clue; minions "confess" instead). Clue = good + bad
  clue recorded. Power = occupation power (table below).
- Giver of the active, incomplete task → progress line, nothing to do.
- Task already done → thanks / minion taunt.
- Otherwise → offer: `accept_task` (replaces the current task if any) or
  `decline`. Accepting a magic-item task the player already satisfied completes
  it at once.

Occupation powers, ported from `triggerOccupationPower`: Farmer (have you met
the demon), Musician (minion count in this town), Barber (introduces 1–5
unmet people: marks met, records their rumours), Tailor (liars in this town →
special clue), Mayor (+1 gold), Merchant (+50 shuckles), Soldier (+20 XP),
Blacksmith (free stat pick → pending `level_up` flagged free), Carpenter (a
"demon is not in X" clue for a town not yet ruled out), Locksmith (+1 locksmith
charge).

Escort tasks: `accept_task` on an escort sets `follower`; the person leaves
their town's roster until delivered; on arrival the person's `townId` changes
and clues regenerate (`regenerateClues`, the original's escort/complete).
Followers take no damage.

Inn (`inn` to open; pending `inn_menu`): `sleep` 5 shuckles full heal (only
when hurt), `train` 50 → +20 XP, `ride {town}` 50 → move straight to any town
(follower comes along), `buy {resource}` at `ceil(base × mult × 1.5)` while
stock > 0, `sell {resource}` at `base × mult`; stock moves by one each way.

Houses: `search_house {person}`. Locked unless unlocked; unlocking needs a
locksmith charge (consumed) or a lockpick (consumed; the original asks to
confirm, which becomes a `confirm: true` field). A minion's house yields the
next binding name from `bindingNameRegistry`; others "nothing of note". A
searched house stays searched.

The knife: `stab {person}`, inside a town, on anyone there (or the follower).
The wrong person dies in front of their town and the townspeople turn on you:
`lost`, game over. The right one drops its disguise: arena (§9). (Replaces
the original's clue-book accusation, designer ruling 2026-10-21.)

Escorting the demon: the original's design doc says location clues must
update but its code never did; the port rewrites every town clue when the
demon moves (`engine/clues.ts`): the secret "The demon is in X" follows it,
an honest "not in <new town>" becomes "not in <old town>", and a liar's "not
in <old town>" becomes "not in <new town>", in the clue book too. The
original's "take the demon's item" API is unused by its client (items became
occupation favours), so it is not ported.

---

## 7. Temples (interior)

`enter` at a temple node → `inside = 'temple'`, pending `temple_choice`:
`gauntlet` or `riddle`. A temple already completed shows an empty hall.

Gauntlet: `temple = { kind: 'gauntlet', remaining: N }` with `N` the temple
enemy's count; fights one enemy at a time via §5 (`next_fight` starts each).
Temple enemies drop demon ichor. `leave` (or death) discards the run; next
entry starts at `N` again. Clearing the last enemy opens the chest.

Riddle: pending `riddle` with the riddle text; `answer_riddle {text}` compares
a normalised answer (lowercase, punctuation and articles stripped) against the
accepted answers. Wrong → "the door does not open", may try again or take the
gauntlet. Right → chest. Answers never appear in any view; the GM relays only
the riddle text. Five lore-grounded riddles (Memlax, Chineera, the rebellion,
the five artifacts, the five barren places) to be drafted in `riddles.ts` for
the designer's review (`TODO` in the notes).

Chest: grants the temple's magic item, completes a matching active
`FIND_ITEM` task, and returns the player outside. Sky Temple: its edge is
walled; bomb it from the adjacent clearing first (§8).

---

## 8. Bombs, harvesting, resources

Bombs: Lady Bandit sells them (10 shuckles) and lockpicks (200); after any
purchase she leaves the node (original removes her). Attacking a Lady Bandit
ends trading with her. Fire Bombs (fire temple) = unlimited. `bomb` is legal
only outdoors at a major node, one per action, and hits everything there
(ruling 2026-10-21):

- Every enemy at the node takes 5 (kills wizards and slimes outright).
- Every ore deposit at the node shatters, each rolling ore (10% gold, 40%
  iron ore, else nothing) — the original's rock-wall roll.
- Every plant and tree at the node burns to nothing (no yield).
- At the clearing next to the Sky Temple: the walled edge opens, with an ore
  roll of its own.

Harvest: `attack {plant|tree}` deals `strength` per action; at 0 HP it yields
its resource. Each harvest action has a 10% chance to pull one aggressive enemy
at the node (bandit, skeleton, knight, mushroom) into combat.

Drops: overworld enemies except bandits drop 1 demon powder; temple enemies 1
demon ichor; plants fiber; trees wood.

---

## 9. Magic items, progression, finale

- **Winged Boots** (sky): `fly` / `land` outdoors. While flying: bandits,
  knights and mushrooms cannot block or attack; skeletons can (range ≥ 3). The
  player may attack from the air only with range ≥ 3, and an enemy with range
  < 3 cannot hit back. Entering a town or temple lands you. The walled sky edge
  still blocks.
- **Aura of Protection** (earth): `aura` in combat ends the fight with no
  parting attacks (the ruling that aura is a guaranteed escape); outdoors it
  lets the next `move` ignore blockers once. No attacking while it is up.
- **Cape of Teleportation** (space): `teleport {town}` to any visited town,
  arriving inside; heals to full as the original does (Q7).
- **Eye of Truth** (light): passive, §6.
- **Fire Bombs** (fire): unlimited bombs.

Levelling: XP thresholds `[4, 8, 16, 32, 64, 128, 256, 512, 1024]`, max level
10; a level is banked and `level_up {stat}` spends it whenever the player
likes. +1 strength (cap 5), +1 range (cap 5), +1 max HP with full heal (cap
10), agility +4 (starts 4: 8, 12, 16, 20; cap after 4 picks). Blacksmith gives a free
pick without consuming a level.

Finale: stabbing the demon → phase `arena`, pending `combat_turn` against The
Demon: HP `max(1, 20 − 3 × bindings) × strength`, speed 8, range 3, damage 2.
Phase 2 at ≤ 2/3 HP (once): three random overworld enemy types at 10 HP each
are fought one at a time, then the demon resumes. Phase 3 at ≤ 1/3 HP: the
demon's attacks per action +2 (the triple shot). Killing the demon → `won`.
Dying → §5 death rules.

---

## 10. MCP surface

- `id: '8-bit-demon-hunter'`, 1 player, `hasHiddenInformation: true`, always
  digital (no physical components; the server rolls everything), `supportsAI`
  for the harness only.
- `optionsSchema`: `seed`, `clearings` (5–8).
- `moveSchema`: `oneOf` over every move in §4–§9.
- `getPlayerView` strips: `demonId`, `isDemon`, `isMinion`, good clues not yet
  earned, riddle answers, house-owner minion status, attributes of unmet
  people, inn stock of unvisited towns. A leak test asserts none of these
  strings appear in the serialised view for a generated world.
- `describeNextStep`: one branch per pending kind (`free`, `combat_turn`,
  `dialogue`, `inn_menu`, `temple_choice`, `riddle`, `level_up`, `continue`,
  `game_over`), each with `human_response` and `facts` that pass the
  nextStepFacts lint.
- `getSessionStartGuidance`: GM contract like Warble's, plus the notes' rule:
  **never give the player hints or tell them what to do unless they explicitly
  ask**; relay `look` and combat facts exactly; keep the demon's identity out
  of narration even if the GM could infer it; ground colour in `get_lore`.
- `getRulesText` / `getRulesSections`: player-facing rules derived from this
  plan. `getReferenceData`: enemy table, progression, prices, magic items.
- `getScoreboard` / `getLog`: XP, level, clues known, bindings, temples done.
- Lore: `loreRegistry` split into topics (the demon, Memlax and Chineera, the
  rebellion, the artifacts, the towns, monsters); exposed through the same
  `ExtraTool` mechanism as Warble, as `get_demon_hunter_lore` (Warble's tool
  is `get_lore`; MCP tool names are global to a server, so the name differs).

Harness bot (`ai.ts`, deterministic, no randomness): reads the hidden demon
id. Policy: hunt the slimes (and, once fast enough, mushrooms) on nodes it can
afford to leave again (a node is walkable when fighting its blockers costs
less HP than it has, counting a bomb it holds or can buy there); heal at an inn
when it can pay; otherwise grind: cut plants and trees, sell everything, pay
the inn for training; spend levels keeping health within two of strength; when
a node's blockers cost too much, buy a bomb from the Lady Bandit and bomb them;
march on the demon's town only once a real fight estimate says it survives a
bandit pair, avoiding undead knights; when nothing safe is left or it is strong enough,
walk to the demon's town and stab it; after three deaths it stabs
a met innocent, ending the game. It exists so `scripts/smoke.mjs` and the
harness can run the game to `game_over`; on the 12 test seeds it loses every
time at level 1, which is a statement about early-game lethality (Q9), not
a goal of the bot.

---

## 11. Tests

- `graph.test.ts`: invariants of §3 over 200 seeds; sky edge walled; hop
  distances respected.
- `puzzle.test.ts`: ported invariants — one demon, 2 minions per town, unique
  occupations per town, unique items, exactly 5 good clues one per town, every
  liar's clue contradicts the truth, merchants hold escort tasks, no task
  conflicts; escort moves a person and regenerates clues; taking the demon's
  item makes the item clue say "nothing".
- `combat.test.ts`: order of operations, attacks-per-action table, range
  bonus, ties, flee rules, snake/wizard reactions, death reset.
- `movement.test.ts`: blockers, mushroom following and the 5+ rule, flying
  exceptions, walled edge, world-cleared bonus.
- `town.test.ts`: every dialogue branch, each occupation power, inn pricing
  and stock, houses and bindings, knife outcomes.
- `temple.test.ts`: gauntlet reset on leave, riddle normalisation, chest and
  task completion, sky wall.
- `viewLeak.test.ts`, `nextStepFacts.test.ts`, `solvability.test.ts` (bot
  reaches game over on N seeds within a move cap).

---

## 12. Open questions (Q)

1. ~~Town–town edges isolate both towns; clearing cap of 3 only works at
   exactly 8 clearings.~~ **Accepted:** clearings cap at 4 major connections,
   every town attaches to a clearing.
2. Temple enemy ranges: Evil Eye 5 (ruled); bee, flower, arachne, fire skull
   = 1?
3. Ore deposits: 8 across the clearings?
4. Does any enemy roam between nodes on its own over time?
5. Range free attack: once at the start of combat (stat text) or every round
   (loop text)? And does an enemy with higher range (skeleton, eye, demon) get
   the same free attack against the player?
6. ~~One ore deposit per bomb?~~ Superseded: a bomb hits everything on the node (ruling 2026-10-21).
7. Keep the original's full heal on cape teleport?
8. Enemy counts stay the original's (~95 overworld enemies over ~11 major
   nodes, 8–9 per node; generated worlds show up to ~18 on the farthest
   clearings). Keep and tune after play, or scale down now?

9. **Early lethality.** A new player (3 HP, agility 1) dies to one action of
   a mushroom (speed 3 → 3 hits), a bandit (6), a skeleton (2 + its opening
   shot) or anything faster, and there is no dodging in text. In the original
   the player could outrun or kite these. The start town and its clearing
   hold only slimes, mushrooms and snakes, but mushrooms follow the player
   home. Options: make the first agility pick cheaper, start at 5 HP, cap an
   enemy's attacks per action at 2 or 3 until the player's first level, or
   accept it as the game's "hard start". The harness bot's three deaths per
   game come from this. **Ruled:** starting speed is 4, so a mushroom (3)
   gets one hit per action and the player strikes first against anything
   slower than 4.
11. **The finale cannot be won without bindings.** Demon HP is
    (20 − 3 × bindings) × strength, so with no bindings it always takes
    exactly 20 of your hits whatever your strength, while it deals 2 per hit
    at speed 8 (one or two hits per action against any agility below 16; two
    of yours per action only at 16+). With health capped at 10 the arena is
    lost before 20 hits land; the harness bot reaches the demon at level 7
    with full health and dies every time. In the original the player dodged
    projectiles in real time; in text there is no dodge. Every binding takes 3
    × strength off, so five bindings make it a 5-hit fight. Options: keep it
    as the design (bindings are the point: find minion houses) and make that
    clearer in tips and lore; lower the base multiplier; give the arena a
    heal; or cap the demon at a flat HP. Also worth asking: lockpicks at 200
    shuckles each and one Locksmith favour per town make five bindings a long
    road.
10. **Attack semantics.** `attack <enemy>` both opens the fight and takes the
    player's first swing (so a slow player eats the faster enemy's first
    action and its reply before choosing again). Alternative: `attack` only
    declares the fight and the first `fight`/`flee` is a separate choice.

Assumptions taken unless overruled: Q2 yes, Q3 8, Q4 no, Q5 once and
symmetric, Q6 yes, Q7 yes, Q8 keep, Q9 as is, Q10 as built.

---

## 13. Milestones

1. **Data + world**: §1 data files, graph builder, puzzle port, populate;
   tests for §3 invariants and the puzzle. (Can start before game-kit lands.)
2. **Core loop**: state, look/move/enter/leave, combat resolver, leaving-node
   reactions, harvest, death; views and next_step for these.
3. **Towns**: dialogue, tasks, powers, escort, inn, houses, bindings, the knife.
4. **Temples, items, finale**: gauntlet, riddles, chest, bombs and sky wall,
   magic items, levelling, arena.
5. **GM layer**: guidance, rules text, lore topics, report voice, reference
   data, leak and facts tests.
6. **Harness bot + wire-up**: ai.ts, solvability test, serve/smoke/README.

---

## 14. Status (2026-10-20, evening)

Built, tested and verified through the real server once `@zekel/game-kit`
0.1.0 was installed:

- `pnpm build` (`tsc -b packages/*` under a POSIX shell) clean; this package
  17 suites / 96 tests; whole repository 126 files / 1277 tests green;
  `scripts/smoke.mjs` SMOKE OK (seven games, the human seat gets a directive,
  the lore tool answers); `scripts/human-seat-sweep.mjs` SWEEP OK on seeds
  5/6/7.
- The post-port runbook was executed as far as this repo allows; the record
  is `POST-PORT.md` next to this file (what ran, what could not, the verdict).
- Served hooks: rules sections (`rulesSections.ts`), choice catalog
  (`choices.ts`), balance axis `world_seed`, the `get_demon_hunter_lore` tool
  (11 topics, two of them written for the GM).
- Conversations are played, not read (designer, 2026-10-20 evening): every
  person carries a seeded persona (`data/personas.ts`: temperament, manner,
  quirk, worry, a reason for their task, lore hooks); `talk` returns a GM
  BRIEF and "Gist:" lines that the GM voices in its own words; the player may
  ask anything and the person answers from the brief and the lore, or does
  not know. Facts (rumour meaning, task terms, attributes) stay exact and
  talking records nothing. Lore expanded to 11 topics including
  `running-a-conversation` and `what-nobody-knows` for the GM.
- Balance finding from the bot (seed 7): a player at 1 HP pinned by a
  mushroom crowd with no money and no inn reachable can only fight and die to
  get out; `continue` frees them, so not a soft-lock, but worth a look.

Deviations from the original worth knowing (all noted inline): unique person
names world-wide; find tasks never self-conflict; the knife works only face to face in town;
escort relocates the demon's town clues; hops measured from the start town;
clearings allow 4 links; combat `attack` includes the first swing; starting
speed 4.
