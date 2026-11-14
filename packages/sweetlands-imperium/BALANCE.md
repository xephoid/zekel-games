# Balance verdict — Sweetlands Imperium

**As of 2026-06-19.** Assessed with the AI harness (`docs/balance-harness-runbook.md`).
Full local analysis: `FINDINGS-sweetlands-imperium.md` (not committed). This is the durable
verdict `GAMES.md` reads; re-verify when the AI or balance-relevant rules change.

> Two harness/instrumentation fixes made during this pass: (1) `fetchReferenceData` didn't read
> `reference_data.factions`, so `--sweep=faction` was a silent no-op (faction stayed pinned to seat);
> (2) added per-objective achievement instrumentation (`playerFeatures` → `obj_pub:`/`obj_secret:`).
> Numbers below are post-fix.

> **Moved here on 2026-11-13** from the private `zekel` repo. Paths such as `docs/…` are from that repo.

> **Numbers predate a scoring fix (T37, merged 2026-11-12, version 0.1.4).** A leader capture used to
> score BOTH the public "Capture a leader" (1) and the secret one (2); the designer ruling is that one
> capture scores only one of them (rules §7 item 2). Every run below therefore over-counts
> leader-capture points for any seat holding that secret objective — most visibly the aggro strategy
> and Jellybean (auto-win knight battles → more captures). Re-run before treating the faction/strategy
> margins as current. (T45, version 0.1.5, only stops the Intel trade from making up a card; it should
> not move these numbers.)

## Headline
**Assessed across three dimensions (skill, faction, objective); four design issues flagged, none
auto-fixed.** The 4 region factions are roughly balanced (Jellybean over-performs), the Nomads (5p-only)
are a dead faction, and the castle/foe strategy is strongest. The objective dimension is now
well-exercised after a balance→AI-dev loop (one engine bug fixed + AI pursuit closed 3 of 5 dead
objectives); **two area-control public objectives remain unachievable** — a likely design over-constraint,
not an AI gap (the AI demonstrably tries). A complete balanced verdict awaits those design decisions.

## The three dimensions assessed
Skill (ladder), **faction** (identity), and **objective** (which win conditions are achieved). Foe is a
declared scenario axis but was not swept (single foe per game) — unexercised this pass.

## Run config (the §6.4 caption)
- **Skill:** `hard` (verified-strong; the objective/strategy levers are hard-tier).
- **Faction axis:** `--sweep=faction` (decoupled from seat). **Strategy:** Run C = 4 archetypes.
- **N:** 600/scenario (Run A) · 400 (objective breakdown); **seed=1**; seat-rotation on; **0 errored**.
- 95% CIs: Wilson on rates, Newcombe on lifts (✓ = excludes 0).

## 1. Winning math (how 5 points is reached)
Public: matching-color (3), treats (3), defeat-foe (3), capture-leader (1), leader-castle (1).
Secret: 2 each, you hold **2** → secrets cap at **4**, so **every win needs ≥1 public objective.**
Typical wins: `defeat_foe(3)+secret(2)`, `defeat_foe(3)+capture_leader(1)+leader_castle(1)`, or two
3-pt publics. **Avg per winner (5p, hard):** ~1.33 secrets + 0.92 capture-leader + 0.47 defeat-foe
(≈5 pts). So winners lean on **secrets + capturing a leader**, with the foe as a frequent 3-pt boost.

