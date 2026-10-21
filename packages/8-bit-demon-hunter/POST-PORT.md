# Post-port verification — 8-bit Demon Hunter (solo text detective RPG)

Verification record + living maintenance reference per the engine repo's
`docs/post-port-runbook.md`, executed 2026-10-20 on this package. The game has
**no physical copy**: every zone is server-tracked, every die is the server's,
and "the table" is the player view. Steps that need the engine repo's harness
scripts (§2a executable rules, the repo-wide choice-coverage check, the
desync and balance gates, `check-summaries`) are recorded as **not run** with
the local stand-in that was run instead. The verdict (§13) is stated to that
standard, not rounded up.

## 1. Provenance & sources

- **Canonical rules:** the designer's conversion notes
  `8-bit-deamon-hunter-mcp-variant.md` (repo root, 2026-10-20) and the rulings
  of 2026-10-20 logged in `PORT-PLAN.md` (header + §12). Where both are
  silent, the **original game's code** is the rule.
- **Reference implementation:** `xephoid/8-bit-demon-hunter` at commit
  `6bcf8bcbd88228d47a27893ec957a9de833fd95b` (2026-03-11, "Added loading
  screen"), checked out at `../8-bit-demon-hunter`. Cited files:
  `server/src/services/DemonLogic.ts` (puzzle, clues, tasks),
  `server/src/services/WorldGenerator.ts` (people, tips, spawn rules, temples),
  `server/src/config/gameConfig.ts` (every number),
  `server/src/index.ts` (escort/accuse API), `client/src/main.ts` (combat,
  powers, inn, houses, bindings, death, arena, kill-all, drops),
  `client/src/ui/DialogueUI.ts` (every dialogue branch),
  `client/src/data/dialogue.ts` (power texts), `client/src/engine/EntityManager.ts`
  (enemy behaviour), `README.md` + `CLAUDE.md` (design rules).
- **Design doc of the port:** `PORT-PLAN.md` (§1–§14).
- **Framework:** `@zekel/game-kit` 0.1.0 / `@zekel/mcp` 0.1.0 (installed
  2026-10-20; first full build and smoke the same day).

## 2. Zone categorization, view completeness, hidden zones vs the move list

### Zones (from the `types.ts` header)

| Zone | Category | Verified |
|---|---|---|
| Graph, towns, inn prices/stock, enemies, resources, player sheet, combat, temple run, arena, dialogue, inn flag | Public, server-tracked | ✓ all in `DemonHunterState`; the view (§1a) carries them |
| `demonId`, `Person.isDemon`, `Person.isMinion` | **Hidden by rule** (the mystery) | ✓ never in any view (`viewLeak.test.ts`) |
| `Person.clues.good` | Hidden until earned (then a clue-book entry) | ✓ `viewLeak.test.ts` "never contains … an unearned secret" |
| Riddle answers (`data/riddles.ts`) | Hidden by rule | ✓ `viewLeak.test.ts` "never contains a riddle answer" |
| `seed` | Internal (server RNG) | exempt |

No physical zones; no shared hidden deck; no human-owned randomness. The
report-then-deal flow is N/A.

### §1a View completeness (table-reconstruction test)

Classification of every field of `DemonHunterState` and where the view
(`views.ts getView`) delivers it, structured:

| Field | Class | In the view as |
|---|---|---|
| `graph.nodes` / `edges` (walled) | public | `here.id/name/kind`, `here.paths[{to,name,kind,walled}]`; every town `towns[{id,name,node,visited}]`; every temple `temples[{id,name,item,completed}]` |
| `enemies` at the player's node | public, by appearance only | `here.enemies[{type,name,count,ids[],condition[]}]` (ids = the `attack` target language; never hp/speed/range/damage) |
| `resources` at the node | public | `here.resources[{kind,name,count,ids[]}]` |
| `player.*` (position, inside, flying, auraUp, level, xp, stats, caps, shuckles, resources, bombs, lockpicks, locksmith favours, magic items, bindings, deaths, worldCleared) | private-known | `you.*` (every field) |
| `activeTasks` + each task's progress | private-known | `you.active_tasks[{giver,giver_id,town,description,progress,completed}]` |
| `followers` | private-known | `you.travelling_with[]` + `people[].travelling_with_you` |
| `towns[].people` | public (name, trade) / private-known once met (pet, colour, item, town, rumour, task, truth-knower) | `here.people[]` in town; `clue_book.people_met[]` anywhere; unmet cards carry name/trade/met only (`viewLeak.test.ts` "unmet people show only name and occupation") |
| `towns[].prices` / `stock` (current town) | public | `here.inn.trade[{resource,name,sell_price,buy_price,inn_stock,you_have}]`, `services` |
| `knownClues`, `suspects`, `bindings` | private-known | `clue_book.{clues[{text,kind}],suspects,max_suspects,bindings}` |
| `combat` | public, enemy by appearance only | `combat.{enemy{id,name,condition},round,your_attacks_per_action,it_is_faster_than_you,it_strikes_from_further_than_you,it_can_reach_you,you_can_attack,can_flee}` |
| `temple` | public, treasure and guardians hidden until met | `here.challenge{mode,riddle}`, `here.treasure` ('unknown' until taken) |
| `arena` | public | `arena{demon_condition,minions_summoned,minions_left}` |
| `dialogue`, `innOpen` | public (tokenless) | `dialogue{with,person_id,stage}`, `inn_open` |
| `phase`, `result` | public | `phase`, `result` |
| Eye of Truth verdict | private-known (only with the item) | `people[].lying` (absent without the item) |
| `Person.persona`, `Person.tip` (story) | public once met (how they come across, what they tell) | `people[].persona{temperament,manner,quirk,worry,lore_topics}`, `people[].story`, `people[].task.why` |

Indices/ids: the view uses exactly the ids the move language takes (`move.to`
= node id, `attack.target` = enemy/resource id, `talk.person` = person id).
Locked by `__tests__/viewCompleteness.test.ts` (7 tests) and
`__tests__/viewLeak.test.ts` (5 tests).

### §1b Hidden zones vs the move list

Nothing the player owns is hidden from the server, so no move depends on a
zone the server cannot read. Every move type is offered by `getLegalMoves` in
some reachable situation (`__tests__/choiceCoverage.test.ts`), and every
offered move is accepted by the engine (`__tests__/legalMoves.test.ts`
"allAccepted" in six situations). The one fill-in move, `answer_riddle`, is
offered as a template whose description says to fill in the text; the engine
judges it.

## 3. Mechanics traceability matrix

Two-pass walk. Pass 1 enumerated every rule of the designer's notes, the
rulings, and the original's design rules (`CLAUDE.md`/`README.md` of the
original) without reading the port. Pass 2 flipped each row with a code
pointer and a test. Key: `eng/` = `src/engine/`, `w/` = `src/world/`, tests
are `src/__tests__/*.test.ts` by name. **Every row is `implemented`** unless
marked out-of-scope.

