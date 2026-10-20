// Neither Guts nor Gears — a scripted opponent playing the wizard tech rush
// that beat the hard AI (docs/Neither Guts nor Gears beating the hard AI.md,
// Zeke and Fabel, 2026-10-07). A benchmark only: it measures the hard AI
// against a known strong line. It is not an AI level and is never offered to
// players.
//
// The recipe, as written in that doc:
//   - Leader: Dowser if she is still free, else Quartermaster, else Foreman.
//   - Build: an Embassy in round one (treaties need it), Surfs to seven, the
//     three Libraries (Enchantment first: Haste), then the cheapest type not
//     yet owned.
//   - Research: Haste, the Extra Build Card, the Extra Research Card, then the
//     cheapest new technology. No battle cards.
//   - Milestones: Greymore first, then Dowser, Smyth, the extra-card heroes.
//   - Planning: go last — filler Move/Battle cards first while anyone else is
//     still planning, then Research, then Build (the stack resolves last card
//     first, so the Builds pay first and the Research uses what they leave).
//   - With Haste: commit every free Surf on the round's first purchase; the
//     surplus is banked for later purchases. Extra Surfs go where the bank is
//     thinnest in the resources most costs use (wood, ore, ether, then water).
//   - Treaties: in rounds 1–3 offer Open Borders, then Shared Resources, to
//     each seat with no treaty with us yet (culture is only fuel for the
//     milestones); accept every offer but the Culture Treaty; never break one.
//   - Leader and Greymore stay on the Castle (the bot never moves heroes).
// Anything else (battles, access requests, spies) is answered by the hard AI.
//
// `pivot` (Zeke, 2026-10-08: "I initially went Technology and then, because I
// had the units built for the technology win I just sent them to kill a
// leader"): on a Move/Battle action, once the bot's pieces other than its
// Leader could kill some rival's Leader in a battle, it marches and attacks
// with the hard AI's own movement and battle choices on the military lever.

import type { NGGMove, NGGState, PlayerState } from '../types.js';
import {
  availableCollectorIds, bankOf, byId, collectorsAt, effectiveResourceAt, hasHaste, isLegalPlacement, locationOwner, speciesOf,
} from '../engine.js';
import { getLegalMoves } from '../legalMoves.js';
import { chooseMove } from '../ai.js';
import { costTotal, itemByName, itemsFor, type SimItem } from '../ai-econ.js';
import { coordKey } from '../data/maps.js';
import { strikeForce, strikeKills } from '../ai-strike.js';

const LEADERS = ['wren', 'quartermaster', 'foreman'];
const MILESTONE_HEROES = ['greymore', 'wren', 'smyth', 'quartermaster', 'archivist', 'kettering', 'foreman'];
const BUILD_FIRST = ['library-of-enchantment', 'library-of-illusion', 'library-of-evocation'];
const RESEARCH_FIRST = ['haste', 'extra-build-card', 'extra-research-card'];
const SURFS_WANTED = 7;
const ARMY = ['dragon-hoard', 'dragon', 'evoker', 'enchantress'];

type Payment = Array<{ collectorId: string; coord: string }>;

function surfCount(p: PlayerState): number {
  return Object.keys(p.collectorsAvailable).filter((id) => id.startsWith('surf-')).length;
}

function itemOf(state: NGGState, p: PlayerState, move: NGGMove): SimItem | undefined {
  const species = speciesOf(p);
  if (move.type === 'build') return itemByName(species, move.item);
  if (move.type === 'research' && move.kind === 'tech') return itemByName(species, move.tech);
  void state;
  return undefined;
}

/** The purchase the recipe wants from the offered menu, or null to skip. */
function pickPurchase(state: NGGState, p: PlayerState, legal: NGGMove[], army = false): NGGMove | null {
  const buys = legal.filter((m) => m.type === 'build' || (m.type === 'research' && m.kind === 'tech'));
  const byId = (id: string) => buys.find((m) => itemOf(state, p, m)?.id === id);
  const fresh = (m: NGGMove) => { const it = itemOf(state, p, m); return !!it && !p.acquiredTypes.includes(it.id); };
  const isBuild = buys.some((m) => m.type === 'build');
  if (isBuild) {
    if (byId('embassy') && fresh(byId('embassy')!)) return byId('embassy')!;
    if (surfCount(p) < SURFS_WANTED && byId('surf')) return byId('surf')!;
    for (const id of BUILD_FIRST) { const m = byId(id); if (m && fresh(m)) return m; }
  } else {
    for (const id of RESEARCH_FIRST) { const m = byId(id); if (m && fresh(m)) return m; }
  }
  // With the pivot, the fighting types come first among the new ones (the
  // Dragon's Hoard and Dragon, Evoker, Enchantress — Zeke's game 1 had a
  // Dragon by round 4): they count for technology and make the army.
  const fights = (m: NGGMove) => army && ARMY.includes(itemOf(state, p, m)!.id) ? 0 : 1;
  const options = buys.filter(fresh).sort((a, b) => fights(a) - fights(b) || costTotal(itemOf(state, p, a)!.cost) - costTotal(itemOf(state, p, b)!.cost));
  return options[0] ?? null;
}