## 2. Objective achievement (the objective dimension) — 5p, hard, N=400
| Objective | Type | Achieved | Notes |
|---|---|---|---|
| capture_leader | pub 1 | **52%** (68% of winners) | the workhorse |
| defeat_foe | pub 3 | 16% (47% of winners) | big swing; +56.8 win lift ✓ |
| leader_castle_uncontested | pub 1 | 15% | |
| **units_all_matching_color** | pub 3 | **0% — DEAD** | needs 3 units across 3 opposing regions on same color |
| **units_all_treats** | pub 3 | **0% — DEAD** | needs 3 units on treat spaces in 3 regions |
| enter_castle_with_leader | sec 2 | 69% of holders | most-achieved secret |
| capture_leader / _ambassador, spend_5_inf, raise_taxes_3, gain_5_intel, collect_5_inf, discard_5_sugar, defeat_knight | sec 2 | 30–58% of holders | healthy |
| discard_5_intel | sec 2 | **0% → 65%** (fixed) | AI now converts toward it (ai-dev follow-up) |
| unit_through_3_regions | sec 2 | **0% → 14%** (fixed) | was an ENGINE BUG (max not cumulative regions); fixed + AI Green-rush |
| collect_taxes_from_opponent | sec 2 | ~4% | situational (needs a rival's taxable unit in your region); achievable, rare |
| units_all_matching_color | pub 3 | **0% → 14% (Nomads)** | RULE BUG fixed for Nomads (see below) |
| units_all_treats | pub 3 | **0% → 2% (Nomads)** | reachable for Nomads now |

**AI-dev follow-up (the balance→AI loop) found and fixed THREE bugs + closed the gaps:**
- `unit_through_3_regions` was an ENGINE BUG (tracked max single-move crossings, never ≥3 — fixed to
  cumulative per-unit). AI now pursues `discard_5_intel` (65%) and the 3-region rush (14%).
- **The two area-control publics were a RULE BUG for the Nomads** (designer-reported): "a unit in each
  opposing region" is impossible for the region-less Nomads (3 units, 4 regions), so they could NEVER
  score them. Fixed: Nomads satisfy them by getting all 3 units onto the same color / onto treats (any
  regions) — their natural, *easier* win path. Now achieved (matching-color 14% of Nomad-games, treats
  2%); the objectives are no longer dead.
- **For region-holders, the two area-control publics remain ~0%** — maximally constrained (3 units, 3
  distinct opposing regions, same color/treat, simultaneous). Possibly intended as a Nomad specialty;
  flag for the designer if region-holders should also be able to pursue them.

## 3. Faction balance (Run A, `hard`, `--sweep=faction`, N=600/count) — fair = 1/players
| Count | jellybean | cheesecake | fudge | milkshake | nomads | first-player |
|---|---|---|---|---|---|---|
| 2p (50%) | 57.0 | 51.7 | 49.0 | 51.2 | — | none |
| 3p (33%) | 36.8 | 34.2 | 32.7 | 37.3 | — | none |
| 4p (25%) | **30.8 ✓** | 25.0 | 24.7 | 24.3 | — | none |
| 5p (20%) | **30.7 ✓** | 28.3 ✓ | 26.2 ✓ | 25.2 | **0.5 ✓** | ~+3.7pp |
- **Jellybean over-performs** (sig at 4p/5p; Condorcet winner) — its *knight-always-wins-attacking*
  powers captures + the castle rush.
- **Nomads remain underpowered at 5p (~6%, up from 0.5%)** — now DEFINITIVELY STRUCTURAL, not an AI gap.
  A balance→AI loop made the AI exercise *every* Nomad tool: their (fixed) area-control path using
  **explosive (Green-unlimited) turns** to position all units in one turn (matching-color **27.8%**),
  buying sugar to win fights (defeats a knight ~30%, captures ~33%, from ~0), **inciting trade**
  (~4.5 trades/game), and buying+**spending Intel tokens** (effect was a no-op — found+fixed during this
  review; now a kept guaranteed-color play). Win rate climbed 0.5%→~6% but is still low because Nomads
  have **no secret objectives** (≈2.7 fewer pts/game than every other faction — a large gap in a race to 5).
  **→ Needs a design fix (Nomad compensation), e.g. grant secret objectives or another point source.**
- Others near fair (5p positive lifts inflated by Nomad redistribution). First-player negligible.

## 4. Strategy meta (Run C, 4p, `hard`, one strategy/seat, N=600)
castle 33.3% (+10.5 ✓) > spread 29.7% (+5.6 ✓) > economy 20.0% (−7.3 ✓) > aggro 18.8% (−8.8 ✓).
castle = Condorcet winner; not a diverse meta. (Note: even castle wins via the *combo* — defeat_foe is
only 16% achieved — not the foe alone.)

## Skill ladder (Run B, AI-NOTES self-test, 2p, n=200)
medium 71.5% > easy 28.5%; hard 89.5% > medium 10.5% (CIs exclude 50%). Monotonic.

## Caveats / unmeasured
- **Objective dimension incomplete** — ~5 objectives AI-dead (above); verdict on them premature.
- **Foe axis not swept** (single foe/game) — `scenario` axis unexercised.
- **Strategy lever is `hard`-only**; §4 "decided too early?" not run (no `--trace`; `leaderScalar` wired).
- Faction read at `hard`; findings are association under good play (a §6.3 holdout would confirm).

## Open items (for the designer)
1. **The two area-control public objectives are effectively unachievable** (`units_all_matching_color`,
   `units_all_treats`) — 0% even with a dedicated AI spread bias; over-constrained (all 3 units, 3
   distinct opposing regions, same color/treat, simultaneous). Relax them or confirm intentional. (The
   other ~3 dead objectives were closed via the ai-dev follow-up: an engine fix + AI pursuit.)
2. **Jellybean's auto-win-knight is too strong** (+6–11pp) — consider conditioning it.
3. **Nomads need compensation** to be playable at 5p (~1.8% even after the AI uses all their tools —
   area-control, sugar/fights, trade). The deficit is structural: no secret objectives. The rule fix
   (area-control now achievable) + trade help but don't close a ~2.7-pt/game gap.
4. **Castle/foe line dominates** (foe = 3 pts) — consider lowering it or strengthening other lines.
