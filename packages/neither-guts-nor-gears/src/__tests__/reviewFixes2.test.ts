// Regression locks for the second review batch (six findings). Where a full
// end-to-end fixture is brittle, the lock asserts at the ENGINE's own exported
// surfaces (the same functions the dispatcher calls) — same rule set, honest.

import { describe, it, expect } from 'vitest';
import neitherGutsNorGears from '../index.js';
import type { NGGMove, NGGState, BattleState, BattleUnit } from '../types.js';
import { battleActivation, commitBattleCard, currentInitOf, resolveBattleDefense, startBattle, modifierSumPub } from '../engine-battle.js';
import { cardByInstanceId } from '../engine.js';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';

import { keepCores } from './pendingFixtures.js';
function apply(s: SessionState<NGGState>, playerId: string, move: NGGMove) {
  return neitherGutsNorGears.applyMove(s, playerId, move);
}

function placeUnit(g: NGGState, pid: string, coord: string, typeId: string): string {
  const seq = g.units.filter((u) => u.ownerId === pid && u.typeId === typeId).length + 1;
  const isRobotPlatform = ['spinner', 'spitter', 'immobile-combat-platform', 'large-combat-platform', 'wall-platform', 'water-collector', 'wood-collector', 'ore-collector', 'oil-collector', 'ether-collector'].includes(typeId);
  const id = `u-${typeId}-${pid}-${seq}`;
  g.units.push({ id, typeId, ownerId: pid, coord, allocatedCoreId: isRobotPlatform ? `core-${pid}-${typeId}-${seq}` : null });
  return id;
}

function base2p(): SessionState<NGGState> {
  const players: PlayerConfig[] = [
    { player_id: 'wiz', kind: 'human' }, { player_id: 'rob', kind: 'human' },
  ];
  let s = neitherGutsNorGears.createSession(players, { seed: 3, setupFirstPlayerId: 'wiz' });
  s = apply(s, 'wiz', { type: 'assign_setup_choices', selections: { wiz: 'covenant', rob: 'ledger' } }).newState;
  s = apply(s, 'wiz', { type: 'choose_leader', hero: 'Warden Hesper Quill' }).newState;
  s = apply(s, 'rob', { type: 'choose_leader', hero: 'Kestrel Nine' }).newState;
  s = apply(s, 'rob', { type: 'choose_starting_location', location: '@2' }).newState;
  s = apply(s, 'wiz', { type: 'choose_starting_location', location: '@1' }).newState;
  s = keepCores(s);
  return s;
}

/** A hand-raised battle (engine-level) — the same startBattle path the
 *  movement entry trigger calls, wired directly so fixtures stay small. */
function openHandBattle(g2: NGGState, attackerId: string, origin: string, at: string, attackers: Array<{ kind: 'unit' | 'hero'; id: string }>): void {
  const attacker = g2.players.find((p) => p.playerId === attackerId)!;
  startBattle(g2, attacker, origin, at, attackers, []);
}


/** Settle every human pending of the given kind list with the no-op move. */
function settlePends(sRef: { gameState: NGGState }, kinds: string[], guardMax = 20): void {
  let guard = 0;
  while (guard++ < guardMax) {
    const p = sRef.gameState.pending;
    if (!p || !kinds.includes(p.kind)) return;
    if (p.kind === 'battle_commit') commitBattleCard(sRef.gameState, p.forPlayerId, null);
    else if (p.kind === 'elara_spell') { throw new Error('elara should not appear in these hand-raised battles (no Elara leaders)'); }
    else throw new Error(`unhandled pending ${p.kind} in settlePends`);
  }
}

/** After starting a hand battle, run commitments and reveal — lands the battle
 *  in its activations phase. */
function driveToActivations(sRef: { gameState: NGGState }): void {
  settlePends(sRef, ['battle_commit']);
  // resolveCardBatches is triggered by the last commit; activations start after.
}

