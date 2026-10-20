import type { SessionState } from '@zekel/game-kit';
import type { NGGState } from './types.js';

/** Sample only facts unavailable to the observing seat. Digital tracking is
 *  not public visibility: opponents' hands, deck order, sealed commitments,
 *  and unrevealed spy assignments remain hidden during search. */
export function sampleHiddenState(state: SessionState<NGGState>, observer: string, rng: () => number): SessionState<NGGState> {
  const g = state.gameState;
  const visible = new Set([observer]);
  for (const t of g.treaties) if (t.type === 'shared-tactics' && t.partners.includes(observer))
    t.partners.forEach(id => visible.add(id));
  const unknown = g.players.filter(p => !visible.has(p.playerId));
  const pool = [...g.battleDeck, ...unknown.flatMap(p => p.hand)].sort();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  for (const id of pool) delete g.cardOwners[id];
  for (const p of unknown) {
    p.hand = pool.splice(0, p.hand.length);
    for (const id of p.hand) g.cardOwners[id] = p.playerId;
  }
  g.battleDeck = pool;
  // A sealed commitment is still in its owner's hand until the joint reveal.
  if (g.battle?.phase === 'commit') {
    // Shared Tactics reveals a partner's hand, not their sealed choice.
    const reserved = new Set(Object.entries(g.battle.commitments)
      .filter(([id]) => id === observer).flatMap(([,c]) => typeof c === 'object' ? [c.cardInstanceId] : []));
    for (const [id, c] of Object.entries(g.battle.commitments)) {
      if (id === observer || c === 'pending') continue;
      const hand = g.players.find(p => p.playerId === id)!.hand.filter(x => !reserved.has(x));
      const pick = Math.floor(rng() * (hand.length + 1));
      const card = hand[pick];
      g.battle.commitments[id] = card ? { cardInstanceId: card, playingPlayerId: id } : 'pass';
      if (card) reserved.add(card);
    }
  }
  const viewer = g.players.find(p => p.playerId === observer)!;
  for (const p of g.players.filter(p => p.playerId !== observer)) {
    const heroes = g.heroes.filter(h => h.ownerId === p.playerId && !h.dead).map(h => h.id);
    for (const spy of p.spyAssignments.filter(s => s.active)) {
      if (!heroes.length) continue;
      spy.heroId = heroes[Math.floor(rng() * heroes.length)]!;
      heroes.splice(heroes.indexOf(spy.heroId), 1);
    }
  }
  return state;
}