### The world (notes §World, rulings Q1/Q3/Q9)

| Rule | Code | Test |
|---|---|---|
| World is a bidirectional graph of towns, clearings, temples; enemies/resources are small nodes with one link to a major node | `w/graph.ts buildGraph:57`; `types.ts Enemy.at / ResourceNode.at` | graph "is connected, with the degree rules, for 200 seeds"; populate "spawns the original counts…" |
| Towns: one connection, to a clearing (ruling: town–town impossible); temples: one connection, to a clearing; clearings ≤ 4 major links (ruling) | `buildGraph:57` steps 1–3; `data/progression.ts CLEARING_MAX_LINKS` | graph "degree rules" |
| 5 towns, 5 temples, 5–8 clearings (`options.clearings`) | `buildGraph:57`; `w/generate.ts:17` | graph "honours an explicit clearing count and rejects an out-of-range one" |
| Enemy counts = the original's; bandits in Dude+Lady pairs; wizard/skeleton/knight only in clearings; hop-distance minimums from the start town (replaces tile distance) | `w/populate.ts populateEnemies:43, spawnNodesFor:30`; `data/enemies.ts` | populate "spawns the original counts…", "keeps each type at least its minimum hops…", "keeps the starting town free of anything but slimes and mushrooms" |
| 50 plants, 20 trees anywhere; 8 ore deposits on clearings (Q3) | `w/populate.ts populateResources:77` | populate "places plants and trees…" |
| Inn prices 1–6 per resource per town; stock (7−mult)×10 | `w/populate.ts populateInns:107`; `data/resources.ts initialStock` | populate "prices every inn 1..6…" |
| Sky Temple ring: its edge is walled until bombed | `buildGraph` step 3 (`walled: temple === 'sky'`); `eng/movement.ts move:23` | graph "walls only the Sky Temple edge…"; movement "rejects moves … through the sky wall" |
| Player starts inside the starting town with 5 shuckles and base stats | `w/generate.ts:17` | populate "starts the player inside the first town…" |
| "Look" always works | `eng/apply.ts case 'look':46+`; `eng/describe.ts lookText:52` | movement "look describes the node…" |
| Some enemies move between major nodes: mushrooms follow, wizards teleport, snakes flee (Q4: nothing roams on its own) | `eng/movement.ts move:23` (follow); `eng/combat.ts wizardFlee:241`, snake branch of `enemyAction:193` | movement "mushrooms follow…"; combat snake/wizard tests |

