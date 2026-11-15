# Post-port verification — Sweetlands Imperium

> **Moved here on 2026-11-13** from the private `zekel` repo (`src/games/sweetlands-imperium/`),
> where the game was first built. Code line numbers (`:123`) and paths such as `port/…`, `docs/…` and
> `src/verify/…` are from that repo and are out of date here. The pinned rules text in this repo is
> `src/dev/verify/rules-freeze.txt`. Rows changed since the move say so.

Verifies the module is **fully playable**: every rule in the canonical ruleset is implemented, and
every choice the rules give a player reaches the player. Companion to `PORT-NOTES.md`.

## 1. Provenance & sources
- **Rulebook (source of truth):** `port/sweetlands-imperium/SWEETLANDS-RULES.md` — the canonical
  rules-freeze co-authored with the designer (the PDF is a rough design doc, not a rulebook). All
  citations below are to its sections (§). Board geometry: `DATA_TEMPLATE.md`.
- **Reference implementation:** none — original game; no prior code.
- **Designer rulings folded in:** sugar cubes are custom dice (3 blank/1/2/3); double cards are
  same-color ×2 (act twice); Nomads are 5-player-only and start off-board; "spend 5 influence" /
  "discard 5 sugar" are deliberate trash actions; "push" = play-unlimited-Intel; one card per unit;
  all treat spaces tax-exempt.

## 2. Zone categorization (verified — `types.ts` top block)
| Zone | Category | Source of truth | Visible to |
|---|---|---|---|
| Board (unit positions), taxes, foe, castle occupant, treat placement | public/shared | server | both |
| Per-player influence / sugar / tokens / points / scored objectives | public/shared | server | both |
| **Intel deck (80 cards)** | **server-dealt SHARED hidden** | server (order) | nobody |
| AI Intel hand + secret objectives | server-tracked AI-private | server | that AI |
| Human Intel hand + secret objectives | server-dealt human-private | server (tracked) | that human |

**Shared-hidden-deck check (the high-risk case):** the single Intel deck is server-owned and shuffled
once (`engine.ts:createInitialState`). Human draws use the **report-draw** pattern — human reports,
server reconciles against its tracked remainder (`reconcileReportedCard` engine.ts:426), AI is dealt
from what's left (`dealIntelToPlayer` :186). Disjointness + privacy hold at **setup AND mid-game**
(see the §3 finding below — this was the main post-port fix). No opaque/human-shuffled zones exist.

## 3. Mechanics traceability matrix (rule → status → code → test)
Status: ✅ implemented (code + test) · ⬜ none. All rows ✅.

