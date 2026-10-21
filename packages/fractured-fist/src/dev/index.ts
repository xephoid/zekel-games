// Dev hooks for fractured-fist: what the development tools need to know about this
// game beyond the Game itself (@zekel/dev, harness/devHooks.ts).

import type { GameDevHooks, SweepBuilder, StrategyDraft } from '@zekel/dev/harness/devHooks';
import type { AnalysisOverride } from '@zekel/dev/harness/analysis';
import { moveType, moveCardId } from '@zekel/dev/harness/analysis';
import { mulberry32 } from '@zekel/dev/harness/random';

// The card catalog classifies which technique plays are "impactful" (damage /
// defense / misstep) for the faithful dead-turn rule below.
import { CARDS } from '../cards.js';
import type { VerifyAdapter } from '@zekel/dev/verify/exec/driver';
import { fracturedFistVerifyAdapter } from './verify/adapter.js';

// Fractured Fist: result.scores is the surviving player's stamina (the loser's
// stamina hit 0 — see engine checkGameOver), so stamina IS the win-ranking scalar
// during play.
//
// Dead-turn: the GENERIC rule ("0 play_card AND 0 buy_card") is too lenient for FF
// — playing a Focus for spirit counts as a play, so a misstep-clogged turn that
// only managed a Focus/refine/reload read as "live", hiding the real dead turns
// (the harness reported a bogus 0% dead-turn rate). A faithful FF dead turn made no
// BOARD PROGRESS: it queued no impactful technique (damage / defense / misstep) AND
// bought no card. Playing a resource, refining, focus-reloading, advancing, or just
// ending are all setup/no-ops, not progress.
const FF_IMPACTFUL_TECHNIQUES = new Set(
  CARDS.filter(
    (c) =>
      c.type === 'TECHNIQUE' &&
      ((c.effects?.damage ?? 0) > 0 || (c.effects?.defense ?? 0) > 0 || (c.effects?.add_misstep ?? 0) > 0),
  ).map((c) => c.id),
);
const fracturedFistAnalysis: AnalysisOverride = {
  leaderScalar: (row) => row.stamina ?? 0,
  isDeadTurn(moves) {
    return !moves.some((m) => {
      const t = moveType(m);
      if (t === 'buy_card') return true; // acquiring a card is progress (the AI no longer buys junk Focus)
      if (t === 'play_card') {
        const c = moveCardId(m);
        return c !== undefined && FF_IMPACTFUL_TECHNIQUES.has(c);
      }
      return false;
    });
  },
};

// ---------- strategy draft (ai-harness --strategy=<factions>) ----------
// The ai-harness command reads the game's reference data (get_rules); for
// Fractured Fist that is the card catalog.

interface ReferenceCard {
  id: string;
  type: string;
  cost?: number;
  faction?: string;
  value?: number;
  effects?: {
    damage?: number;
    defense?: number;
    heal?: number;
    spirit?: number;
    add_misstep?: number;
  } & Record<string, unknown>;
}

interface FFReference {
  cards: ReferenceCard[];
}

// ---------- Fractured Fist faction draft ----------
//
// FF loadouts are a SHARED 7-card pool the two players co-draft (alternating
// picks), each toward its faction's fighting style. We model that: given the two
// seats' factions, alternate-pick 7 techniques — each seat takes up to FF_FACTION_CAP
// of its faction's tagged cards, then style-fitting neutrals — keeping the loadout a
// MIX (faction signatures + shared neutrals, à la the campaign Champion generator),
// with >= 1 damage card so the game is winnable. The per-seat AI then plays toward
// its faction (see fitsFactionStyle in fractured-fist/ai.ts), so the shared menu
// yields a real faction-vs-faction matchup. Seeded per game for reproducible variety.

const FF_FACTIONS = ['titan_entertainment', 'the_awakened', 'masters_circle', 'uncounted'] as const;
const FF_STARTER_IDS = ['attack', 'block', 'assess', 'center', 'distract', 'quicken', 'react'];

function resolveFaction(s: string): string | null {
  const k = s.toLowerCase().replace(/[\s-]/g, '_');
  if (k === 'titan' || k === 'titan_entertainment' || k === 'burst') return 'titan_entertainment';
  if (k === 'awakened' || k === 'the_awakened' || k === 'sustain') return 'the_awakened';
  if (k === 'masters' || k === 'masters_circle' || k === 'defense') return 'masters_circle';
  if (k === 'uncounted' || k === 'misstep' || k === 'disruption') return 'uncounted';
  return null;
}