### The mystery (original design rules)

| Rule | Code | Test |
|---|---|---|
| 10 people per town; one of each of 10 occupations per town; 6 colours; 15 pets; unique item per person; unique names (port) | `w/puzzle.ts generatePeople:33, generatePuzzle:90` | puzzle "has one demon, two minions per town, ten people per town, unique occupations per town, unique items" |
| One demon; 2 minions per town | `generatePuzzle:90` | same |
| 5 good clues (town, occupation, colour, pet, item), one per town, held by innocents, true | `regenerateClues:142` | puzzle "spreads exactly five good clues…" |
| Everyone else gets a true negation rumour | `regenerateClues` bad-clue pool | same |
| Demon and minions always lie (negation of the truth) | `regenerateClues` liars block | puzzle "makes the demon and every minion lie" |
| Rumour recorded on first meeting; truth-knowers say "I know the truth!" | `eng/town.ts talk:45, personCard:35` | town "shows the card, records the rumour…", "a truth-knower says so…" |
| Tasks: kill N (one per overworld type, counts per config), find person by occupation/pet/colour, escort per town, find magic item; merchants always escort; exactly one truth-knower offers a magic item; no self-conflicts (port tightening) | `w/puzzle.ts generateTasks:249, checkConflict` | puzzle "gives everyone a task; merchants escort; exactly one good-clue holder offers a magic item; no self-conflicts" |
| Tips in the starting town, lore elsewhere | `generatePuzzle` step 5 | puzzle "hands out game tips in the starting town and lore everywhere else" |
| Escorting the demon updates the location clues (design rule the original never coded) | `eng/clues.ts relocateDemonClues:9`; `eng/movement.ts arriveInTown:84` | town "escorts: … escorting the demon moves the location clues" |
| Taking the demon's item (`/api/item/take`) | **out-of-scope**: unused by the original client (item rewards became occupation favours) | — |

### Townsfolk, tasks, rewards, powers (DialogueUI / main.ts)

| Rule | Code | Test |
|---|---|---|
| Find-task match (id, occupation, pet, colour, item) → "you found me" | `eng/town.ts talk` branch 0, `foundYou:131` | town "find tasks: the matching person says…" |
| Active task giver: completed → reward; incomplete → progress line | `talk` branch 1 | town "completing a task…" |
| Reward: clue (good + bad recorded) or power; truth-knower chooses, others get power | `claimReward:185` | town "completing a task…", "claiming a clue from someone without one is refused" |
| Minion whose task you finish confesses instead | `talk` minion branch | town "a minion whose task you finish confesses" |
| Already-helped lines (innocent / minion taunt) | `talk` branch 2 | town "completing a task…" (Thanks again) |
| Offer: accept (replaces current; escort sets follower; magic item already held completes at once) / decline | `acceptTask:142, declineTask:170` | town "shows the card…"; temple "a find-item task completes…" (chest path) |
| All ten occupation powers as the original | `occupationPower:205` | town "each occupation power does what the original did" |
| Eye of Truth flags demon/minions when talking | `personCard:35`; `views.ts personView` | town "the Eye of Truth flags liars"; viewLeak "with the Eye of Truth…" |
| Escort completes on entering the target town by any means; person moves house | `arriveInTown:84`; `w/puzzle.ts movePersonToTown:405` | town escorts test (via teleport); inn ride uses the same path |
| The knife: `stab` only inside a town, on someone there; the wrong person dies and the town turns on you (loss) | `eng/finale.ts stab` | finale "stabbing an innocent loses the game; the knife only works face to face in town" |

### Inn, black market, houses, bindings

