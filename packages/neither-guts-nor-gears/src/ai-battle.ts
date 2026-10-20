// Neither Guts nor Gears — the AI's choices inside a battle (§9–§10).
//
// Battles are short and mostly forced: commit a card, activate each unit,
// react to an attack, decide to stay or retreat. These rules of thumb read
// the battle's live stats (currentDmgOf / currentDefOf, the same numbers the
// engine resolves with) and the public board; an opponent's hand and spy
// carrier are never read.

import type { NGGMove, NGGState, PlayerState } from './types.js';
import { BATTLE_CARDS } from './data/catalogs.js';
import { currentDefOf, currentDmgOf, keepClericForLeader } from './engine-battle.js';

type Move<K extends NGGMove['type']> = Extract<NGGMove, { type: K }>;

function sides(state: NGGState, p: PlayerState) {
  const b = state.battle!;
  const mySide = b.units.find((u) => u.ownerId === p.playerId)?.side ?? b.sides?.[p.playerId];
  const mine = b.units.filter((u) => u.side === mySide);
  const theirs = b.units.filter((u) => u.side !== mySide);
  return { b, mine, theirs };
}

function isLeaderRef(state: NGGState, ref: string): boolean {
  return state.heroes.some((h) => h.id === ref && h.isLeader && !h.dead);
}

/** How many of `them` my side can kill this pass, and they of mine. */
export function battleEdge(state: NGGState, p: PlayerState): { myKills: number; theirKills: number; myLeaderAtRisk: boolean } {
  const { mine, theirs } = sides(state, p);
  const kills = (atk: typeof mine, def: typeof mine) => {
    let n = 0;
    const used = new Set<string>();
    for (const a of atk) {
      const d = currentDmgOf(state, a);
      if (d <= 0) continue;
      const t = def.find((x) => !used.has(x.unitRef) && d >= currentDefOf(state, x));
      if (t) { used.add(t.unitRef); n += a.aoe ? def.filter((x) => d >= currentDefOf(state, x)).length : 1; }
    }
    return n;
  };
  const myLeader = mine.find((u) => isLeaderRef(state, u.unitRef) && u.ownerId === p.playerId);
  const risk = !!myLeader && theirs.some((a) => currentDmgOf(state, a) >= currentDefOf(state, myLeader));
  return { myKills: kills(mine, theirs), theirKills: kills(theirs, mine), myLeaderAtRisk: risk };
}

export function commitScore(state: NGGState, p: PlayerState, move: Move<'commit_battle_card'>): number {
  if (!move.card) return 10;
  const { mine, theirs } = sides(state, p);
  const { myKills, theirKills, myLeaderAtRisk } = battleEdge(state, p);
  const label = move.card.toLowerCase();
  // Retreat pulls every mobile unit out before anyone fights: an escape from
  // a fight I'm losing (or my Leader could die), never a default play.
  if (label.includes('retreat')) return myLeaderAtRisk || theirKills > myKills ? 34 : 2;
  let s = 20;
  const myDmg = mine.reduce((a, u) => a + Math.max(0, currentDmgOf(state, u)), 0);
  if (label.includes('+1 dmg') && myDmg > 0) s += 14;
  if (label.includes('−1 def') || label.includes('-1 def')) s += 10;
  if (label.includes('+1 def')) s += theirKills > 0 ? 12 : 4;
  if (label.includes('−1 dmg') || label.includes('-1 dmg')) s += theirKills > 0 ? 12 : 4;
  if (label.includes('initiative') && theirs.some((u) => u.init > Math.max(...mine.map((m) => m.init)))) s += 8;
  if (label.includes('rally') && mine.length < theirs.length) s += 12;
  if (label.includes('counter')) s += 6;
  if (label.includes('extra')) s += 5;
  return s;
}