// Amount of a faction's signature-style effect on a card (mirrors the FF AI's
// fitsFactionStyle, but graded). Used to rank draft picks for a value-greedy
// (high-skill) drafter.
function ffStyleAmount(faction: string, c: ReferenceCard): number {
  const e = c.effects ?? {};
  switch (faction) {
    case 'titan_entertainment':
      return e.damage ?? 0;
    case 'the_awakened':
      return (e.heal ?? 0) + (e.spirit ?? 0) + (c.value ?? 0);
    case 'masters_circle':
      return e.defense ?? 0;
    case 'uncounted':
      return e.add_misstep ?? 0;
    default:
      return 0;
  }
}

interface FactionDraftSpec {
  pool: string[]; // resolved faction ids available (the --strategy entries, canonical + deduped)
  byFaction: Record<string, string[]>; // faction id -> its tagged TECHNIQUE ids
  neutrals: string[]; // neutral (untagged) technique ids (starters + generals)
  damageIds: string[]; // technique ids with damage > 0
  cardsById: Record<string, ReferenceCard>; // technique id -> card (for style fit)
}

// Build the draft spec if EVERY --strategy entry resolves to a faction; else null.
// `pool` is the canonical faction set; the per-seat factions for each game are
// chosen from it by seatFactionsForGame (fixed when #strategies == #seats, else
// sampled — "pool mode" — so one batch fills the whole matchup matrix).
function buildFactionDraftSpec(strategies: string[], ref: FFReference): FactionDraftSpec | null {
  if (strategies.length === 0) return null;
  const resolved = strategies.map(resolveFaction);
  if (resolved.some((f) => f === null)) return null;
  const pool = [...new Set(resolved as string[])];
  const techniques = (ref.cards ?? []).filter((c) => c.type === 'TECHNIQUE');
  const byFaction: Record<string, string[]> = {};
  for (const f of FF_FACTIONS) byFaction[f] = techniques.filter((c) => c.faction === f).map((c) => c.id);
  const neutrals = techniques.filter((c) => !c.faction).map((c) => c.id);
  const damageIds = techniques.filter((c) => (c.effects?.damage ?? 0) > 0).map((c) => c.id);
  const cardsById: Record<string, ReferenceCard> = {};
  for (const c of techniques) cardsById[c.id] = c;
  return { pool, byFaction, neutrals, damageIds, cardsById };
}

// The canonical faction for each seat in a given game. Fixed assignment when the
// caller gave exactly one strategy per seat; otherwise "pool mode" — sample
// `seats` distinct factions from the pool, seeded by the game seed, so across a
// batch every pairing occurs and the matchup matrix (hence the meta analysis)
// fills in from a single run.
function seatFactionsForGame(strategies: string[], spec: FactionDraftSpec, seats: number, seed: number): string[] {
  const resolved = strategies.map(resolveFaction) as string[];
  if (resolved.length === seats) return resolved;
  // Pool mode: seeded distinct sample of `seats` factions.
  const rng = mulberry32((seed ^ 0xc2b2ae35) >>> 0);
  const bag = [...spec.pool];
  const out: string[] = [];
  const need = Math.min(seats, bag.length);
  for (let k = 0; k < need; k++) {
    const idx = Math.floor(rng() * bag.length);
    out.push(bag.splice(idx, 1)[0]!);
  }
  // If the pool is smaller than the seat count, pad by repeating (mirror-ish).
  while (out.length < seats) out.push(spec.pool[Math.floor(rng() * spec.pool.length)]!);
  return out;
}

// Per-seat cap on faction-TAGGED picks, so the 7-card loadout stays a MIX (with 2
// seats: 2 + 2 faction cards + 3 shared neutrals — mirrors the Champion tier's
// faction/neutral balance) rather than collapsing to all-faction-cards.
const FF_FACTION_CAP = 2;

// A value-greedy drafter's score for a card given its faction: its own faction's
// signature cards rank highest, then on-style effect magnitude, then raw impact
// (so strong neutrals like Flying Kick rank above weak ones).
function draftValue(faction: string, c: ReferenceCard): number {
  const e = c.effects ?? {};
  const generic =
    (e.damage ?? 0) + (e.defense ?? 0) + (e.heal ?? 0) + (e.add_misstep ?? 0) + (e.spirit ?? 0) + (c.value ?? 0);
  return (c.faction === faction ? 100 : 0) + ffStyleAmount(faction, c) * 10 + generic;
}

