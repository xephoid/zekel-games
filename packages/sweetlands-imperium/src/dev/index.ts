// Dev hooks for sweetlands-imperium: what the development tools need to know about this
// game beyond the Game itself (@zekel/dev, harness/devHooks.ts).

import type { GameDevHooks, SweepBuilder } from '@zekel/dev/harness/devHooks';
import type { AnalysisOverride } from '@zekel/dev/harness/analysis';
import { summaryOf } from '@zekel/dev/harness/analysis';

import type { VerifyAdapter } from '@zekel/dev/verify/exec/driver';
import { sweetlands5pVerifyAdapter, sweetlandsVerifyAdapter } from './verify/adapter.js';

// Sweetlands Imperium: the move vocabulary is play_intel / buy_* / recall / end_turn,
// so the generic play_card/buy_card dead-turn rule marks EVERY turn dead. A turn is
// real board/score progress iff it resolved a color action, moved to a treat, bought,
// completed an objective sink (discard_sugar / trash_influence / discard_for_color),
// or traded. A plain move-only play or a pass reads dead (conservative on purpose).
const sweetlandsImperiumAnalysis: AnalysisOverride = {
  isDeadTurn(moves) {
    for (const r of moves) {
      const m = r.move as { type?: string; takeAction?: boolean } | undefined;
      const t = m?.type;
      if (t === 'play_intel' && m?.takeAction === true) return false;
      if (t === 'play_intel' && /treat|special location/i.test(summaryOf(r))) return false; // treat positioning
      if (t === 'buy_intel_token' || t === 'buy_sugar_cube') return false;
      if (t === 'discard_sugar' || t === 'trash_influence' || t === 'discard_for_color' || t === 'trade') return false;
    }
    return true;
  },
  // "Who is ahead": points dominate (what result.scores ranks on); sugar then
  // influence break ties (sugar = the first-player tiebreak; both are small).
  leaderScalar: (row) => (row.points ?? 0) * 100 + (row.sugar_cubes ?? 0) * 2 + (row.influence ?? 0),
  // Per-seat identity + objective achievement: the faction this seat played AND
  // every objective it SCORED (the objective dimension). The lift table then reports,
  // per faction and per objective, its achievement frequency (Usage) and win-rate
  // lift — a never-achieved objective simply never appears (a dead-objective / AI-gap
  // signal). Scored secrets are exposed only in the game-over view (no mid-game leak).
  playerFeatures(record, playerId) {
    const view = record.final_views[playerId] as
      | { players?: Array<{ player_id?: string; faction?: string; public_objectives_scored?: string[]; secret_objectives_scored?: string[] }> }
      | undefined;
    const seat = view?.players?.find((p) => p.player_id === playerId);
    if (!seat) return [];
    const feats: string[] = [];
    if (seat.faction) feats.push(`faction:${seat.faction}`);
    for (const id of seat.public_objectives_scored ?? []) feats.push(`obj_pub:${id}`);
    for (const id of seat.secret_objectives_scored ?? []) feats.push(`obj_secret:${id}`);
    return feats;
  },
};

// ---------- sweeps (ai-harness --sweep=<name>) ----------

// Sweetlands Imperium: shuffle which faction each seat gets (the identity axis),
// independent of seat order, so per-faction win rate + the faction matchup matrix
// decouple from initiative. The engine reads factionAssignment[i] for the i-th seat
// and filters to the factions valid for the player count (Nomads only at 5p).
const sweetlandsSweeps: Record<string, SweepBuilder> = {
  faction(reference) {
    const ids = ((reference as unknown as { factions?: { id: string }[] }).factions ?? []).map((f) => f.id);
    return { optionKey: 'factionAssignment', count: ids.length, pool: ids };
  },
};

// ---------- desync bot: how a real player says this game's moves ----------

// Sweetlands Imperium: speak an Intel card the way a human reports it at the table
// — "a red card", "a double blue card", "a chocolate bar treat" — not the raw
// field jargon ("kind treat, treat chocolate_bar"). The jargon joins an object's
// fields with ',' while array elements join with ';'; a SINGLE-card report has no
// ';', so "kind treat, treat chocolate_bar" read as TWO cards and the model
// recorded the wrong count (the report was rejected, the pending stranded, and the
// turn desynced). A natural phrase is one comma-free unit, countable whether the
// report holds one card or several.
function renderIntelCard(o: Record<string, unknown>): string | null {
  const kind = o.kind;
  if (kind === 'single' && typeof o.color === 'string') return `a ${o.color} card`;
  if (kind === 'double') {
    const c = typeof o.color === 'string' ? o.color
      : Array.isArray(o.colors) && typeof o.colors[0] === 'string' ? o.colors[0] : null;
    return c ? `a double ${c} card` : 'a double card';
  }
  if (kind === 'treat' && typeof o.treat === 'string') return `a ${o.treat.replace(/_/g, ' ')} treat`;
  return null;
}

// Normalize any `treat` field (Sweetlands Intel report): the human reads the
// printed name and the model may record "chocolate bar" / "chocolate_bar" /
// "ice cream treat" — the server resolves them all to the same card, so the
// recorded move and ground truth are the SAME report. Collapsing them here keeps
// the advisory correct/total count honest (same intent as the card_id/card_name
// unification below). The headline desync metric is the state diff regardless.
const normTreat = (x: unknown): unknown => {
  if (Array.isArray(x)) return x.map(normTreat);
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) {
      out[k] = k === 'treat' && typeof o[k] === 'string'
        ? (o[k] as string).toLowerCase().replace(/\b(treat|card|the|a|an)\b/g, '').replace(/[\s_-]+/g, '')
        : normTreat(o[k]);
    }
    return out;
  }
  return x;
};

function sweetlandsCanonicalMove(o: Record<string, unknown>): Record<string, unknown> {
  return normTreat(o) as Record<string, unknown>;
}

export const devHooks: GameDevHooks = {
  analysis: sweetlandsImperiumAnalysis,
  // Rules-checker adapters (./verify/), by adapter id.
  verify: {
    'sweetlands-imperium': sweetlandsVerifyAdapter as unknown as VerifyAdapter<unknown>,
    'sweetlands-imperium-5p': sweetlands5pVerifyAdapter as unknown as VerifyAdapter<unknown>,
  },
  sweeps: sweetlandsSweeps,
  desync: { renderValue: renderIntelCard, canonicalMove: sweetlandsCanonicalMove },
};