| Rule | Code | Test |
|---|---|---|
| Sleep 5 (full heal, only when hurt); train 50 → 20 XP; ride 50 to any town; buy ceil(base×mult×1.5) while stocked; sell base×mult; stock moves ±1 | `eng/town.ts innOpen:286 … innLeave:368` | town "sleep, train, buy, sell and ride with the original prices" |
| Lady Bandit sells bomb 10 / lockpick 200 unless attacked; leaves after a sale | `eng/items.ts talkBandit:157, buyFromBandit:165` | movement "the Lady Bandit trades until attacked, then vanishes after a sale" |
| Houses locked; Locksmith favour (consumed) or lockpick (consumed, confirm) opens one; minion house → next binding name; once per house | `searchHouse:378` | town "locked without a lockpick or locksmith; a minion house yields a binding once" |
| Demon HP = max(1, 20 − 3×bindings) × strength | `eng/finale.ts demonHp:15` | finale "demon HP follows the binding formula" |

### Enemies and combat (notes §Enemies/§Combat; rulings)

| Rule | Code | Test |
|---|---|---|
| Stats from the original + range (wizard 3, skeleton 4, Evil Eye 5, demon 3, else 1) | `data/enemies.ts` | populate counts/hp; temple "the Evil Eye has range 5" |
| Higher range → one free attack at the start (symmetric, Q5) | `eng/combat.ts startCombat:41` | combat "higher player range…", "a faster enemy acts first; higher enemy range…" |
| Faster side acts first; ties to the player; sides alternate | `startCombat` + `playerFight:84`/`enemyAction:193` | combat slime/skeleton tests |
| Attacks per action = max(1, floor(speed ÷ other)) ; always hit; player dmg = strength, enemy dmg = table | `helpers.ts attacksPerAction:121`; `playerHits:125`, `enemyHits:177` | combat "attacks per action…", "speed multiplies attacks…" |
| `attack` opens the fight and takes the first swing (Q10) | `eng/apply.ts case 'attack'` | combat slime test |
| Run away always succeeds; skeleton/knight get one parting attack (ruling) | `playerFlee:99` | combat "fleeing always works; skeletons and knights take a parting shot" |
| Snake: 50% flee when damaged and alive, to a neighbour | `enemyAction` snake branch | combat "a wounded snake flees half the time (seeded)" |
| Wizard: waits; flees when hit; 50% teleport to another clearing | `enemyAction` wizard branch; `wizardFlee:241` | combat "a wizard waits, then runs when hit…"; "a strong enough player kills a wizard before it can run" |
| Blockers (bandits, skeletons, knights) attack when the player leaves; mushrooms follow; ≥5 mushrooms attack on leaving | `eng/movement.ts move:23` | movement "bandits block leaving…", "mushrooms follow; five or more attack…" |
| Flying: blockers/knights/mushrooms cannot reach; range ≥3 enemies (skeleton) still attack; attack from the air needs range ≥3; enemies with range <3 cannot hit a flier | `move` flying branch; `playerFight`/`enemyHits` flying checks | movement "flying passes bandits and knights but a skeleton still shoots…" |
| Kill payout: XP; drops (powder except bandits; ichor from guardians); kill-task progress; world-cleared +100 once | `killEnemy:263` | combat "kill tasks progress…", "clearing the last overworld enemy pays the 100 XP bonus once"; temple gauntlet test (ichor) |
| Death: stats and level reset, everything else kept, respawn in the last town (original Continue); arena dissolves; temple guardians cleared | `die:313`; `eng/items.ts continueAfterDeath:131` | combat "a knight … death resets stats but keeps the rest"; finale "dying in the arena dissolves it" |
| Player speed starts 4 (ruling), +4 per pick to 20 | `data/progression.ts STAT_BASE/STAT_STEP/STAT_MAX` | combat "levelling…" |

### Resources, bombs, levelling, magic items

| Rule | Code | Test |
|---|---|---|
| Plant 1 HP / tree 4 HP harvested by attacking (strength per swing); yields; 10% per swing to draw an aggressive enemy | `eng/items.ts harvest:19` | movement "harvesting: a plant in one swing, a tree in four, with a seeded chance of trouble" |
| Bombs: need one unless Fire Bombs; hit everything on the node: every enemy by 5, every ore deposit shatters (10% gold / 40% iron each), every plant and tree burns, the walled Sky edge opens | `eng/items.ts bomb` | movement "bombs: need a bomb unless you hold Fire Bombs; hit everything here…" |
| XP curve 4…1024, max level 10; +1 strength/range/health (full heal) or +4 agility; caps 5/5/10/20; Blacksmith free pick | `levelUp:111`; `helpers.ts canLevelUp:84` | combat "levelling: xp past the curve…" |
| Winged Boots fly/land; Aura (escape in combat / pass blockers once outdoors; no attacking); Cape (visited towns, heals, Q7); Eye; Fire Bombs | `eng/movement.ts fly:127, land:136, auraOutdoors:143, teleport:151`; `eng/combat.ts auraEscape:114` | movement aura/cape tests; combat "refuses to attack … while the aura is up" |