/** With Haste and an empty bank (the round's first purchase): add every free
 *  Surf to the payment on any tile it may legally go, so the surplus banks. */
function commitAllSurfs(state: NGGState, p: PlayerState, payment: Payment, buying: SimItem | undefined): Payment {
  if (!hasHaste(p) || Object.keys(bankOf(p)).length > 0) return payment;
  const used = new Set(payment.map((x) => x.collectorId));
  const free = availableCollectorIds(state, p).filter((id) => id.startsWith('surf-') && !used.has(id));
  const out = [...payment];
  const taken = new Set(out.map((x) => x.coord));
  // What is left after this purchase, against what the rest of the round's
  // cards will want: each Surf goes to the resource most short.
  const held: Record<string, number> = { ...bankOf(p) };
  for (const pl of payment) { const r = effectiveResourceAt(state, pl.coord); held[r] = (held[r] ?? 0) + 2; }
  for (const [r, n] of Object.entries(buying?.cost ?? {})) held[r] = (held[r] ?? 0) - (n ?? 0);
  const need = roundNeeds(state, p, buying);
  const weight: Record<string, number> = { wood: 0, ore: 0, ether: 0.5, oil: 1, water: 1.5 };
  for (const id of free) {
    const spots = state.tiles.map((t) => coordKey(t.c, t.r)).filter((k) => !taken.has(k) && collectorsAt(state, k).length === 0
      && (locationOwner(state, k) === null || locationOwner(state, k) === p.playerId) && isLegalPlacement(state, p, k, out));
    if (spots.length === 0) break;
    const score = (k: string) => { const r = effectiveResourceAt(state, k); return 4 * ((held[r] ?? 0) - (need[r] ?? 0)) + (weight[r] ?? 2); };
    const spot = spots.reduce((a, b) => (score(b) < score(a) ? b : a));
    out.push({ collectorId: id, coord: spot });
    taken.add(spot);
    const r = effectiveResourceAt(state, spot); held[r] = (held[r] ?? 0) + 2;
  }
  return out;
}

/** What the bot's other Build and Research cards still queued this round
 *  will cost: the cheapest new type for each, in the order they resolve. */
function roundNeeds(state: NGGState, p: PlayerState, buying: SimItem | undefined): Record<string, number> {
  const species = speciesOf(p);
  const queued = state.actionStack.filter((c) => c.ownerId === p.playerId && (c.cardKind === 'build' || c.cardKind === 'research'));
  const owned = new Set([...p.acquiredTypes, ...(buying ? [buying.id] : [])]);
  const buildings = new Set([...p.buildings, ...(buying?.kind === 'building' ? [buying.name] : [])]);
  const need: Record<string, number> = {};
  for (const card of queued) {
    const research = card.cardKind === 'research';
    const options = itemsFor(species).filter((it) => (it.kind === 'research') === research && !owned.has(it.id)
      && (!it.prereq || buildings.has(it.prereq)) && !(it.kind === 'unit' && it.id === 'surf'))
      .sort((a, b) => costTotal(a.cost) - costTotal(b.cost));
    const pick = (research ? RESEARCH_FIRST.map((id) => options.find((o) => o.id === id)).find((x) => x) : undefined) ?? options[0];
    if (!pick) continue;
    owned.add(pick.id);
    if (pick.kind === 'building') buildings.add(pick.name);
    for (const [r, n] of Object.entries(pick.cost)) need[r] = (need[r] ?? 0) + (n ?? 0);
  }
  return need;
}

/** Planning: filler first while anyone else still plans, then Research,
 *  then Build. Pass once nothing is left to place. */
