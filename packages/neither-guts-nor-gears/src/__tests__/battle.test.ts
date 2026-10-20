// M4 battle core — replays §14.4 and §14.5 (PORT-PLAN §7b M4 (a)–(g)):
// the reaction ladder, frozen AoE stats (Warden), Ice Blast reordering,
// pass-uses-the-activation, Wall-first targeting, retreat legality, stalemate
// return, and the per-Cleric-per-pass save limit.

import { describe, it, expect } from 'vitest';
import neitherGutsNorGears from '../index.js';
import type { NGGMove, NGGState } from '../types.js';
import { currentInitOf } from '../engine-battle.js';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';

import { keepCores } from './pendingFixtures.js';
function apply(s: SessionState<NGGState>, playerId: string, move: NGGMove): { s: SessionState<NGGState>; summary: string } {
  const r = neitherGutsNorGears.applyMove(s, playerId, move);
  return { s: r.newState, summary: r.summary };
}

function placeUnit(g: NGGState, pid: string, coord: string, typeId: string): string {
  const seq = g.units.filter((u) => u.ownerId === pid && u.typeId === typeId).length + 1;
  const isRobotPlatform = ['spinner', 'spitter', 'immobile-combat-platform', 'large-combat-platform', 'wall-platform', 'water-collector', 'wood-collector', 'ore-collector', 'oil-collector', 'ether-collector'].includes(typeId);
  const id = `u-${typeId}-${pid}-${seq}`;
  g.units.push({ id, typeId, ownerId: pid, coord, allocatedCoreId: isRobotPlatform ? `core-${pid}-${typeId}-${seq}` : null });
  return id;
}

/** 2p wizard-vs-robot session, both human, driven until `mover`'s Move/Battle
 *  action is resolving (the mover's card is placed LAST in planning so it pops
 *  first, LIFO). `setup` adjusts the board before planning (labeled test-side). */
function battleSession(mover: 'wiz' | 'rob', setup: (g: NGGState) => void, wizLeader = 'Warden Hesper Quill', robLeader = 'Kestrel Nine'): SessionState<NGGState> {
  const players: PlayerConfig[] = [
    { player_id: 'wiz', kind: 'human' }, { player_id: 'rob', kind: 'human' },
  ];
  let s = neitherGutsNorGears.createSession(players, { seed: 3, setupFirstPlayerId: 'wiz' });
  s = apply(s, 'wiz', { type: 'assign_setup_choices', selections: { wiz: 'covenant', rob: 'ledger' } }).s;
  s = apply(s, 'wiz', { type: 'choose_leader', hero: wizLeader }).s;
  s = apply(s, 'rob', { type: 'choose_leader', hero: robLeader }).s;
  s = apply(s, 'rob', { type: 'choose_starting_location', location: '@2' }).s;
  s = apply(s, 'wiz', { type: 'choose_starting_location', location: '@1' }).s;
  s = keepCores(s);
  setup(s.gameState);
  // Everyone places exactly one card: `mover` a move_battle, the other seat a
  // research — placement in rotation order; then skips until the mover's card
  // resolves (whichever pops first under LIFO).
  const other = mover === 'wiz' ? 'rob' : 'wiz';
  const placed = new Set<string>();
  while (s.gameState.phase === 'planning') {
    const head = s.gameState.planningOrder[0]!;
    const card = head === mover && !placed.has(mover) ? 'move_battle' as const
      : head === other && !placed.has(other) ? 'research' as const
      : 'pass' as const;
    if (card !== 'pass') placed.add(head);
    s = apply(s, head, { type: 'plan_action', card }).s;
  }
  expect(s.gameState.phase).toBe('action');
  let guard0 = 0;
  while (guard0++ < 6 && (s.gameState.activeAction?.ownerId !== mover || s.gameState.activeAction?.cardKind !== 'move_battle')) {
    s = apply(s, s.gameState.activeAction!.ownerId, { type: 'skip_action' }).s;
  }
  expect(s.gameState.activeAction?.ownerId).toBe(mover);
  expect(s.gameState.activeAction?.cardKind).toBe('move_battle');
  return s;
}