### Temples and the finale

| Rule | Code | Test |
|---|---|---|
| Enter: gauntlet (guardian count, one at a time) or riddle; chest → item + find-item task; already taken → empty hall | `eng/temple.ts enterTemple:14, startGauntlet:39, nextFight:46, startRiddle:62, answerRiddle:73`; `eng/rewards.ts grantMagicItem:7` | temple "entering offers gauntlet or riddle…", "the gauntlet is the guardian count…", "a find-item task completes when the chest is opened" |
| Leaving mid-gauntlet resets it (ruling); a fled guardian waits | `eng/movement.ts leaveInterior:110`; `nextFight` | temple gauntlet test; "a fled guardian is still there…" |
| Riddle: normalised answer match; wrong answer free (ruling); answers never shown | `data/riddles.ts`; `answerRiddle` | riddles suite; viewLeak "never contains a riddle answer" |
| Wrong stab → loss; right → arena at once (no escape, no aura) | `eng/finale.ts stab`; `combat.ts playerFlee/auraEscape` arena refusals | finale suite |
| Arena: demon speed 8 / range 3 / dmg 2; phase 2 at ⅔ HP summons 3 random overworld types at 10 HP fought one at a time; phase 3 at ⅓ HP +2 attacks; kill → win | `combat.ts playerHits` phase-2 block, `arenaContinue:157`, `enemyAction` boss line | finale "the right accusation starts the arena; the demon summons minions at two thirds; killing it wins" |

### The GM (notes "Important notes for the LLM")

| Rule | Code | Test |
|---|---|---|
| Townsfolk know nothing specific about temples, their creatures or the items (designer, 2026-10-21) | lore `the-temples` (GM-only section), `the-five-artifacts`, `monsters`; guidance §4b; conversation guide | lore suite; personas suite |
| Any number of accepted tasks, overlapping ones progress together (2026-10-21) | `types.ts activeTasks/followers`; `eng/town.ts findTasksMatching, acceptTask`; `eng/combat.ts killEnemy`; `eng/movement.ts arriveInTown`; `eng/rewards.ts` | questsAndRespawn "many tasks at once" (3 tests) |
| The wild respawns on leaving a town or temple; ore and the opened ring stay (2026-10-21) | `helpers.ts respawnOverworld`; `eng/movement.ts leaveInterior`; `state.initialEnemies/initialResources` | questsAndRespawn "the wild respawns" (2 tests) |
| Temple nodes have enemies and resources (2026-10-21) | `w/populate.ts spawnNodesFor` | questsAndRespawn "temples have company" |
| Temples are mysterious: "a treasure awaits", guardians named only as they appear, no counts, the item named at the chest (2026-10-21) | `eng/temple.ts enterTemple`; `combat.ts killEnemy` gauntlet lines; `views.ts`; `nextStep.ts`; rules "Temples" | temple suite; viewCompleteness "temple and riddle…" |
| Enemies have no numbers in anything the GM reads: condition words and behaviour only (2026-10-21) | `helpers.ts condition`; `combat.ts`; `describe.ts`; `views.ts`; `legalMoves.ts`; `nextStep.ts`; rules "Enemies"; guidance §6b; reference data | viewCompleteness combat/outdoors (no hp/speed/range/damage keys); combat suite strings |
| The black market is a secret: nothing states it, buying offered only after talking to a Lady Bandit (2026-10-21) | `player.blackMarketKnown`; `eng/items.ts talkBandit`; `legalMoves.ts`; rules; guidance §4c; lore `monsters`, conversation guide | legalMoves "outdoors…" (buy hidden before, offered after); movement Lady Bandit test |
| Never give hints unless asked | `guidance.ts SESSION_START_GUIDANCE` §3; every `nextStep.ts` instruction ends with the rule | lore "the guidance forbids hints…"; summaries suite (facts lint) |
| Conversations are played, not read (designer, 2026-10-20 evening): every person has a seeded persona and a task reason; `talk` returns a GM BRIEF plus "Gist:" lines; the GM improvises, facts stay exact; talking records nothing | `data/personas.ts`; `w/puzzle.ts generatePuzzle` step 6; `eng/town.ts characterBrief`; `nextStep.ts` conversation directive; guidance §2b; lore `running-a-conversation`, `what-nobody-knows` | personas suite (4 tests) |
| The GM never learns the demon | view stripping (§2) | viewLeak suite; sweep (§13) |