### Setup (§3)
| Rule | Status | Code | Test |
|---|---|---|---|
| Place 4 random treat tiles randomly | ✅ | engine.ts:108 | board.test (slots) |
| Faction pick per seat (human-owned) | ✅ | doAssignFactions :320 | engine.test "human faction…" |
| Nomads 5-player-only | ✅ | :333, factions.availableFactionIds | engine.test "Nomads are 5-player only" |
| Place units at start (Nomads off-board) | ✅ | assignFaction :126 | engine.test, mechanics.test |
| 3 sugar each (Nomads 0) | ✅ | createInitialState :55, assignFaction | engine.test 5p |
| Deal 2 secret obj, keep 1, pass right (Nomads none) | ✅ | dealSecretObjectives :147, keepSecret :374 | engine.test 5p |
| First player; draw 3 Intel; 2 influence; taxes 0 | ✅ | beginPlay :172, createInitialState | engine.test |
### Turn structure (§4)
| Recall any units (Nomads→off-board) | ✅ | doRecall :472 | engine.test, mechanics.test |
| Gain Intel by Ambassador distance (home +1/+2/+3/+2; Nomads +2) | ✅ | intelGainCount :221, geometry.intelGainForDistance | geometry.test, humanFlow.test |
| Play exactly 1 Intel: move one unit + optional action | ✅ | doPlayIntel :486, resolveColorPlay :521 | engine.test, mechanics.test |
| Jump to next matching color; junction ring-vs-road | ✅ | geometry.advanceToColor | geometry.test |
| Double card = same color, acts twice | ✅ | doPlayIntel :505 | mechanics.test "double acts twice" |
| Treat card → special location (Cheesecake any) | ✅ | resolveTreatPlay :688, findTreatSlot :697 | (covered by harness) |
| Influence phase: buy tokens (1, ≤1/color), sugar (3) | ✅ | doBuyToken, doBuySugar | engine.test |
| **Intel token EFFECT** — spend as a one-time guaranteed-color play, returns to supply | ✅ | doPlayToken | mechanics (token play) |
| Pass → +1 influence | ✅ | doPass :707 | engine.test |
| Discard 4 (Fudge 2) Intel → 1 of any color; only colors with a one-color card left in deck or discard (T45 ruling, 2026-11-13) | ✅ | engine `doDiscardForColor`; trade.ts `colorCardLeft`; legalMoves | tradeForColor.test |
| Trade any time (resources + unit swaps) | ✅ | doTrade :752 | (harness; physical-first) |
| Scoring in turn order; new first player = most sugar (roll-off) | ✅ | runScoringPhase :848, pickNewFirstPlayer | (harness) |
### Colors / actions (§4, §8)
| 🔴 Red battle/capture (knight only; battle knight first; tie→defender) | ✅ | actionBattleCapture, battleKnight | mechanics (sugar die) |
| Capture target is the capturer's choice (leader vs ambassador are different secrets) — T37, 2026-11-12 | ✅ | capture.ts `captureChoices`; legalMoves `redActionVariants` | captureTarget.test |
| One capture scores only ONE "Capture a leader" (public 1 / secret 2); capturer picks; the other stays open (§7 item 2) — T37 | ✅ | engine `scoreLeaderCapture` | captureTarget.test |
| A double red card's second capture asks the player (pending `capture_choice`, move `choose_capture`) — T37 | ✅ | engine `actionBattleCapture`, `doChooseCapture` | captureTarget.test, sl-screen.test |
| 🟠 Orange influence by Leader distance; castle +5; max 5 | ✅ | actionAcquireInfluence :572 | (harness) |
| 🟡 Yellow collect taxes (treat-exempt; can't pay→home); raise +1 (1 inf, max 3) | ✅ | actionTaxes :587 | (harness) |
| 🟢 Green move, OR discard for unlimited plays | ✅ | resolveColorPlay :527 | (harness) |
| 🔵 Blue collect Intel by Ambassador location | ✅ | actionCollectIntel :581 | humanFlow.test |
| 🟣 Purple enter/hold castle (foe must be beaten) | ✅ | actionCastle :676 | (harness) |
| Sugar cubes = custom dice (3 blank/1/2/3) | ✅ | rng.rollSugarDice | mechanics.test "custom dice" |
| One foe; Dragon 5 / Orc 3 / Fiend 2 dice | ✅ | battleFoe :666, FOE_DICE | (harness) |
### Faction abilities (§2)
| Milkshake never pays tax | ✅ | actionTaxes :593 | (harness) |
| Fudge converts 2 not 4 | ✅ | doDiscardForColor :719 | (harness) |
| Jellybean knight always wins attacking | ✅ | battleKnight :657 | (harness) |
| Cheesecake treat → any slot | ✅ | findTreatSlot :699 | (harness) |
| Nomads: off-board, +3 inf/+2 intel, no tax, 0 sugar, no secrets | ✅ | assignFaction, actionAcquireInfluence/CollectIntel/Taxes | engine.test 5p |
### Scoring & end (§6, §7, §8)
| 5 public objectives, one-time each, correct values | ✅ | PUBLIC_OBJECTIVES, scorePublic :869, evaluateStatePublics :881 | data.test |
| 12 secret objectives, 2 pts, scored when met | ✅ | scoreSecretObjectives :838, secretMet | data.test, mechanics (trash) |
| Win at 5 points | ✅ | addPoints :864, checkGameOver | data.test |

## 4. Edge-case catalog
| Case | Handling | Code |
|---|---|---|
| Intel deck runs out mid-draw | reshuffle discard into deck | dealIntelToPlayer :188, reconcileReportedCard :435 |
| **Intel deck AND discard both exhausted** (hand uncapped → a hoarding player can hold most of the 80 cards) | gain is **capped to the drawable pool** (deck+discard); a human's report pending never demands more cards than exist. Pre-fix this deadlocked the human report forever (desync gate). | grantIntel :241 (cap); dealIntelToPlayer :191 (AI break) — humanFlow.test "caps a turn-start gain" |
| Player has no "real" play | `pass` is always legal (gain +1 inf, ends turn) | legalMoves play step |
| Min 1 Intel/turn | home distance 0 → +1; Nomads +2 | intelGainCount :221 |
| Empty hand at play step | can't happen — gain (≥1) precedes play | doRecall→play step |
| Captured/unpaid unit return | start tile, or off-board for Nomads | actionBattleCapture :650, actionTaxes :601 |
| Game never reaches 5 pts (weak AI) | ROUND_CAP=60 backstop ends the game | runScoringPhase :856 |
| Simultaneous 5-pt crossing in a scoring step | most points wins, ties co-win | checkGameOver |
| Every player count 2–5 walked | harness 0-errored all counts | §13 |
| Knight in castle vs foe | battles the foe (Red/Purple) | actionBattleCapture :622, battleFoe |

### Component-count / resource limits
| Limit | Enforced? | Code | Test |
|---|---|---|---|
| Influence ≤ 5 | ✅ | gainInfluence :820 (caps); trade re-caps :763 | componentLimits.test |
| Taxes 0–3 | ✅ | actionTaxes :605 (`level < 3`) | componentLimits.test |
| ≤1 Intel token of each color **per player** | ✅ | doBuyToken :792 | engine (harness) |
| **Intel tokens — 4 of each color (24 total) global supply** | ✅ | doBuyToken :797 + tokensOwnedOfColor; legalMoves filters | componentLimits.test "capped at 4 per color" |
| **80-card Intel deck conserved** (the trade takes a real card from deck or discard; a color with none left is not offered, and is refused if sent — T45) | ✅ | doDiscardForColor → takeColorFromDeck; trade.ts `colorCardLeft` | componentLimits.test "deck conserved", tradeForColor.test; checker rules `intel-cards-conserve-at-eighty`, `trade-for-color-takes-a-real-card` |
| 12 secret-objective cards (≤8 dealt) | ✅ | dealSecretObjectives :147 | engine.test 5p |
| 3 units / player; 1 foe | ✅ | assignFaction; createInitialState | engine.test |
| Per-player Intel hand | uncapped by rule ("No Intel limit") | — | — |
| **Sugar cubes — 30-cube shared bank** | ✅ hard supply (designer-confirmed): bank = 30 − total held; buying blocked when empty, discards return to bank. (Supersedes the PDF's "no sugar cube limit" note, which was a per-player remark.) | doBuySugar :806 + totalSugarHeld; legalMoves filters | componentLimits.test "sugar bank" |

## 5. Design choices — forced vs discretionary
**Forced (port constraints):** none from a reference impl (original game). The all-AI auto-setup path
exists so the harness needs no human handshake (`createInitialState` !anyHuman branch).
**Discretionary (rule readings — flagged):**
- Double card moves the SAME unit twice (vs two units) — designer-confirmed one-unit.
- ~~`discard_for_color` MINTS the chosen-color card~~ — **fixed 2026-11-13 (T45).** The trade takes a
  real one-color card from the deck, shuffling the discard pile in if needed. Designer ruling: when no
  card of the chosen color is left in either, that color is not offered (`colorCardLeft` in
  `trade.ts`, used by both the engine and the move list), and the engine refuses it if sent. The check
  looks at the deck and discard pile before the trade; cards in the player's hand, including the ones
  they give up, never count. So any cards the player picks work for any listed color. The game never
  makes up a card.
- ~~Red capture **target** auto-prioritizes a Leader when the move doesn't name one~~ — **fixed
  2026-11-12 (T37).** The move list offers one ready-to-send option per enemy Leader/Ambassador the
  knight can capture, leaders first, so the choice is the player's. It matters because "capture a
  leader" and "capture an ambassador" are separate secret objectives (rules §7 items 2–3). When both
  "capture a leader" objectives are open, the options also say which one the capture scores (default
  the secret, 2 points). A double red card's second capture depends on the first, so the engine asks
  a human then (pending `capture_choice`); an AI takes the first option.
- Tax exemption applies to ALL treat spaces (designer-confirmed).

## 6. Choice catalog (shared table — owner + how-surfaced; AI policy/axis are other gates')
| Choice | Owner | How surfaced (post-port) | AI policy (ai-dev) | Balance axis |
|---|---|---|---|---|
| Faction | human/seat | assign_setup_choices + setup_checklist + describeNextStep | — | identity |
| Castle foe | table | choose_foe + checklist + describeNextStep | — | scenario |
| Keep-one secret obj | each player | choose_secret_objective + legalMoves + describeNextStep | — | — |
| Starting Intel draw | human | report_intel_draw + checklist + describeNextStep | — | — |
| **Mid-game Intel draw (gain/Blue)** | human | report_intel_draw + pending + describeNextStep | — | — |
| Recall which units | active | legalMoves (skip/all/each) | skip | — |
| Which Intel card to play | active | legalMoves (per card) | policy color→unit | — |
| Which unit to move | active | legalMoves (per unit) | policy | — |
| Junction ring vs road | active | legalMoves `viaRoad` both | ring | — |
| Take the color action? | active | legalMoves true/false | yes | — |
| **Yellow raise taxes?** | active | legalMoves `raiseTaxes` variant | — | — |
| Treat destination (Cheesecake any) | active | legalMoves template (`treatRegion`/`treatSlot`) | — | — |
| Red capture target | active | legalMoves: one option per enemy Leader/Ambassador the knight can capture (`targetPlayerId`/`targetUnit` filled in) | leaders first | — |
| **Which "capture a leader" a capture scores** | active | legalMoves: `captureLeaderScores` public/secret options when BOTH are open (default secret) | secret (2 > 1; the other stays open) | — |
| **A double red card's second capture** | active | pending `capture_choice` → `choose_capture` options + describeNextStep | first option | — |
| Discard-for-color color | active | legalMoves (per color that still has a one-color card in deck or discard) | — | — |
| Buy tokens / sugar | active | legalMoves | bank sugar | — |
| discard_sugar / trash_influence | active | legalMoves | — | — |
| Trade | active | move_schema (open-ended; physical-first) | AI never initiates | — |
| Nomads entry region | Nomads | legalMoves `entryRegion` (4) per card | — | — |

## 7. Turn-action structure
Recall (optional) → Gain Intel (auto for AI; report for human) → **play exactly 1 Intel** (move + optional
action; Green discard or unlimited keeps playing) → Influence phase (buy/trash, any number) → End turn.
Trade and discard_sugar/trash_influence are any-time during your turn. Stated in `getSessionStartGuidance`.

## 8. next_step / describeNextStep coverage map
| Phase / pending | Owner | Directive |
|---|---|---|
| setup_factions | first human | names assign_setup_choices + pool (Nomads note by count) |
| setup_foe | first human | names choose_foe (dice) |
| setup_secrets | each human (head of queue) | names choose_secret_objective + get_legal_moves |
| setup_intel | each human | names report_intel_draw (3) |
| **pending report_intel (gain/Blue)** | the human owed | names report_intel_draw + count + reason, routed to that human even if AI is "active" |
| **pending capture_choice (double red, 2nd capture)** | the capturer | names choose_capture and lists the options |
| play (normal) | active (any) | `null` → generic kind-based directive |
All AI-owed states return `null`. Pending hygiene: there are two pendings. `report_intel` is set by
`grantIntel` (human path) and cleared on report (`doReportIntelDraw`). `capture_choice` (added
2026-11-12, T37) is set when a human's double red card has more than one way to make its second capture,
and cleared by `choose_capture`. When the game ends, `applyMove` clears any pending, so a finished game
never waits on a question. `autoResolveReport` (index.ts) lets the test/desync harness
drive a human seat past a report.

## 9. Logging path
Cheap **`getScoreboard`** (index.ts) — public scalars points/influence/sugar; the MCP layer diffs for
free per-move deltas. No `getLog`. Per-move `summary` strings come from the engine handlers and use
names/board terms, never hidden hand contents or internal ids.

## 10. Schema / migration impact
New game module — no change to `SessionState` or existing games' state types, so no
`SESSION_SCHEMA_VERSION` bump or migration needed. `SweetlandsState` is self-contained and serialized as
JSON via the standard store path. (If `SweetlandsState` is later changed, this is the file to update.)

## 11. Rules ambiguities → resolution log
All resolved with the designer (recorded in `SWEETLANDS-RULES.md` + `PORT-NOTES.md`): sugar dice;
same-color doubles; Nomads off-board + 5p-only; trash-to-complete objectives; "push" = unlimited plays;
one card per unit; treat tax exemption; **Nomad area-control** (all units on the space type, not per-region);
**Intel token effect** ("1 targeted Intel" → a kept, one-time guaranteed-color play that returns to supply).
Minor un-enforced flavor: "spend 5 influence *without using it*" is modeled as trashing ≥5 via `trash_influence`.
> ⚠️ **Post-port misses, corrected later (systematic re-audit).** The original post-port pass + harness
> (crash-only) let several mechanics ship unreachable or no-op. A deliberate effect-and-reachability audit
> (every move type + key effect tallied across ~2400 all-AI games; anything at 0 = suspect) found them:
> 1. **Castle unreachable** (no unit could enter the colorless castle node) — fixed (`actionCastle`/`battleFoe` enter from road/junction).
> 2. **`unit_through_3_regions` unreachable** (tracked max not cumulative regions) — fixed (`unitRegionsVisited`).
> 3. **Nomad area-control impossible** (3 units, 4 regions) — fixed (Nomad = all-units-on-type rule).
> 4. **Intel token EFFECT a no-op** (buy implemented, use missing) — fixed (`doPlayToken`).
> 5. **Cheesecake "any treat" not faction-gated** (any faction could target an arbitrary treat slot) — fixed (`findTreatSlot` rejects non-Cheesecake).
>
> (One thing the audit checked and the designer CONFIRMED is correct, NOT a bug: **Jellybean's auto-win
> applies only to knight battles, never the foe** — the foe is a real dice fight for every faction.)
>
> Everything else fires in play (all 6 colors, double/treat cards, captures, taxes incl. Milkshake-skip &
> Fudge-2-discard, sugar dice, trade, discard/trash sinks, pass, raise-to-3, scoring). The one move with
> 0 AI usage is **recall-with-units** — implemented and human-usable, the AI just always skips it (a play
> choice, not a gap). **Lesson: the §3 matrix must verify each component's EFFECT + REACHABILITY, not just
> that it can be acquired/called** — the harness's no-crash bar does not.

## 12. Out-of-scope / expansions
None. No expansions; the full base game is implemented. `ROUND_CAP=60` is an engineering backstop, not
a rule.

## 13. Verification sign-off
- **Date:** 2026-06-19
- **`pnpm test` (module):** 53 passed — board(8) data(10) geometry(8) engine(6) mechanics(5) humanFlow(7)
  componentLimits(4) aiDeterminism(5); + harness renderValue(3). Full repo suite green (no regressions).
- **Anti-stub grep:** clean — 2 hits, both benign false positives (a "placeholder until setup resolves"
  initial-value comment; "Approximated by walking" describing `regionsCrossed`). No stub/MVP/TODO.
- **Harness:** 0-errored at 2p/3p/4p/5p (n=50 on 2p/5p; smaller batches on 3p/4p).
- **Desync gate:** ✅ **NO DESYNC** (`docs/desync-harness-runbook.md`, qwen3.6:35b assistant + human-sim).
  Both seats × seeds 1–2 + seat-0 seed 3 — every run tracked the **entire** game correctly
  (`first_desync = null`): seed1 seat0 264 turns 259/264, seat1 224/224; seed2 seat0 29/29 (a real
  **5-point win**), seat1 228/228; all others full games to ROUND_CAP. Six bugs found + fixed + locked
  with tests (the desync gate is what surfaced the deck-exhaustion deadlock and the report-shape gaps):
  1. **Deck+discard exhausted → unsatisfiable report deadlock** (Class A, engine): a hoarding human
     drew more than the drawable pool, opening a report pending for cards that don't exist → infinite
     loop. Fix: `grantIntel` caps the gain to deck+discard (also fixed an AI `intelGainedThisTurn`
     over-count). `humanFlow.test`.
  2. **Identical cards surfaced as distinct play options** (Class A, engine): two copies of a card →
     two same-description legal moves → the model froze ("which yellow card?"). Fix: dedupe play-phase
     legal moves by card identity. `humanFlow.test`.
  3. **Opaque report template** (Class A, engine): `cards:[]` gave no per-card shape, so the model knew
     the colors but omitted `kind`. Fix: template surfaces a card-object skeleton + a shapes
     instruction; reconcile also infers an omitted `kind`. `humanFlow.test`.
  4. **Treat reported by printed name** (Class A, engine): accept "Chocolate Bar" / "chocolate bar" /
     "chocolate_bar" / "ice cream **treat**" → `resolveTreatId` (case/spacing/underscore + strips the
     "treat"/"card" type words). `humanFlow.test`.
  5. **Human-sim rendered cards as field jargon** (Class B, harness): a single-card report
     ("kind treat, treat chocolate_bar") was miscounted as two cards. Fix: `renderIntelCard` speaks a
     card the way a human does ("a chocolate bar treat"). `renderValue.test`.
  6. **Fungible-card false desyncs** (Class B, harness): `canonicalObject` now drops the internal
     `card_id` (identical cards are interchangeable at a physical table) and `canonMoveForMatch`
     normalizes treat spellings, so the state diff and the advisory count are both honest.
- **Balance gate:** ⬜ NOT YET RUN (`docs/balance-harness-runbook.md`). `getBalanceAxes` declares
  faction (identity) + foe (scenario).
- **AI-development gate:** ⬜ NOT YET RUN — baseline AI is honest-but-weak (often hits ROUND_CAP).

**Gate result:** post-port **PASS** — every rule implemented (matrix all ✅), every grep hit
dispositioned, every setup + in-game choice owned-or-justified, the only pending clears, and human
report-draw is wired end-to-end. **Desync gate also PASS** (NO DESYNC, both seats × seeds; see §13).
Balance + ai-development remain (peer gates).

## Rules verification (post-hoc adoption, 2026-08-30)

The rules-verification instrument (`docs/rules-verification.md`) ran against
this module after the fact: blind paper encoding of the rules freeze +
executable checks + divergence hunter. TWO real engine bugs found (stale
castle-occupant scoring; card minting in the discard-for-color fallback —
fix tasks filed; the card minting was fixed 2026-11-13, T45) plus a 49-entry designer-question list from the blind
audit. Full record: `src/verify/sweetlands-imperium/AUDIT-FINDINGS.md`.