export function activationScore(state: NGGState, p: PlayerState, move: Move<'battle_activation'>): number {
  const a = move.action;
  const b = state.battle!;
  const me = b.units.find((u) => u.unitRef === move.unit);
  if (a.kind === 'spy_attack' || a.kind === 'invisible') {
    // The reveal spends the spy: only on a hero, the Leader above all.
    const tgt = b.units.find((u) => u.unitRef === a.target);
    return isLeaderRef(state, tgt?.unitRef ?? '') ? 300 : tgt?.isHero ? 70 : 3;
  }
  if (a.kind === 'self_destruct') {
    // Ruling #111: worth it when the blast kills more of theirs than of ours,
    // never when it would kill my own Leader.
    if (!me) return 1;
    const dmg = currentDmgOf(state, me) + 3;
    const others = b.units.filter((u) => u.unitRef !== me.unitRef);
    const theirs = others.filter((u) => u.side !== me.side && dmg >= currentDefOf(state, u));
    const ours = others.filter((u) => u.side === me.side && dmg >= currentDefOf(state, u));
    if (theirs.length === 0) return 1;
    if (ours.some((u) => u.ownerId === p.playerId && isLeaderRef(state, u.unitRef))) return 0;
    let s = 20 + 30 * theirs.length - 30 * ours.length - 5 * Math.max(0, currentDmgOf(state, me));
    if (theirs.some((u) => isLeaderRef(state, u.unitRef))) s += 200;
    if (ours.some((u) => isLeaderRef(state, u.unitRef))) s -= 150; // an ally's Leader
    return s;
  }
  if (a.kind === 'attack') {
    if (!me) return 40;
    if (me.aoe) {
      const hits = b.units.filter((u) => u.side !== me.side && currentDmgOf(state, me) >= currentDefOf(state, u));
      if (hits.length === 0) return 2;
      return 40 + 30 * hits.length + (hits.some((u) => isLeaderRef(state, u.unitRef)) ? 200 : 0);
    }
    const tgt = b.units.find((u) => u.unitRef === a.target);
    if (!tgt) return 40;
    // Damage does not carry over between attacks: only a killing hit counts.
    if (currentDmgOf(state, me) < currentDefOf(state, tgt)) return 2;
    let s = 70;
    if (tgt.isHero) s += 18;
    if (isLeaderRef(state, tgt.unitRef)) s += 200;
    s += Math.max(0, currentDmgOf(state, tgt)) * 3; // take out their hitters first
    return s;
  }
  if (a.kind === 'ability') {
    const cost = a.mana ?? 0;
    let s = 30 - cost;
    if (a.ability === 'ice_blast') s += 12;
    if (a.ability === 'fiery_explosion') {
      const hits = b.units.filter((u) => me && u.side !== me.side && 2 >= currentDefOf(state, u)).length;
      s = hits ? 40 + 25 * hits : 4;
    }
    if (a.ability === 'dehance') s += 8;
    if (a.ability === 'enhance') s += 6;
    if (a.ability === 'wizard_missile') s = 30;
    return s;
  }
  return 5; // pass — the floor
}

export function defenseScore(state: NGGState, p: PlayerState, move: Move<'resolve_battle_defense'>): number {
  const d = move.defense;
  const b = state.battle!;
  const target = b.defense ? b.units.find((u) => u.unitRef === b.defense!.targetRef) : undefined;
  const lethal = !!b.defense && !!target && b.defense.damage >= currentDefOf(state, target);
  if (d.kind === 'none') return lethal ? 5 : 30;
  if (d.kind === 'decoy') return lethal || b.defense?.kind === 'instant-kill' ? 60 : 8;
  if (d.kind === 'cleric_save') {
    // Keep the last save for my Leader when it is also about to die here.
    if (target && b.defense?.kind === 'aoe' && keepClericForLeader(state, p.playerId, target, b.defense.aoeWouldDie ?? [])) return 1;
    return lethal ? 45 + (target?.isHero ? 20 : 0) : 3;
  }
  if (d.kind === 'mana_shield') {
    if (!b.defense || !target || !lethal) return 3;
    const need = b.defense.damage - currentDefOf(state, target) + 1;
    const m = d.mana ?? 0;
    if (m >= need) return 50 - (m - need) * 3; // just enough
    return 4;
  }
  return 20;
}

export function retreatScore(state: NGGState, p: PlayerState, move: Move<'choose_retreat'>): number {
  const { myKills, theirKills, myLeaderAtRisk } = battleEdge(state, p);
  const losing = myLeaderAtRisk || theirKills > myKills;
  if (move.stay || move.destination === null) return losing ? 10 : 30;
  return losing ? 35 : 5;
}

export function counterScore(state: NGGState, p: PlayerState, move: Move<'choose_counter_target'>): number {
  const b = state.battle!;
  const target = b.committed.find((c) => {
    const def = BATTLE_CARDS.find((x) => x.id === c.card);
    return def?.label.toLowerCase() === move.card.toLowerCase() && (!move.played_by || c.playingPlayerId === move.played_by);
  });
  if (!target) return 30;
  if (target.playingPlayerId === p.playerId) return 1; // never my own
  const label = move.card.toLowerCase();
  let s = 40;
  if (label.includes('initiative')) s += 14;
  if (label.includes('bonus')) s += 10;
  if (label.includes('rally')) s += 8;
  if (label.includes('extra')) s += 12;
  if (label.includes('retreat')) s += 4;
  return s;
}

export function extraScore(_state: NGGState, _p: PlayerState, move: Move<'select_extra_cards'>): number {
  if (move.cards.length === 0) return 5;
  let s = 10;
  for (const c of move.cards) {
    const l = c.toLowerCase();
    if (l.includes('initiative')) s += 14;
    else if (l.includes('bonus')) s += 12;
    else if (l.includes('rally')) s += 8;
    else s += 1;
  }
  return s;
}

export function rallyScore(state: NGGState, p: PlayerState, move: Move<'select_rally_units'>): number {
  if (move.units.length === 0) return 10;
  const { mine, theirs } = sides(state, p);
  // Never pull the Leader into a fight it could die in.
  if (move.units.some((id) => isLeaderRef(state, id))) return 1;
  return 20 + (mine.length < theirs.length ? move.units.length * 6 : -move.units.length * 2);
}