## 4. Edge-case catalog

1. **A pool runs out**: names (96 for 50 people), items (64 for 50), tips (10
   for 10, wraps), lore (44 for 40), task pool (49 for 50 → generic kill task
   fallback), clearing names (12 for ≤8), binding names (10 for ≤10 minions,
   then "Demon Binding N"). All bounded by construction; puzzle suite.
2. **No legal move**: never — `look` is always legal, and every situation
   offers at least one other move (summaries suite asserts >1 over 12 full
   games). Dead → `continue`; game over → none by design.
3. **Simultaneous game-end**: impossible — `won`/`lost` are set by exactly one
   path each (`arenaContinue`, `stab`); later moves are refused (`GAME_OVER`).
4. **Empty zones**: a node with no enemies/resources renders "No enemies
   here"; a temple with no guardians left opens the chest at once; a Barber
   with nobody unmet introduces 0 people; a Carpenter with no town left says so.
5. **Extremes**: 0 HP after an opening attack (guarded, `startCombat`); demon
   HP floor 1; agility cap 20 vs speed 1 = 20 attacks; stock 0 refuses buys;
   suspects capped at towns×2.
6. **Player count**: exactly 1; `createSession` rejects others.
7. **Pending hygiene**: see §8.
8. **Death mid-escort / mid-task**: follower and task progress are kept (the
   original keeps them too); death in the arena deletes arena foes; death in a
   temple deletes guardians and the run.
9. **Teleport / inn ride while escorting**: the follower arrives too and the
   escort completes if it was the destination (`arriveInTown`).
10. **Leaving a node with 5+ mushrooms while flying**: they cannot block a
    flier; they still follow.
11. **Pinned by a mushroom crowd with no way to heal** (found by the bot on
    seed 7): with 1 HP, no shuckles and no inn reachable, every attempt to
    leave starts a fight the player can only flee from. The way out is to
    fight and die (respawn in town at full health), as the original's death
    flow intends. A balance note (§13), not a soft-lock: `continue` always
    frees the player.

## 5. Design choices — forced vs discretionary

**Forced by the text port (no physical copy):** all randomness is the
server's (seeded, replayable); the world is a graph, not tiles; "range" is a
new stat for enemies; combat is turn-based with the notes' order of
operations; `attack` includes the first swing (Q10); a single-connection
town cannot link to another town (graph arithmetic, Q1); hops replace tile
distance.

**Discretionary readings (flagged ⚠ in `PORT-PLAN.md` §12):** range free
attack once per combat and symmetric (Q5); temple guardians other than the
Evil Eye have range 1 (Q2); 8 ore deposits (Q3); nothing roams on its own
(Q4); one deposit per bomb (Q6); the cape heals (Q7, the original does);
enemy counts unchanged (Q8); hunters' parting shot is ONE attack, not a full
speed-multiplied action; a wizard never counter-attacks; find tasks never
self-conflict; the knife works only face to face in town; escort relocates the
demon's town clues (the original's design doc, not its code).

## 6. Choice catalog

Owner + how-surfaced are this gate's; AI policy and balance axis are the other
gates'. Source of truth: `src/choices.ts` (served by `getChoiceCatalog`). The
engine repo's generator (`scripts/choice-catalog.ts`) is not available in this
repo; the table below is a faithful rendering of the same rows and
`__tests__/choiceCoverage.test.ts` checks every `player` row's moves are
offered (with their distinguishing field) in a staged situation, every `auto`
row has a `why`, and every named move type exists.