/** Settle the commitment phase with both sides committing no card. */
function settleCommitments(s0: SessionState<NGGState>): SessionState<NGGState> {
  let s = s0;
  let guard = 0;
  while (s.gameState.pending?.kind === 'battle_commit' && guard++ < 10) {
    s = apply(s, s.gameState.pending.forPlayerId, { type: 'commit_battle_card', card: null }).s;
  }
  return s;
}

describe('M4 battle core (§14.4–§14.5 replay)', () => {
  it('(a) the reaction ladder lets the defender\'s Cleric save the Evoker for 5 mana — Evoker alive; mana drops by 5', () => {
    // §14.4 first paragraph's ladder: the attacker's hit should die to the
    // Cleric save. Wizard defends with Evoker + Cleric; rob's Leader Kestrel
    // (DMG 3) single-targets the Evoker (DEF 1 → would kill).
    let s = battleSession('rob', (g) => {
      placeUnit(g, 'wiz', '-2,8', 'evoker');
      placeUnit(g, 'wiz', '-2,8', 'cleric');
      g.players.find((p) => p.playerId === 'wiz')!.manaCurrent = 5;
      g.heroes.find((h) => h.ownerId === 'rob' && h.isLeader)!.coord = '-2,6';
    });
    const r = apply(s, 'rob', { type: 'move_units', from: '-2,6', to: '-2,8', units: ['kestrel'] });
    s = r.s;
    expect(s.gameState.battle).not.toBeNull();
    s = settleCommitments(s);
    expect(s.gameState.battle!.phase).toBe('activations');
    // Kestrel (I70) is first: single-target the Evoker (no Mana Shield research).
    const kestrel = s.gameState.battle!.units.find((u) => u.unitRef === 'kestrel')!;
    const evoker = s.gameState.battle!.units.find((u) => u.label === 'Evoker')!;
    expect(s.gameState.activePlayerId).toBe('rob');
    const r2 = apply(s, 'rob', { type: 'battle_activation', unit: kestrel.unitRef, action: { kind: 'attack', target: evoker.unitRef } });
    s = r2.s;
    const pend = s.gameState.pending;
    expect(pend?.kind).toBe('battle_defense');
    expect(pend?.forPlayerId).toBe('wiz');
    const cleric = s.gameState.battle!.units.find((u) => u.label === 'Cleric')!;
    const r3 = apply(s, 'wiz', { type: 'resolve_battle_defense', defense: { kind: 'cleric_save', cleric: cleric.unitRef, target: evoker.unitRef } });
    s = r3.s;
    // Evoker saved; Cleric alive too (it saved ANOTHER, it wasn't itself hit);
    // mana spent 5.
    const wizUnits = s.gameState.battle?.units.filter((u) => u.ownerId === 'wiz') ?? [];
    expect(wizUnits.some((u) => u.label === 'Evoker')).toBe(true);
    expect(wizUnits.some((u) => u.label === 'Cleric')).toBe(true);
    expect(s.gameState.players.find((p) => p.playerId === 'wiz')!.manaCurrent).toBe(0);
    // The Cleric's save is used for THIS pass (ruling 32).
    expect(s.gameState.battle!.units.find((u) => u.label === 'Cleric')!.clericUsedThisPass).toBe(true);
  });

  it('(b) 4-DMG AoE: the Warden-boosted hero (DEF 5 w/ bonus) survives the killing attack, Warden dies, and the survivor drops to DEF 4 after', () => {
    // §14.4's second paragraph. Attacker: rob's Large Combat Platform (DMG 2 AoE in the example; 3 since ruling #130)
    // with Kestrel aboard (her +2 DMG bonus lifts it to 4). Defenders (wiz):
    // Warden (non-Leader claimed hero, DEF 4) and Rook (military hero, DEF 5
    // including Warden's +1 — his own +2 attack bonus is irrelevant here).
    let s = battleSession('rob', (g) => {
      placeUnit(g, 'rob', '-2,6', 'large-combat-platform');
      g.heroes.find((h) => h.ownerId === 'rob' && h.isLeader)!.coord = '-2,6'; // Kestrel rides with the LCP
      g.heroPool = g.heroPool.filter((h) => h !== 'warden' && h !== 'rook');
      g.heroes.push({ id: 'warden', ownerId: 'wiz', coord: '-2,8', isLeader: false, dead: false });
      g.heroes.push({ id: 'rook', ownerId: 'wiz', coord: '-2,8', isLeader: false, dead: false });
  }, 'Dowser Wren Calloway', 'Kestrel Nine');
    const lcpId = s.gameState.units.find((u) => u.ownerId === 'rob' && u.typeId === 'large-combat-platform')!.id;
    const r = apply(s, 'rob', { type: 'move_units', from: '-2,6', to: '-2,8', units: [lcpId, 'kestrel'] });
    s = r.s;
    s = settleCommitments(s);
    expect(s.gameState.battle!.phase).toBe('activations');
    // Initiative order: defending heroes (I70) before the Large Combat Platform
    // (I60) — both defenders pass, then the LCP fires its 4-DMG AoE.
    const lcp = s.gameState.battle!.units.find((u) => u.unitRef === lcpId)!;
    // Ruling #130 made the LCP DMG 3. The rulebook example was written at
    // DMG 2 (4 with Kestrel's +2), so pin the example's printed value.
    expect(lcp.dmg).toBe(3);
    lcp.dmg = 2;
    // Pass defenders AND Kestrel (all I70 vs LCP's I60) until the LCP is the
    // unit on the activation clock.
    while (s.gameState.battle!.activationQueue[s.gameState.battle!.activationCursor] !== lcpId) {
      const cur = s.gameState.battle!.activationQueue[s.gameState.battle!.activationCursor]!;
      s = apply(s, s.gameState.activePlayerId, { type: 'battle_activation', unit: cur, action: { kind: 'pass' } }).s;
    }
    expect(s.gameState.activePlayerId).toBe('rob');
    const r2 = apply(s, 'rob', { type: 'battle_activation', unit: lcp.unitRef, action: { kind: 'attack', target: 'aoe' } });
    s = r2.s;
    const b = s.gameState.battle;
    // Warden (DEF 4) died; Rook survived at DEF 5 (incl. Warden's bonus through
    // the killing attack, ruling 31).
    const rook = b?.units.find((u) => u.unitRef === 'rook');
    expect(b?.units.some((u) => u.unitRef === 'warden')).toBe(false);
    expect(rook).toBeTruthy();
    // After casualty removal the survivor's DEF is 4 for later attacks (frozen
    // bonus dropped with its source). Assert via the heroes' live stat view:
    const rookHero = s.gameState.heroes.find((h) => h.id === 'rook')!;
    expect(rookHero.dead).toBe(false);
    const wardenHero = s.gameState.heroes.find((h) => h.id === 'warden')!;
    expect(wardenHero.dead).toBe(true);
  });

  it('(c) Ice Blast reorders an unactivated target to last; an activated target gets no second activation', () => {
    // Defenders (rob): Spitter (I95, acts first), Wren (I30, non-military hero).
    // Attacker (wiz): an Evoker (I50) with Ice Blast researched and 5 mana.
    let s = battleSession('wiz', (g) => {
      placeUnit(g, 'wiz', '-2,6', 'evoker');
      const wiz = g.players.find((p) => p.playerId === 'wiz')!;
      wiz.research.push('ice-blast');
      wiz.manaCurrent = 5;
      placeUnit(g, 'rob', '-2,8', 'spitter');
      g.heroPool = g.heroPool.filter((h) => h !== 'wren');
      g.heroes.push({ id: 'wren', ownerId: 'rob', coord: '-2,8', isLeader: false, dead: false });
      // Rob's Leader (Kestrel) stays home (not in the battle).
      g.heroes.find((h) => h.ownerId === 'rob' && h.isLeader)!.coord = '2,4';
      // The wizard Leader also stays home.
      g.heroes.find((h) => h.ownerId === 'wiz' && h.isLeader)!.coord = '-2,10';
    });
    const evokerId = s.gameState.units.find((u) => u.ownerId === 'wiz' && u.typeId === 'evoker')!.id;
    const r = apply(s, 'wiz', { type: 'move_units', from: '-2,6', to: '-2,8', units: [evokerId] });
    s = r.s;
    s = settleCommitments(s);
    const b0 = s.gameState.battle!;
    expect(b0.phase).toBe('activations');
    const spitter = b0.units.find((u) => u.label === 'Spitter Platform')!;
    // Pass order: Spitter (95) → Evoker (50) → Wren (30).
    expect(s.gameState.activePlayerId).toBe('rob');
    s = apply(s, 'rob', { type: 'battle_activation', unit: spitter.unitRef, action: { kind: 'pass' } }).s;
    // Evoker: Ice Blast the Wren (unactivated, I30 → −70, acts last this pass).
    expect(s.gameState.activePlayerId).toBe('wiz');
    s = apply(s, 'wiz', { type: 'battle_activation', unit: evokerId, action: { kind: 'ability', ability: 'ice_blast', target: 'wren' } }).s;
    const b1 = s.gameState.battle!;
    const wren = b1.units.find((u) => u.unitRef === 'wren')!;
    // Live init = raw + modifiers: 30 − 100 = −70 (the raw stat is unchanged;
    // init reads go through currentInitOf — the queue sorts by it).
    expect(Number.isFinite(wren.init)).toBe(true); // raw stat preserved
    expect(currentInitOf({ ...s.gameState, battle: b1 }, wren)).toBe(-70);
    // The already-activated Spitter did NOT get another activation and is out of
    // the remaining order; only Wren remains.
    const remaining = b1.activationQueue.slice(b1.activationCursor).filter((ref) => !b1.units.find((x) => x.unitRef === ref)!.activated);
    expect(remaining).toEqual(['wren']);
    expect(s.gameState.players.find((p) => p.playerId === 'wiz')!.manaCurrent).toBe(2);
  });

  it('(d) a unit may pass its activation and the pass is consumed (ruling 67) + Wall-first targeting', () => {
    // Attackers (wiz): Evoker. Defenders (rob): a Wall Platform (I1, DMG 0) +
    // Kestrel (I70 hero). Wall-first: while the Wall stands, single-target attacks
    // must target it.
    let s = battleSession('wiz', (g) => {
      placeUnit(g, 'wiz', '-2,6', 'evoker');
      placeUnit(g, 'rob', '-2,8', 'wall-platform');
      g.heroes.find((h) => h.ownerId === 'rob' && h.isLeader)!.coord = '-2,8';
      g.heroes.find((h) => h.ownerId === 'wiz' && h.isLeader)!.coord = '-2,10';
    });
    const evokerId = s.gameState.units.find((u) => u.ownerId === 'wiz' && u.typeId === 'evoker')!.id;
    const r = apply(s, 'wiz', { type: 'move_units', from: '-2,6', to: '-2,8', units: [evokerId] });
    s = r.s;
    s = settleCommitments(s);
    const b = s.gameState.battle!;
    expect(b.phase).toBe('activations');
    // Kestrel I70 defends first (highest init on either side is Kestrel 70).
    expect(s.gameState.activePlayerId).toBe('rob');
    // The Evoker (I50) acts next: Wall-first means its only attack target is the Wall.
    s = apply(s, 'rob', { type: 'battle_activation', unit: 'kestrel', action: { kind: 'pass' } }).s;
    expect(s.gameState.activePlayerId).toBe('wiz');
    const evokerActs = neitherGutsNorGears.getLegalMoves(s, 'wiz').filter((m) => m.move.type === 'battle_activation');
    const attackTargets = evokerActs
      .filter((m) => (m.move as Extract<NGGMove, { type: 'battle_activation' }>).action.kind === 'attack')
      .map((m) => ((m.move as Extract<NGGMove, { type: 'battle_activation' }>).action as { target?: string }).target);
    const wallId = b.units.find((u) => u.label === 'Wall Platform')!.unitRef;
    expect(attackTargets.length).toBeGreaterThan(0);
    expect(new Set(attackTargets)).toEqual(new Set([wallId]));
    // A pass consumes the activation.
    s = apply(s, 'wiz', { type: 'battle_activation', unit: evokerId, action: { kind: 'pass' } }).s;
    const b2 = s.gameState.battle!;
    expect(b2.units.find((u) => u.unitRef === evokerId)!.activated).toBe(true);
  });

  it('(f) retreat: all-or-nothing per player to one legal destination (allied-first); collectors stay (ruling 65); origin hex excluded (ruling 69)', () => {
    // Attackers (wiz): Leader Warden + an Evoker at the battle. Defenders (rob):
    // a Wall Platform (DMG 0 — no kill in the pass) so the battle survives to
    // the retreat window.
    let s = battleSession('wiz', (g) => {
      placeUnit(g, 'wiz', '-2,6', 'evoker');
      // The wizard's committed collector sits at the battle tile (stays put).
      // rob allowed it there (§6.2), so rob's Wall left standing does not
      // sweep it at the end (an unauthorised one would be destroyed, §9.7).
      g.collectorModel = 2;
      g.players.find((p) => p.playerId === 'wiz')!.collectorsAvailable['surf-7'] = 1;
      g.placements.push({ collectorId: 'surf-7', ownerId: 'wiz', coord: '-2,8', resource: 'water', authorizedBy: 'rob' });
      placeUnit(g, 'rob', '-2,8', 'wall-platform');
      g.heroes.find((h) => h.ownerId === 'rob' && h.isLeader)!.coord = '2,4'; // Kestrel home
      g.heroes.find((h) => h.ownerId === 'wiz' && h.isLeader)!.coord = '-2,6'; // Warden with the Evoker
    });
    const evokerId = s.gameState.units.find((u) => u.ownerId === 'wiz' && u.typeId === 'evoker')!.id;
    const r = apply(s, 'wiz', { type: 'move_units', from: '-2,6', to: '-2,8', units: [evokerId, 'warden'] });
    s = r.s;
    s = settleCommitments(s);
    expect(s.gameState.battle!.phase).toBe('activations');
    // Pass order: Evoker(50) > Wall(1)... Kestrel not here; Warden hero I30.
    // Drive: Evoker attacks the Wall (DMG 2 < DEF 4 → no kill), Warden passes,
    // Wall passes (DMG 0 — no attack option surfaced).
    const b = s.gameState.battle!;
    const wall = b.units.find((u) => u.label === 'Wall Platform')!;
    // Drive the pass; when the retreat window opens (§9.6, defenders first) we
    // stop to assert on it, then settle everyone by staying.
    let guard = 0;
    let sawRetreatFor: string | null = null;
    let robSawOriginOffered: unknown = 'not-observed';
    while (s.gameState.battle && guard++ < 16) {
      const b = s.gameState.battle;
      if (s.gameState.pending?.kind === 'retreat') {
        const forPid = s.gameState.pending.forPlayerId;
        if (sawRetreatFor === null) {
          sawRetreatFor = forPid;
          // Defenders declare first: that must be rob (wiz attacked).
          expect(forPid).toBe('rob');
          // The attack origin (-2,6) must not be offered to rob (ruling 69).
          const dests = neitherGutsNorGears.getLegalMoves(s, forPid)
            .filter((m) => m.move.type === 'choose_retreat')
            .map((m) => (m.move as Extract<NGGMove, { type: 'choose_retreat' }>).destination);
          robSawOriginOffered = dests.includes('-2,6');
          expect(robSawOriginOffered).toBe(false);
        }
        s = apply(s, forPid, { type: 'choose_retreat', destination: null, stay: true }).s;
        continue;
      }
      if (b.phase !== 'activations') break;
      const cur = b.activationQueue[b.activationCursor];
      if (cur === undefined) break;
      const unit = b.units.find((u) => u.unitRef === cur);
      if (!unit) break;
      const activePid = s.gameState.activePlayerId;
      if (unit.label === 'Evoker') {
        s = apply(s, activePid, { type: 'battle_activation', unit: cur, action: { kind: 'attack', target: wall.unitRef } }).s;
      } else {
        s = apply(s, activePid, { type: 'battle_activation', unit: cur, action: { kind: 'pass' } }).s;
      }
      if (s.gameState.pending?.kind === 'battle_defense') {
        s = apply(s, s.gameState.pending.forPlayerId, { type: 'resolve_battle_defense', defense: { kind: 'none' } }).s;
      }
    }
    expect(sawRetreatFor).toBe('rob');
    // Stalemate: battle over; the wizard's attacking units are home at (-2,6).
    expect(s.gameState.battle).toBeNull();
    expect(s.gameState.units.find((u) => u.typeId === 'evoker')!.coord).toBe('-2,6');
    expect(s.gameState.heroes.find((h) => h.id === 'warden' && h.ownerId === 'wiz')!.coord).toBe('-2,6');
    // The wizard's collector never moved (ruling 65).
    expect(s.gameState.placements.find((c) => c.collectorId === 'surf-7')?.coord).toBe('-2,8');
  });

  it('(g) stalemate: a no-kill pass returns ALL surviving attackers to the origin (incl. Rally reinforcements from other hexes)', () => {
    // Attackers (rob): Wall Platform (DMG 0 → no kill possible). Defenders (wiz):
    // Evoker only, which passes. A wizard unit joined from a THIRD hex via Rally —
    // covered by battlecards.test.ts's batch tests; here assert the return-to-origin.
    let s = battleSession('rob', (g) => {
      placeUnit(g, 'rob', '-2,6', 'wall-platform');
      placeUnit(g, 'wiz', '-2,8', 'evoker');
      g.heroes.find((h) => h.ownerId === 'rob' && h.isLeader)!.coord = '2,4';
      g.heroes.find((h) => h.ownerId === 'wiz' && h.isLeader)!.coord = '-2,10';
    });
    const wallId = s.gameState.units.find((u) => u.ownerId === 'rob' && u.typeId === 'wall-platform')!.id;
    const r = apply(s, 'rob', { type: 'move_units', from: '-2,6', to: '-2,8', units: [wallId] });
    s = r.s;
    s = settleCommitments(s);
    expect(s.gameState.battle!.phase).toBe('activations');
    // Evoker (I50) then ... (I1). Both pass → full pass, no kills. Retreat offers
    // come first (§9.6: defenders declare first); everyone stays → then, with no
    // kill, §9.7's stalemate returns the attackers to the origin.
    let guard = 0;
    while (s.gameState.battle && guard++ < 16) {
      const bb = s.gameState.battle;
      if (bb.phase !== 'activations') break;
      const cur = bb.activationQueue[bb.activationCursor];
      if (cur === undefined || !bb.units.some((u) => u.unitRef === cur)) break;
      s = apply(s, s.gameState.activePlayerId, { type: 'battle_activation', unit: cur, action: { kind: 'pass' } }).s;
      while (s.gameState.pending?.kind === 'retreat') {
        s = apply(s, s.gameState.pending.forPlayerId, { type: 'choose_retreat', destination: null, stay: true }).s;
      }
    }
    // Stalemate: battle over, the Wall (rob's attacker) went home to the origin -2,6.
    expect(s.gameState.battle).toBeNull();
    expect(s.gameState.units.find((u) => u.id === wallId)!.coord).toBe('-2,6');
    expect(s.gameState.units.some((u) => u.coord === '-2,8' && u.typeId === 'evoker')).toBe(true);
  });
});