describe('review round 2 (six findings)', () => {
  it('P1: a winning AoE that kills the last enemy Leader records victory and stops — no post-endGame crash', () => {
    let s = base2p();
    // rob's Leader at a tile; wiz's Dragon in the SAME tile's neighborhood? No:
    // hand-raised: battle at (0,2) with rob's Kestrel as the only defender
    // (leader, DEF 6) and wiz's Dragon as attacker. Boost via modifiers: a
    // +3 dmg record on the dragon (test-side, as a card/effect would).
    const g = s.gameState;
    g.heroes.find((h) => h.ownerId === 'rob' && h.isLeader)!.coord = '0,2';
    const dragonId = placeUnit(g, 'wiz', '0,2', 'dragon');
    const bA = g.players.find((p) => p.playerId === 'wiz')!;
    openHandBattle(g, 'wiz', '0,0', '0,2', [{ kind: 'unit', id: dragonId }]);
    driveToActivations({ gameState: g });
    const b = g.battle!;
    // The Dragon's attack: 3 dmg + a scripted +3 modifier = 6 vs DEF 6 → dies.
    b.modifiers.push({ targetRef: dragonId, dmg: 3, source: 'test-boost' });
    // Drive the activation directly through battleActivation's aoe path.
    const dmg = 3 + modifierSumPub(g, b.units.find((u) => u.unitRef === dragonId)!, 'dmg');
    expect(dmg).toBe(6);
    // Queue order: Kestrel (I70) is defender and first — she passes, dragon acts.
    // Both are human seats — drive the queue.
    let guard = 0;
    while (b.activationQueue[b.activationCursor] !== dragonId && guard++ < 8) {
      const cur = b.activationQueue[b.activationCursor]!;
      const owner = b.units.find((u) => u.unitRef === cur)!.ownerId;
      battleActivation(g, owner, { type: 'battle_activation', unit: cur, action: { kind: 'pass' } } as never);
    }
    const r = battleActivation(g, 'wiz', { type: 'battle_activation', unit: dragonId, action: { kind: 'attack', target: 'aoe' } } as never);
    void r;
    // One kill on the ledger; game over AT the boundary; battle is null; no crash.
    expect(g.players.find((p) => p.playerId === 'wiz')!.leaderKills).toBe(1);
    expect(g.phase).toBe('game_over');
    expect(g.result?.winners).toEqual(['wiz']);
    expect(g.battle).toBeNull();
  });

  it('P1: an AI-shielded unit on an insufficient spend DIES to the AoE (no splice-out)', () => {
    let s = base2p();
    const g = s.gameState;
    g.players.find((p) => p.playerId === 'rob')!.kind = 'ai'; // the defending seat resolves AI-side
    // rob holds an AI-wizard? Species mismatch — put the SHIELD side on wiz but
    // mark wiz AI. The attacker is a human rob Dragon.
    g.players.find((p) => p.playerId === 'wiz')!.kind = 'ai';
    const evokerId = placeUnit(g, 'wiz', '0,2', 'evoker');
    g.players.find((p) => p.playerId === 'wiz')!.research.push('mana-shield');
    g.players.find((p) => p.playerId === 'wiz')!.manaCurrent = 1; // 3 dmg → need 3 mana; holds 1
    const dragonId = placeUnit(g, 'rob', '0,0', 'dragon');
    openHandBattle(g, 'rob', '0,0', '0,2', [{ kind: 'unit', id: dragonId }]);
    driveToActivations({ gameState: g });
    const b = g.battle!;
    let guard = 0;
    while (b.activationQueue[b.activationCursor] !== dragonId && guard++ < 8) {
      const cur = b.activationQueue[b.activationCursor]!;
      const owner = b.units.find((u) => u.unitRef === cur)!.ownerId;
      battleActivation(g, owner, { type: 'battle_activation', unit: cur, action: { kind: 'pass' } } as never);
    }
    battleActivation(g, 'rob', { type: 'battle_activation', unit: dragonId, action: { kind: 'attack', target: 'aoe' } } as never);
    // The AI had 1 mana vs a 3-damage hit — the Evoker must be dead (the old
    // code spliced it out of the dying list even on an insufficient spend).
    expect(g.units.some((u) => u.id === evokerId)).toBe(false);
  });

  it('P2: Enhance adds exactly +2 DMG (ruling #109; the modifier record is the single source)', () => {
    let s = base2p();
    const g = s.gameState;
    const evokerId = placeUnit(g, 'wiz', '0,2', 'evoker');
    const enchId = placeUnit(g, 'wiz', '0,2', 'enchantress');
    // (0,0) is not a tile on the 2-player map; (0,4) is next to (0,2).
    placeUnit(g, 'rob', '0,4', 'spitter');
    openHandBattle(g, 'wiz', '0,2', '0,4', [{ kind: 'unit', id: enchId }]);
    driveToActivations({ gameState: g });
    const b = g.battle!;
    g.players.find((p) => p.playerId === 'wiz')!.manaCurrent = 5;
    // Enchantress I75 acts first.
    let guard = 0;
    while (b.activationQueue[b.activationCursor] !== enchId && guard++ < 8) {
      const cur = b.activationQueue[b.activationCursor]!;
      const owner = b.units.find((u) => u.unitRef === cur)!.ownerId;
      battleActivation(g, owner, { type: 'battle_activation', unit: cur, action: { kind: 'pass' } } as never);
    }
    battleActivation(g, 'wiz', { type: 'battle_activation', unit: enchId, action: { kind: 'ability', ability: 'enhance', target: enchId } } as never);
    // The only wizard unit in the battle is the Enchantress — Enhance self.
    // Lock: exactly +2 total via the modifier record (the raw stat stays 0).
    const enhMods = b.modifiers.filter((m) => String(m.source).startsWith('enhance-'));
    expect(enhMods.reduce((a, m) => a + (m.dmg ?? 0), 0)).toBe(2);
    const ench = b.units.find((u) => u.unitRef === enchId)!;
    expect(ench.dmg).toBe(0); // printed stat untouched
    expect(enhMods.length).toBe(1); // one modifier record, not two
  });

  it('P2: the single-target AI shield prices the DECLARED damage (incl. bonuses), not the raw stat line', () => {
    let s = base2p();
    const g = s.gameState;
    g.players.find((p) => p.playerId === 'wiz')!.kind = 'ai';
    const evokerId = placeUnit(g, 'wiz', '0,2', 'evoker'); // DEF 1, shield-eligible
    g.players.find((p) => p.playerId === 'wiz')!.research.push('mana-shield');
    g.players.find((p) => p.playerId === 'wiz')!.manaCurrent = 1;
    g.players.find((p) => p.playerId === 'wiz')!.manaMax = 1;
    const spitterId = placeUnit(g, 'rob', '0,0', 'spitter');
    openHandBattle(g, 'rob', '0,0', '0,2', [{ kind: 'unit', id: spitterId }]);
    const b = g.battle!;
    driveToActivations({ gameState: g });
    // Kestrel is rob's leader — ride her into the battle so her +2 applies.
    g.heroes.find((h) => h.ownerId === 'rob' && h.isLeader)!.coord = '0,0';
    // Add her to the attackers AFTER openHandBattle (heroes ride alongside):
    b.units.push({ unitRef: 'kestrel', ownerId: 'rob', isHero: true, side: 'attackers', init: 70, dmg: 3, def: 6, aoe: false, activated: false, clericUsedThisPass: false, label: 'Kestrel Nine' });
    // Spitter I95 is first; it attacks the Evoker. Declared dmg 1 + 2 = 3; AI
    // shield had 1 mana — need 3. The old code priced the need from RAW dmg (1)
    // and "saved" it; now the AI sees it can't afford survival and declines → dies.
    const r = battleActivation(g, 'rob', { type: 'battle_activation', unit: spitterId, action: { kind: 'attack', target: evokerId } } as never);
    void r;
    expect(g.units.some((u) => u.id === evokerId)).toBe(false);
    expect(g.players.find((p) => p.playerId === 'wiz')!.manaCurrent).toBe(1); // never wasted on a hopeless save
  });

  it('P2: a Decoy destination must be §7.3-eligible — never the attack origin, never Peace-bound', () => {
    // 4p: battle pair p2 (rob) attacks p1 (wiz) at p1's spy hero standing on a
    // NEUTRAL tile adjacent to p3's home. p1×p3 are Peace-bound: the decoy may
    // NOT step into p3's home space. The engine enforces §7.3's "eligible" via
    // the same hospitality check movement uses.
    const players: PlayerConfig[] = Array.from({ length: 4 }, (_, i) => ({ player_id: `p${i + 1}`, kind: 'human' as const }));
    let s = neitherGutsNorGears.createSession(players, { seed: 13, setupFirstPlayerId: 'p1' });
    s = apply(s, 'p1', { type: 'assign_setup_choices', selections: { p1: 'covenant', p2: 'schism', p3: 'ledger', p4: 'foundry' } }).newState;
    const leaders: Record<string, string> = { p1: 'Warden Hesper Quill', p2: 'Dowser Wren Calloway', p3: 'Kestrel Nine', p4: 'Marshal Corvin Ashlock' };
    while (s.gameState.phase === 'setup_leaders') {
      const pend = s.gameState.pending!;
      s = apply(s, pend.forPlayerId, { type: 'choose_leader', hero: leaders[pend.forPlayerId]! }).newState;
    }
    while (s.gameState.phase === 'setup_locations') {
      const pend = s.gameState.pending!;
      s = apply(s, pend.forPlayerId, { type: 'choose_starting_location', location: { p4: '@4', p3: '@3', p2: '@2', p1: '@1' }[pend.forPlayerId]! }).newState;
    }
    s = keepCores(s);
    const g = s.gameState;
    g.treaties.push({ type: 'peace', partners: ['p1', 'p3'] });
    g.players.find((p) => p.playerId === 'p1')!.spyAssignments.push({ source: 'illusionist', heroId: 'warden', active: true });

    // p3's base tile + one of its neighbors (both on the 3-4p map).
    const cBase = g.bases.find((b) => b.ownerId === 'p3')!.coord;
    const [bc, br] = cBase.split(',').map((v) => parseInt(v, 10));
    const nbrs = [[0, -2], [0, 2], [-1, -1], [-1, 1], [1, -1], [1, 1]]
      .map(([dc, dr]) => `${bc! + dc},${br! + dr}`)
      .filter((k) => g.tiles.some((t) => `${t.c},${t.r}` === k));
    // Empty p3's home tile so the Peace-bound destination is EMPTY (the probe's
    // complaint: an illegal-but-empty destination was accepted).
    g.units = g.units.filter((u) => u.coord !== cBase); // p3's home tile is empty now
    g.placements = g.placements.filter((c) => c.coord !== cBase);
    g.heroes.forEach((h) => { if (h.coord === cBase && h.ownerId === 'p3') h.coord = null; });
    const heroSpot = nbrs[0]!;
    // The attacker must stand on a tile adjacent to the HERO's tile.
    const [hc, hr] = heroSpot.split(',').map((v) => parseInt(v, 10));
    const nbrs2 = [[0, -2], [0, 2], [-1, -1], [-1, 1], [1, -1], [1, 1]]
      .map(([dc, dr]) => `${hc! + dc},${hr! + dr}`)
      .filter((k) => k !== cBase && g.tiles.some((t) => `${t.c},${t.r}` === k));
    const spitterSpot = nbrs2[0]!;

    // p2's spinner stands on the neighbor tile; the battle tile is heroSpot.
    const spId = placeUnit(g, 'p2', spitterSpot, 'spinner');
    g.heroes.find((h) => h.ownerId === 'p1' && h.isLeader)!.coord = heroSpot;

    // Drive p2's Move/Battle into the hero's tile (skip other seats' actions).
    let placed = new Set<string>();
    let guard = 0;
    while (guard++ < 60 && !(s.gameState.phase === 'action' && s.gameState.activeAction?.ownerId === 'p2' && s.gameState.activeAction.cardKind === 'move_battle')) {
      if (s.gameState.phase === 'planning') {
        const head = s.gameState.planningOrder[0]!;
        const want = head === 'p2' && !placed.has('p2');
        s = apply(s, head, { type: 'plan_action', card: want ? 'move_battle' : 'pass' }).newState;
        if (want) placed.add('p2');
      } else if (s.gameState.phase === 'action' && s.gameState.activeAction) {
        s = apply(s, s.gameState.activeAction.ownerId, { type: 'skip_action' }).newState;
      } else break;
    }
    expect(s.gameState.activeAction?.ownerId).toBe('p2');
    s = apply(s, 'p2', { type: 'move_units', from: spitterSpot, to: heroSpot, units: [g2id(g, spId)] }).newState;
    function g2id(state: NGGState, id: string): string { return state.units.find((u) => u.id === id)!.id; }
    // Commitments → activations. Both seats commit nothing.
    while (s.gameState.pending?.kind === 'battle_commit') {
      s = apply(s, s.gameState.pending.forPlayerId, { type: 'commit_battle_card', card: null }).newState;
    }
    // Drive the queue to the spinner, then it attacks the hero.
    let g3 = 0;
    while (s.gameState.battle && s.gameState.battle.phase === 'activations' && g3++ < 10) {
      const cur = s.gameState.battle.activationQueue[s.gameState.battle.activationCursor]!;
      if (cur === s.gameState.battle.units.find((u) => u.label === 'Spinner Platform')!.unitRef) break;
      s = apply(s, s.gameState.activePlayerId, { type: 'battle_activation', unit: cur, action: { kind: 'pass' } }).newState;
    }
    s = apply(s, 'p2', { type: 'battle_activation', unit: s.gameState.battle!.units.find((u) => u.label === 'Spinner Platform')!.unitRef, action: { kind: 'attack', target: 'warden' } }).newState;
    expect(s.gameState.pending?.kind).toBe('battle_defense');

    const b = s.gameState.battle!;
    // 1) The attack origin is barred (ruling 69).
    expect(() => apply(s, 'p1', { type: 'resolve_battle_defense', defense: { kind: 'decoy', hero: 'warden', moveTo: b.originCoord } }))
      .toThrowError(/attack-origin|origin/i);
    // 2) The Peace-bound partner's space is not §7.3-eligible.
    expect(() => apply(s, 'p1', { type: 'resolve_battle_defense', defense: { kind: 'decoy', hero: 'warden', moveTo: cBase } }))
      .toThrowError(/Decoy may move .* to: .*your or an Open Borders ally's units first/);
    // 3) Declining keeps the hero IN the fight (no damage from the attack).
    s = apply(s, 'p1', { type: 'resolve_battle_defense', defense: { kind: 'decoy', hero: 'warden' } }).newState;
    expect(s.gameState.heroes.find((h) => h.id === 'warden')!.dead).toBe(false);
    expect(s.gameState.battle?.units.some((u) => u.unitRef === 'warden')).toBe(true);
  });

  it('P2: commit + Extra menus never offer a reserved instance', () => {
    let s = base2p();
    const g = s.gameState;
    // Deal wiz a Bonus card; have her commit it; the menu at this same battle's
    // later commit windows must not offer that card id again.
    const idx = g.battleDeck.findIndex((id) => cardByInstanceId(id) === 'bonus-dmg-plus');
    const id = g.battleDeck.splice(idx, 1)[0]!;
    g.players.find((p) => p.playerId === 'wiz')!.hand.push(id);
    g.cardOwners[id] = 'wiz';
    const spitterId = placeUnit(g, 'rob', '0,0', 'spitter');
    const evokerId = placeUnit(g, 'wiz', '0,2', 'evoker');
    openHandBattle(g, 'rob', '0,0', '0,2', [{ kind: 'unit', id: spitterId }]);
    // Both commit: rob first (attackers first in this fixture since FPO=rob is... after upkeep rotation first = rob)
    const first = g.pending!.forPlayerId;
    const second = first === 'rob' ? 'wiz' : 'rob';
    g.pending = { kind: 'battle_commit', forPlayerId: second }; // drive wiz's commit
    let menu = neitherGutsNorGears.getLegalMoves(s, second);
    expect(menu.some((m) => (m.move as { card?: string }).card === 'Bonus (+1 DMG to all your units)')).toBe(true);
    commitBattleCard(g, second, 'Bonus (+1 DMG to all your units)');
    // wiz's instance is reserved now. ANY later selection path (e.g. a fresh
    // commit menu) must not offer it.
    menu = neitherGutsNorGears.getLegalMoves(s, second);
    expect(menu.some((m) => (m.move as { card?: string }).card === 'Bonus (+1 DMG to all your units)')).toBe(false);
    void evokerId;
  });

  it('P1: an AoE batch that kills the Leader AND another piece resolves both (§12.1 simultaneous) before victory settles', () => {
    let s = base2p();
    const g = s.gameState;
    // rob's Leader Kestrel (DEF 6) and a defender Spinner (DEF 2) stand at the
    // battle tile. wiz's Dragon (3 AoE) attacks with enough modifier damage to
    // kill BOTH in one batch — §12.1's simultaneity must not orphan the second.
    g.heroes.find((h) => h.ownerId === 'rob' && h.isLeader)!.coord = '0,0';
    const spinDef = placeUnit(g, 'rob', '0,0', 'spinner');
    const dragonId = placeUnit(g, 'wiz', '0,2', 'dragon');
    openHandBattle(g, 'wiz', '0,2', '0,0', [{ kind: 'unit', id: dragonId }]);
    const b = g.battle!;
    b.modifiers.push({ targetRef: dragonId, dmg: 4, source: 'test-boost' }); // 3 + 4 = 7 ≥ 6 → both die
    driveToActivations({ gameState: g });
    let guard = 0;
    while (b.activationQueue[b.activationCursor] !== dragonId && guard++ < 14) {
      const cur = b.activationQueue[b.activationCursor]!;
      const owner = b.units.find((u) => u.unitRef === cur)!.ownerId;
      battleActivation(g, owner, { type: 'battle_activation', unit: cur, action: { kind: 'pass' } } as never);
    }
    battleActivation(g, 'wiz', { type: 'battle_activation', unit: dragonId, action: { kind: 'attack', target: 'aoe' } } as never);
    // BOTH the Leader and the Spinner died in the same batch; the leaderCredit
    // ledger moved exactly once; game over recorded (no crash, no orphan).
    expect(g.players.find((p) => p.playerId === 'wiz')!.leaderKills).toBe(1);
    expect(g.units.some((u) => u.id === spinDef)).toBe(false);
    expect(g.phase).toBe('game_over');
    expect(g.result?.winners).toEqual(['wiz']);
  });

  it('P2: Decoy prefers the allied-unit space; empty is fallback-only', () => {
    let s = base2p();
    const g = s.gameState;
    g.players.find((p) => p.playerId === 'wiz')!.leaderId = 'warden'; // explicit — the fixture's wiz Leader
    g.players.find((p) => p.playerId === 'wiz')!.spyAssignments.push({ source: 'illusionist', heroId: 'warden', active: true });
    g.players.find((p) => p.playerId === 'wiz')!.manaCurrent = 0;
    // wiz's hero attacked at (0,2); wiz has an Evoker at adjacent (0,0)... use
    // (0,4) adjacent to (0,2)? neighbors of (0,2): (0,0),(0,4),(-1,1* off-map),(-1,3),(1,1),(1,3). Put the Evoker at (0,0)? That's the attacker's origin (spitter stands there). Evoker at (0,4).
    const evokerId = placeUnit(g, 'wiz', '0,4', 'evoker');
    const spId = placeUnit(g, 'rob', '0,0', 'spitter');
    g.heroes.find((h) => h.ownerId === 'wiz' && h.isLeader)!.coord = '0,2';
    openHandBattle(g, 'rob', '0,0', '0,2', [{ kind: 'unit', id: spId }]);
    driveToActivations({ gameState: g });
    const b = g.battle!;
    let guard = 0;
    while (b.activationQueue[b.activationCursor] !== spId && guard++ < 8) {
      const cur = b.activationQueue[b.activationCursor]!;
      const owner = b.units.find((u) => u.unitRef === cur)!.ownerId;
      battleActivation(g, owner, { type: 'battle_activation', unit: cur, action: { kind: 'pass' } } as never);
    }
    battleActivation(g, 'rob', { type: 'battle_activation', unit: spId, action: { kind: 'attack', target: 'warden' } } as never);
    expect(g.pending?.kind).toBe('battle_defense');
    // An eligible allied-unit space exists at (0,4) (wiz's evoker) — decoying
    // to EMPTY (-1,3)?? off-map... the 2p map has (-1,3) ✓ (water). An empty
    // destination is ILLEGAL while an allied space exists.
    expect(() => resolveBattleDefense(g, 'wiz', { kind: 'decoy', hero: 'warden', moveTo: '-1,3' }))
      .toThrowError(/Decoy may move .* to: .*your or an Open Borders ally's units first/);
    // The allied space is legal.
    const r = resolveBattleDefense(g, 'wiz', { kind: 'decoy', hero: 'warden', moveTo: '0,4' });
    void r;
    expect(g.heroes.find((h) => h.id === 'warden')!.coord).toBe('0,4');
    void evokerId;
  });


  it('P2: Shared Tactics owner-first — a partner card is not offered while the owner has yet to decide, and Extra menus include playable partner cards', () => {
    let s = base2p();
    const g = s.gameState;
    g.treaties.push({ type: 'shared-tactics', partners: ['wiz', 'rob'] });
    // rob holds the shared +1 DMG Bonus.
    const idx = g.battleDeck.findIndex((id) => cardByInstanceId(id) === 'bonus-dmg-plus');
    const cardInstId = g.battleDeck.splice(idx, 1)[0]!;
    g.players.find((p) => p.playerId === 'rob')!.hand.push(cardInstId);
    g.cardOwners[cardInstId] = 'rob';
    const spId = placeUnit(g, 'rob', '0,0', 'spitter');
    const evId = placeUnit(g, 'wiz', '0,2', 'evoker');
    openHandBattle(g, 'rob', '0,0', '0,2', [{ kind: 'unit', id: spId }]);
    // Commit order is FPO-driven — make wiz the first committer in this lock.
    g.pending = { kind: 'battle_commit', forPlayerId: 'wiz' };
    g.activePlayerId = 'wiz';
    // The rob Bonus is off wiz's menu while rob's commitment is still pending.
    let menu = neitherGutsNorGears.getLegalMoves(s, 'wiz');
    expect(menu.some((m) => (m.move as { card?: string | null }).card === 'Bonus (+1 DMG to all your units)')).toBe(false);
    // ...and if wiz nevertheless submits it, the engine rejects (no silent steal).
    expect(() => commitBattleCard(g, 'wiz', 'Bonus (+1 DMG to all your units)')).toThrowError(/decide first/);
    // rob decides its own hand first; passing frees the card for wiz.
    g.pending = { kind: 'battle_commit', forPlayerId: 'rob' };
    commitBattleCard(g, 'rob', 'Bonus (+1 DMG to all your units)'); // rob commits its own Bonus
    // That instance is reserved now — wiz still can't pick it (it's spent), and
    // no phantom offer appears either. (The owner-first rule is about the
    // decision window, not about double-spending the physical card.)
    g.pending = { kind: 'battle_commit', forPlayerId: 'wiz' };
    menu = neitherGutsNorGears.getLegalMoves(s, 'wiz');
    expect(menu.some((m) => (m.move as { card?: string | null }).card === 'Bonus (+1 DMG to all your units)')).toBe(false);
    // Now reset: rob PASSED its commitment instead — then the partner hand joins
    // wiz's menu legitimately.
    const g2 = base2p().gameState;
    g2.treaties.push({ type: 'shared-tactics', partners: ['wiz', 'rob'] });
    const idx2 = g2.battleDeck.findIndex((id) => cardByInstanceId(id) === 'bonus-dmg-plus');
    const inst2 = g2.battleDeck.splice(idx2, 1)[0]!;
    g2.players.find((p) => p.playerId === 'rob')!.hand.push(inst2);
    g2.cardOwners[inst2] = 'rob';
    const spId2 = placeUnit(g2, 'rob', '0,0', 'spitter');
    placeUnit(g2, 'wiz', '0,2', 'evoker');
    openHandBattle(g2, 'rob', '0,0', '0,2', [{ kind: 'unit', id: spId2 }]);
    g2.pending = { kind: 'battle_commit', forPlayerId: 'rob' };
    commitBattleCard(g2, 'rob', null); // rob passes its commitment
    const sForMenu = { gameState: g2 } as SessionState<NGGState>;
    g2.pending = { kind: 'battle_commit', forPlayerId: 'wiz' };
    g2.activePlayerId = 'wiz';
    menu = neitherGutsNorGears.getLegalMoves(sForMenu, 'wiz');
    expect(menu.some((m) => (m.move as { card?: string | null }).card === 'Bonus (+1 DMG to all your units)')).toBe(true);
    void evId;
  });

  it('P2: Decoy may NOT land on an unoccupied hostile base (empty-but-opponent-owned is never eligible)', () => {
    let s = base2p();
    const g = s.gameState;
    g.players.find((p) => p.playerId === 'wiz')!.spyAssignments.push({ source: 'illusionist', heroId: 'warden', active: true });
    // rob's base is (@2) on the 2p map — remove rob's occupying pieces so the
    // base is EMPTY but opponent-owned.
    const robBase = g.bases.find((b) => b.ownerId === 'rob')!.coord;
    g.units = g.units.filter((u) => u.coord !== robBase);
    g.placements = g.placements.filter((c) => c.coord !== robBase);
    g.heroes.forEach((h) => { if (h.coord === robBase && h.ownerId === 'rob') h.coord = null; });
    // The battle: wiz's spy hero stands at a tile adjacent to rob's empty base;
    // rob's spitter attacks. Find a neighbor of the base with a tile on the map.
    const [bc, br] = robBase.split(',').map((v) => parseInt(v, 10));
    const nbrs = [[0, -2], [0, 2], [-1, -1], [-1, 1], [1, -1], [1, 1]]
      .map(([dc, dr]) => `${bc + dc},${br + dr}`)
      .filter((k) => g.tiles.some((t) => `${t.c},${t.r}` === k));
    const heroSpot = nbrs[0]!;
    g.heroes.find((h) => h.ownerId === 'wiz' && h.isLeader)!.coord = heroSpot;
    // The spitter's origin must be adjacent to the battle tile.
    const [hc, hr] = heroSpot.split(',').map((v) => parseInt(v, 10));
    const spitterOrigin = [[0, -2], [0, 2], [-1, -1], [-1, 1], [1, -1], [1, 1]]
      .map(([dc, dr]) => `${hc + dc},${hr + dr}`)
      .find((k) => k !== heroSpot && k !== robBase && g.tiles.some((t) => `${t.c},${t.r}` === k))!;
    const spId = placeUnit(g, 'rob', spitterOrigin, 'spitter');
    openHandBattle(g, 'rob', spitterOrigin, heroSpot, [{ kind: 'unit', id: spId }]);
    driveToActivations({ gameState: g });
    const b = g.battle!;
    let guard = 0;
    while (b.activationQueue[b.activationCursor] !== spId && guard++ < 8) {
      const cur = b.activationQueue[b.activationCursor]!;
      const owner = b.units.find((u) => u.unitRef === cur)!.ownerId;
      battleActivation(g, owner, { type: 'battle_activation', unit: cur, action: { kind: 'pass' } } as never);
    }
    battleActivation(g, 'rob', { type: 'battle_activation', unit: spId, action: { kind: 'attack', target: 'warden' } } as never);
    expect(g.pending?.kind).toBe('battle_defense');
    // The empty enemy base is NOT a legal Decoy destination.
    expect(() => resolveBattleDefense(g, 'wiz', { kind: 'decoy', hero: 'warden', moveTo: robBase }))
      .toThrowError(/Decoy may move .* to: .*your or an Open Borders ally's units first/);
    // It is NOT offered in the menu either.
    const sMenu = { gameState: g } as SessionState<NGGState>;
    const menu = neitherGutsNorGears.getLegalMoves(sMenu, 'wiz');
    const decoyMoves = menu.filter((m) => (m.move as { defense?: { kind: string; moveTo?: string } }).defense?.kind === 'decoy' && (m.move as { defense?: { moveTo?: string | null } }).defense?.moveTo === robBase);
    expect(decoyMoves.length).toBe(0);
  });

});