| Choice | Owner | How surfaced | AI policy (harness bot) | Balance axis |
|---|---|---|---|---|
| World seed / clearings | player | `options.seed`, `options.clearings` | — | `world_seed` |
| Where to go | player | `move {to}` per path (walled paths withheld with a reason in next_step) | nearest safe prey, else the demon's town | — |
| Enter / leave a town or temple | player | `enter`, `leave` | heals and stabs in towns; skips temples | — |
| Whom to attack / harvest | player | `attack {target}` per enemy, plant, tree | weakest survivable slime/mushroom on a node it can leave again; cuts plants/trees to pay for a bed when hurt and broke | — |
| Bomb here | player | `bomb` (needs a bomb; hits everything on the node) | bombs a node whose blockers it cannot afford to fight | — |
| Black market | player | `talk_bandit`, `buy_from_bandit {item}` | buys a bomb when it needs to break out of such a node | — |
| Fly / land; raise the aura; teleport where | player | `fly`/`land`, `aura`, `teleport {town}` (need the item) | never | — |
| Fight or flee (or aura) | player | `fight`, `flee`, `aura` | flee only when about to die, running frees it (no blocker or mushroom crowd) and it can pay for a bed; otherwise fight | — |
| Level-up stat | player | `level_up {stat}` whenever earned | strength → health → agility → range | — |
| Continue after death | player | `continue` | always | — |
| Whom to talk to; accept/decline; clue vs power; "I found you"; goodbye | player | `talk {person}`, `accept_task`/`decline`, `claim_reward {reward}`, `found_you`, `goodbye` | accepts when free; takes the clue | — |
| Inn services | player | `inn`, `sleep`, `train`, `ride {town}`, `buy`/`sell {resource}`, `leave_inn` | sleep when hurt, sell everything, pay for training until strong | — |
| Which house to search (+ lockpick confirm) | player | `search_house {person, confirm}` (needs a key) | never | — |
| Suspects | player | `mark_suspect`/`unmark_suspect {person}` | never | — |
| The knife | player | `stab {person}` for anyone in the town you stand in | the demon (it cheats) | — |
| Gauntlet or riddle; next guardian; the riddle answer | player | `gauntlet`/`riddle`, `next_fight`, `answer_riddle {text}` | never | — |
| **Auto, justified:** which blocker fights first (all must be fought; id order) · enemy actions and their dice (rule-scripted, server dice) · Barber's introductions and Carpenter's town (the original randomises them) · binding name (cosmetic, registry order) · the demon's three minions (the original randomises) | auto | — | — | — |

## 7. Turn-action structure

Exactly one action per `apply_move`. Outdoors: move / enter / attack / bomb /
trade / items, any order. In a town: talk (a conversation is a
short pending with its own replies), inn (a menu pending), houses, the knife,
leave. In a temple: gauntlet or riddle, then leave. Combat interrupts
everything and owes `fight`/`flee` until it ends. Death owes `continue`. The
arena is continuous combat. Stated in `getSessionStartGuidance` §9 and
`getRulesSections` "The world"/"Combat".

## 8. next_step / describeNextStep coverage and pending hygiene

Pendings are derived from state, never a stored `pending` field, so a stale
pending cannot exist; each has a directive naming the move and an explicit
clear path:

| Situation (set by) | Directive (`nextStep.ts`) | Cleared by |
|---|---|---|
| `phase === 'dead'` (`combat.ts die`) | "DEAD … submit continue" | `continue` |
| `combat` (`startCombat` from attack / leaving / harvest / gauntlet / arena / flying) | "COMBAT … fight or flee" | enemy dies (`playerHits`), player flees/aura, snake/wizard flee, player dies, phase-2 withdrawal |
| `dialogue` (`talk`) | "IN CONVERSATION with X" | `goodbye`, `stab`, `continue`, `talk` to someone else |
| `innOpen` (`inn`) | "AT THE INN" | `leave_inn`, `ride`, `stab`, `continue` |
| `inside === 'town'` (`enter`, ride, cape, respawn) | "INSIDE town" | `leave`, `stab`, `teleport` |
| `temple` (`enterTemple`) choice / gauntlet / riddle | one directive each | `leave`, chest, `teleport`, `continue` |
| `arena` (`stab`) | the combat directive with "no way out" | win, death |
| outdoors (default) | "OUTDOORS at X" with paths/enemies/resources | — |
| `won`/`lost` | `game_over` | — |

Withheld-move legibility: next_step `facts.notes` state why a move the player
might expect is absent (flying with range < 3, aura up, no boots/cape, no
bomb for an ore deposit or the ring, locked houses without a key, nobody met
for the knife); every refusal message says the reason in words.

Verified by the summaries suite (every step of 12 full games is
`human_to_move` with a `human_response`, facts contain no tool names) and by
the server-level sweep (§13).