function pickPlanning(state: NGGState, p: PlayerState, legal: NGGMove[]): NGGMove {
  const place = (card: string) => legal.find((m) => m.type === 'plan_action' && m.card === card);
  const othersPlanning = state.planningOrder.some((pid) => pid !== p.playerId);
  if (othersPlanning && place('move_battle')) return place('move_battle')!;
  return place('research') ?? place('build') ?? place('move_battle') ?? legal.find((m) => m.type === 'plan_action' && m.card === 'pass')!;
}

export function techRushMove(state: NGGState, playerId: string, opts: { pivot?: boolean } = {}): NGGMove {
  const p = byId(state, playerId);
  const legal = getLegalMoves(state, playerId).map((l) => l.move);
  const pend = state.pending;
  const hard = () => chooseMove(state, playerId, 'hard').move;

  if (pend?.kind === 'choose_faction') {
    const wizard = legal.find((m) => m.type === 'choose_faction' && ['covenant', 'schism', 'brass-circle'].includes(m.faction));
    return wizard ?? legal[0]!;
  }
  if (pend?.kind === 'choose_leader') {
    for (const id of LEADERS) { const m = legal.find((x) => x.type === 'choose_leader' && x.hero.toLowerCase().includes(heroWord(id))); if (m) return m; }
    return hard();
  }
  if (pend?.kind === 'choose_milestone_hero') {
    for (const id of MILESTONE_HEROES) { const m = legal.find((x) => x.type === 'choose_milestone_hero' && x.hero.toLowerCase().includes(heroWord(id))); if (m) return m; }
    return hard();
  }
  if (pend?.kind === 'smyth_reward') {
    for (const id of RESEARCH_FIRST) {
      const m = legal.find((x) => JSON.stringify(x).toLowerCase().includes(id.replace(/-/g, ' ')) || JSON.stringify(x).includes(id));
      if (m) return m;
    }
    return hard();
  }
  if (pend?.kind === 'treaty_response') {
    const accept = pend.treatyType !== 'culture-treaty';
    return legal.find((m) => m.type === 'respond_treaty' && m.accept === accept) ?? hard();
  }
  if (pend?.kind === 'treaty_break_decision') return legal.find((m) => m.type === 'skip_action') ?? hard();
  if (pend && pend.kind !== 'second_purchase') return hard();

  if (state.phase === 'planning') return pickPlanning(state, p, legal);

  if (state.phase === 'action' && opts.pivot && state.activeAction?.cardKind === 'move_battle' && canStrike(state, playerId)) {
    return chooseMove(state, playerId, 'hard', 'military').move;
  }

  if (state.phase === 'action') {
    // Rounds 1–3: Open Borders, then Shared Resources, to each seat we have
    // no treaty with and have not offered to this round.
    if (state.round <= 3) {
      for (const type of ['open borders', 'shared resources']) {
        const offer = legal.find((m) => m.type === 'form_treaty' && m.treaty_type.toLowerCase().replace(/-/g, ' ') === type
          && !state.treaties.some((t) => t.partners.includes(playerId) && t.partners.includes(m.partner))
          && !OFFERED.has(`${state.seed}|${state.round}|${m.partner}`));
        if (offer) { OFFERED.add(`${state.seed}|${state.round}|${(offer as { partner: string }).partner}`); return offer; }
      }
    }
    const buy = pickPurchase(state, p, legal, opts.pivot);
    if (buy && (buy.type === 'build' || buy.type === 'research')) {
      return { ...buy, payment: commitAllSurfs(state, p, buy.payment, itemOf(state, p, buy)) } as NGGMove;
    }
    const skip = legal.find((m) => m.type === 'skip_action');
    if (skip) return skip;
  }
  return hard();
}

/** Could the bot's pieces other than its Leader kill some rival's Leader in a
 *  battle (the engine-played pretend battle the AI uses)? */
function canStrike(state: NGGState, playerId: string): boolean {
  const force = strikeForce(state, playerId, true).map((f) => ({ kind: f.kind, id: f.id }));
  if (force.length === 0) return false;
  return state.players.some((q) => q.playerId !== playerId && state.heroes.some((h) => h.ownerId === q.playerId && h.isLeader && !h.dead && h.coord)
    && strikeKills(state, playerId, q.playerId, force));
}

/** Offers made, one per seat per round (game seed | round | seat). */
const OFFERED = new Set<string>();

/** A word of the hero's printed name that its menu label contains. */
function heroWord(id: string): string {
  return ({ wren: 'dowser', greymore: 'greymore', smyth: 'smyth', quartermaster: 'quartermaster', archivist: 'archivist', kettering: 'kettering', foreman: 'foreman' } as Record<string, string>)[id] ?? id;
}