// Draft the shared 7-card loadout by alternating picks. Each seat drafts at its
// own SKILL: 'easy' (low-skill/novice) drafts UNIFORMLY at random within the pool
// (matching the original championGenerator's getRandom); every other tier drafts
// VALUE-GREEDY toward its faction (best of its faction, then best neutral — which
// first-picks strong neutrals like Flying Kick precisely because they're strong).
// Both modes keep the FF_FACTION_CAP so the loadout stays a faction/neutral mix.
// Seeded per game ⇒ randomized but reproducible.
function draftFactionLoadout(
  spec: FactionDraftSpec,
  seed: number,
  factions: string[],
  difficulties: (string | undefined)[],
): string[] {
  const rng = mulberry32((seed ^ 0x85ebca6b) >>> 0);
  const LOADOUT = 7;
  const picks: string[] = [];
  const taken = new Set<string>();
  const factionPicks = factions.map(() => 0);
  const allTech = [...spec.neutrals, ...Object.values(spec.byFaction).flat()];

  // Low-skill: uniform random within the candidate pool.
  const pickUniform = (cands: string[]): string | null => {
    const avail = cands.filter((id) => !taken.has(id));
    if (avail.length === 0) return null;
    const choice = avail[Math.floor(rng() * avail.length)]!;
    taken.add(choice);
    return choice;
  };
  // High-skill: pick from the top-2 by draft value (slight variety so skilled
  // drafts aren't identical every game, but the strongest cards dominate).
  const pickGreedy = (cands: string[], faction: string): string | null => {
    const avail = cands.filter((id) => !taken.has(id));
    if (avail.length === 0) return null;
    avail.sort((a, b) => draftValue(faction, spec.cardsById[b]!) - draftValue(faction, spec.cardsById[a]!));
    const topK = avail.slice(0, Math.min(2, avail.length));
    const choice = topK[Math.floor(rng() * topK.length)]!;
    taken.add(choice);
    return choice;
  };

  for (let i = 0; i < LOADOUT; i++) {
    const seat = i % factions.length;
    const faction = factions[seat]!;
    const greedy = (difficulties[seat] ?? 'medium') !== 'easy';
    const pickFaction = (cands: string[]) => (greedy ? pickGreedy(cands, faction) : pickUniform(cands));
    let pick: string | null = null;
    if (factionPicks[seat]! < FF_FACTION_CAP) {
      pick = pickFaction(spec.byFaction[faction] ?? []);
      if (pick) factionPicks[seat]! += 1;
    }
    // Remaining slots: neutrals (uniform for low-skill; value-greedy toward the
    // faction for high-skill — NO style FILTER, matching the original's uniform
    // general selection at low skill while letting skill drive the bias).
    pick ??= pickFaction(spec.neutrals);
    pick ??= pickUniform(allTech);
    if (pick) picks.push(pick);
  }

  // Winnability: guarantee >= 1 damage technique (stamina only drops via damage).
  if (!picks.some((id) => spec.damageIds.includes(id))) {
    const dmg = spec.damageIds.find((id) => !taken.has(id)) ?? spec.damageIds[0];
    if (dmg) picks[picks.length - 1] = dmg;
  }
  return picks;
}

const fracturedFistStrategyDraft: StrategyDraft = {
  plan(strategies, reference) {
    const spec = buildFactionDraftSpec(strategies, reference as unknown as FFReference);
    if (!spec) return null;
    return {
      describe(strategyCount) {
        const mode = spec.pool.length > 1 && strategyCount > 2 ? 'pool (random pairing/game)' : 'fixed pair';
        return `Faction draft: ${spec.pool.join(', ')} — ${mode}, shared co-drafted loadout`;
      },
      seatStrategies: (seats, seed) => seatFactionsForGame(strategies, spec, seats, seed),
      options: (seed, seatStrategies, seatDifficulties) => ({
        loadout: draftFactionLoadout(spec, seed, seatStrategies, seatDifficulties),
      }),
    };
  },
};

// ---------- sweeps (ai-harness --sweep=<name>) ----------

const fracturedFistSweeps: Record<string, SweepBuilder> = {
  loadout(reference) {
    const techniques = ((reference as unknown as FFReference).cards ?? []).filter((c) => c.type === 'TECHNIQUE');
    const ids = techniques.map((c) => c.id);
    const damageIds = techniques.filter((c) => (c.effects?.damage ?? 0) > 0).map((c) => c.id);
    return { optionKey: 'loadout', count: 7, pool: ids, mustIncludeFrom: damageIds };
  },
};

export const devHooks: GameDevHooks = {
  analysis: fracturedFistAnalysis,
  // Rules-checker adapters (./verify/), by adapter id.
  verify: {
    'fractured-fist': fracturedFistVerifyAdapter as unknown as VerifyAdapter<unknown>,
  },
  strategyDraft: fracturedFistStrategyDraft,
  sweeps: fracturedFistSweeps,
};