## 9. Logging path

Cheap path: `getScoreboard` (level, xp, hp, shuckles, clues, people met,
bindings, magic items, deaths). Summaries come from each handler in plain
words with printed names; enemy ids appear only in `look` (bracketed beside
the name, because they are the move language). Nothing hidden exists in a
summary: the summaries suite scans 12 full games for raw ids and debug text;
the server sweep scans every `state_summary` for the hidden-field names. The
engine repo's `scripts/check-summaries.ts` was **not run** (not in this repo).

## 10. Schema / migration impact

New module; no `SessionState` change; state is plain JSON (`structuredClone`
per move), persisted by the shared stores. No `SESSION_SCHEMA_VERSION` bump.
Fields added during the port (`deaths`, `freeStatPicks`, `activeTaskGiver`)
predate any persisted session.

## 11. Rules ambiguities → resolution log

Rulings by the designer (2026-10-20): combat math as written; Evil Eye range
5; running away always succeeds; skeletons and knights attack when you run;
death as the original; 5–8 clearings; spawn restrictions only where stated;
leaving a temple resets the gauntlet; a failed riddle costs nothing; keep all
features; clearings cap at 4 links; starting speed 4. Open (⚠, implemented
as stated in §5 and `PORT-PLAN.md` §12): Q2 guardian ranges, Q3 ore count,
Q4 roaming, Q5 opening attack once/symmetric, Q6 one deposit per bomb, Q7
cape heal, Q8 density, Q10 `attack` = first swing. The five riddles are drafts
awaiting review.

## 12. Out-of-scope / expansions

The original's pause menus, settings, audio, mobile controls, cheat console,
analytics, 3D rendering and minimap are presentation, not rules. The unused
item-take API (§3) is not ported. Nothing is stubbed: every row above is
implemented or listed here.

## 13. Verification sign-off

- **Date:** 2026-10-20. **Anti-stub grep:** the §3 vocabulary over `src/`
  returned a riddle-draft comment (reworded), a "placeholder task" (renamed
  `seedTask` with a comment: overwritten by `generateTasks`, never seen), two
  "not yet met" labels (player-facing text, not a stub) and "phase 2/3" of the
  demon fight (a rule). No surviving stub/MVP/approximation.
- **Tests:** this package 18 files / 100 tests; whole repository 127 files /
  1281 tests, all green (`vitest run`). Build: `tsc -b packages/*` clean with
  `@zekel/game-kit` 0.1.0 (note: the root `build` script's `packages/*` glob
  needs a POSIX shell on Windows).
- **Smoke** (`scripts/smoke.mjs`, real server): seven games listed; the
  all-AI game reaches game over (72 moves); a human seat gets a
  `human_to_move` directive; `get_demon_hunter_lore` lists 11 topics. SMOKE OK.
- **Human-seat sweep** (`scripts/human-seat-sweep.mjs`, this repo's stand-in
  for the engine repo's `human-seat-sweep.ts`): seeds 5/6/7, 71/55/75 moves
  each, every step a human directive with a `human_response`, every
  suggestion accepted, no hidden field in any view or summary, every game
  reached game over; `get_rules` serves the sectioned rules; the lore tool
  answers by title. SWEEP OK.
- **Not run (need the engine repo's harness with this game registered):**
  §2a executable rules verification (`src/verify/…`, no encoding exists for
  this game), the repo-wide `choiceCoverage.test.ts` (replaced by the local
  staged coverage test), `check-summaries.ts` (replaced by the local
  summaries suite), the **desync** gate (N/A in spirit: there is no physical
  table to diverge from; the state is the table) and the **balance** gate
  (the only axis, `world_seed`, is declared; solvability is 0% for the
  harness bot by design — it is a terminator, not a player).
- **Verdict:** rules-complete against the notes, the rulings and the original
  code; every choice owned or justified; every pending clears; views
  complete and leak-free; playable from the human seat through the real
  server. **Not yet "fully playable" by the runbook's full bar**: the desync
  and balance gates have not run, the riddles and the ⚠ readings in §11
  await the designer, and the game has not had a human playtest at a real
  session. A balance pass should start with the finale: without bindings the
  demon cannot be killed in text combat (PORT-PLAN Q11; the bot now reaches it
  at level 7 and always dies there), then early-game lethality (bandits,
  skeletons and knights still kill a fresh player in one action), enemy
  density, and the mushroom-crowd pin (§4 item 11).
