// Hand-built states with one pending open, for the instance-gate tests
// (instanceGates.test.ts) and the view-completeness rows. Each fixture returns
// a session whose pending is owned by `forPlayerId`, plus the would-be move for
// a shut option so the tests can attempt it. Not a test file itself.

import neitherGutsNorGears from '../index.js';
import { startBattle } from '../engine-battle.js';
import { applyMove as engineApply, cardByInstanceId, effectiveResourceAt } from '../engine.js';
import type { NGGMove, NGGState, TreatyInstance } from '../types.js';
import type { BattleCardId } from '../data/catalogs.js';
import type { PendingOption, PlayerConfig, SessionState } from '@zekel/game-kit';

export interface Fixture {
  s: SessionState<NGGState>;
  forPlayerId: string;
  /** The move a shut option stands for (what a player would submit). */
  wouldBe: (o: PendingOption<NGGMove>) => NGGMove | undefined;
}

/** Answer every open upkeep Core question with "keep the Cores where they
 *  are" — each robot seat is asked at every upkeep (§5.1 step 3). */
export function keepCores(s: SessionState<NGGState>): SessionState<NGGState> {
  while (s.gameState.pending?.kind === 'upkeep_reallocate_cores') {
    s = neitherGutsNorGears.applyMove(s, s.gameState.pending.forPlayerId, { type: 'reallocate_cores', allocations: {} }).newState;
  }
  return s;
}

/** keepCores for a bare engine state. */
export function keepCoresRaw(g: NGGState): NGGState {
  while (g.pending?.kind === 'upkeep_reallocate_cores') {
    g = engineApply(g, g.pending.forPlayerId, { type: 'reallocate_cores', allocations: {} }).newState;
  }
  return g;
}

export function base2p(): SessionState<NGGState> {
  const players: PlayerConfig[] = [
    { player_id: 'wiz', kind: 'human' }, { player_id: 'rob', kind: 'human' },
  ];
  let s = neitherGutsNorGears.createSession(players, { seed: 3, setupFirstPlayerId: 'wiz' });
  const apply = (pid: string, move: NGGMove) => { s = neitherGutsNorGears.applyMove(s, pid, move).newState; };
  apply('wiz', { type: 'assign_setup_choices', selections: { wiz: 'covenant', rob: 'ledger' } });
  apply('wiz', { type: 'choose_leader', hero: 'Warden Hesper Quill' });
  apply('rob', { type: 'choose_leader', hero: 'Kestrel Nine' });
  apply('rob', { type: 'choose_starting_location', location: '@2' });
  apply('wiz', { type: 'choose_starting_location', location: '@1' });
  return keepCores(s);
}

export function placeUnit(g: NGGState, pid: string, coord: string, typeId: string): string {
  const seq = g.units.filter((u) => u.ownerId === pid && u.typeId === typeId).length + 1;
  const isRobotPlatform = ['spinner', 'spitter', 'immobile-combat-platform', 'large-combat-platform', 'wall-platform'].includes(typeId);
  const id = `u-${typeId}-${pid}-${seq}`;
  g.units.push({ id, typeId, ownerId: pid, coord, allocatedCoreId: isRobotPlatform ? `core-${pid}-${typeId}-${seq}` : null });
  return id;
}

/** Move one card of `card` from the server's deck into `pid`'s hand. */
export function deal(g: NGGState, pid: string, card: BattleCardId): string {
  const idx = g.battleDeck.findIndex((id) => cardByInstanceId(id) === card);
  if (idx < 0) throw new Error(`no ${card} left in the deck`);
  const id = g.battleDeck.splice(idx, 1)[0]!;
  g.players.find((p) => p.playerId === pid)!.hand.push(id);
  g.cardOwners[id] = pid;
  return id;
}

const TREATY_NAMES: Record<string, string> = {
  'open-borders': 'Open Borders', 'shared-resources': 'Shared Resources', peace: 'Peace',
  'culture-treaty': 'Culture Treaty', 'shared-tactics': 'Shared Tactics',
};

/** The §5.6 end-of-round window, wiz deciding, holding the given treaties. */
export function treatyBreakWindow(treaties: TreatyInstance[], prepare?: (g: NGGState) => void): Fixture {
  const s = base2p();
  const g = s.gameState;
  g.treaties = treaties;
  prepare?.(g);
  g.phase = 'treaty_break';
  g.pending = { kind: 'treaty_break_decision', forPlayerId: 'wiz' };
  g.activePlayerId = 'wiz';
  return {
    s, forPlayerId: 'wiz',
    wouldBe: (o) => {
      const [type, partner] = o.option_id.split(':');
      return type && partner ? { type: 'break_treaty', treaty_type: TREATY_NAMES[type]!, partner } : undefined;
    },
  };
}

/** The live bug: wiz holds Shared Resources with rob, and a wiz collector sits
 *  on rob's base tile this round — the treaty cannot break. */
export function sharedResourcesBlocked(): Fixture {
  return treatyBreakWindow([{ type: 'shared-resources', partners: ['wiz', 'rob'] }], (g) => {
    const robBase = g.bases.find((b) => b.ownerId === 'rob')!.coord;
    g.placements.push({ collectorId: 'surf-1', ownerId: 'wiz', coord: robBase, resource: effectiveResourceAt(g, robBase), authorizedBy: 'rob' });
  });
}

/** rob is asked to let wiz's surf-2 collect on rob's base tile (the engine
 *  arms this from a real purchase in pendings.test.ts; this is the shape). */
export function accessRequest(): Fixture {
  const s = base2p();
  const g = s.gameState;
  const robBase = g.bases.find((b) => b.ownerId === 'rob')!.coord;
  const payment = [{ collectorId: 'surf-1', coord: '-2,8' }, { collectorId: 'surf-2', coord: robBase }];
  g.pending = {
    kind: 'access_request', forPlayerId: 'rob', buyerId: 'wiz', collectorId: 'surf-2', coord: robBase, action: 'build',
    proposal: { item: 'Surf', placements: [{ collectorId: 'surf-2', coord: robBase }] },
    resume: { action: 'build', move: { type: 'build', item: 'Surf', payment } },
    queue: { index: 1, total: 1 },
  };
  g.activePlayerId = 'rob';
  return { s, forPlayerId: 'rob', wouldBe: () => undefined };
}

/** A hand-raised battle at 0,2 (rob attacks from 0,0), wiz's Evoker defending. */
function battle(g: NGGState): { robUnit: string; wizUnit: string } {
  const robUnit = placeUnit(g, 'rob', '0,0', 'spitter');
  const wizUnit = placeUnit(g, 'wiz', '0,2', 'evoker');
  startBattle(g, g.players.find((p) => p.playerId === 'rob')!, '0,0', '0,2', [{ kind: 'unit', id: robUnit }], []);
  return { robUnit, wizUnit };
}

const commitWouldBe = (o: PendingOption<NGGMove>): NGGMove | undefined =>
  (o.option_id === 'none' ? undefined : { type: 'commit_battle_card', card: o.label });

/** Shared Tactics: rob (in the battle, not yet committed) owns a Bonus; wiz
 *  owns a Retreat. On wiz's commit the Bonus is shut — owner decides first. */
export function commitOwnerFirst(): Fixture {
  const s = base2p();
  const g = s.gameState;
  g.treaties.push({ type: 'shared-tactics', partners: ['wiz', 'rob'] });
  deal(g, 'rob', 'bonus-dmg-plus');
  deal(g, 'wiz', 'retreat');
  battle(g);
  g.pending = { kind: 'battle_commit', forPlayerId: 'wiz' };
  g.activePlayerId = 'wiz';
  return { s, forPlayerId: 'wiz', wouldBe: commitWouldBe };
}

/** Shared Tactics: wiz already committed its own Bonus (still secretly in its
 *  hand); on rob's commit that Bonus is shut as already committed. */
export function commitReserved(): Fixture {
  const s = base2p();
  const g = s.gameState;
  g.treaties.push({ type: 'shared-tactics', partners: ['wiz', 'rob'] });
  const bonus = deal(g, 'wiz', 'bonus-dmg-plus');
  battle(g);
  g.battle!.commitments['wiz'] = { cardInstanceId: bonus, playingPlayerId: 'wiz' };
  g.battle!.commitments['rob'] = 'pending';
  g.pending = { kind: 'battle_commit', forPlayerId: 'rob' };
  g.activePlayerId = 'rob';
  return { s, forPlayerId: 'rob', wouldBe: commitWouldBe };
}

/** Cards revealed: wiz's Counter (index 0) must pick a target among rob's
 *  already-resolved Retreat and unresolved Bonus, plus rob's Rally added by an
 *  Extra in the next batch. */
export function counterTarget(): Fixture {
  const s = base2p();
  const g = s.gameState;
  battle(g);
  const b = g.battle!;
  const pick = (card: BattleCardId) => {
    const idx = g.battleDeck.findIndex((id) => cardByInstanceId(id) === card);
    return g.battleDeck.splice(idx, 1)[0]!;
  };
  b.phase = 'cards';
  b.committed = [
    { cardInstanceId: pick('counter'), card: 'counter', playingPlayerId: 'wiz', ownerId: 'wiz', resolved: false, countered: false, batch: 0 },
    { cardInstanceId: pick('retreat'), card: 'retreat', playingPlayerId: 'rob', ownerId: 'rob', resolved: true, countered: false, batch: 0 },
    { cardInstanceId: pick('bonus-dmg-plus'), card: 'bonus-dmg-plus', playingPlayerId: 'rob', ownerId: 'rob', resolved: false, countered: false, batch: 0 },
    { cardInstanceId: pick('rally'), card: 'rally', playingPlayerId: 'rob', ownerId: 'rob', resolved: false, countered: false, batch: 1 },
  ];
  g.pending = { kind: 'counter_target', forPlayerId: 'wiz', cardIndex: 0 };
  g.activePlayerId = 'wiz';
  return {
    s, forPlayerId: 'wiz',
    wouldBe: (o) => ({ type: 'choose_counter_target', card: String(o.detail?.['card']) }),
  };
}

/** wiz's Extra resolves; wiz holds a Retreat and a Bonus. */
export function extraSelection(): Fixture {
  const s = base2p();
  const g = s.gameState;
  battle(g);
  const b = g.battle!;
  deal(g, 'wiz', 'retreat');
  deal(g, 'wiz', 'bonus-dmg-plus');
  const idx = g.battleDeck.findIndex((id) => cardByInstanceId(id) === 'extra');
  const extra = g.battleDeck.splice(idx, 1)[0]!;
  b.phase = 'cards';
  b.committed = [{ cardInstanceId: extra, card: 'extra', playingPlayerId: 'wiz', ownerId: 'wiz', resolved: false, countered: false, batch: 0 }];
  g.pending = { kind: 'extra_selection', forPlayerId: 'wiz', cardIndex: 0 };
  g.activePlayerId = 'wiz';
  return {
    s, forPlayerId: 'wiz',
    wouldBe: (o) => (o.option_id === 'none' ? undefined : { type: 'select_extra_cards', cards: [o.label] }),
  };
}

/** rob's Spitter attacks wiz's Evoker; the defense ladder sits at `step`. The
 *  Evoker's owner has Mana Shield researched and `mana` mana; a wiz Cleric is
 *  in the fight too. */
export function battleDefense(step: 'decoy' | 'mana_shield' | 'cleric', mana: number): Fixture & { clericRef: string } {
  const s = base2p();
  const g = s.gameState;
  const wiz = g.players.find((p) => p.playerId === 'wiz')!;
  wiz.research.push('mana-shield');
  wiz.manaCurrent = mana;
  const clericRef = placeUnit(g, 'wiz', '0,2', 'cleric');
  const { robUnit, wizUnit } = battle(g);
  const b = g.battle!;
  b.phase = 'activations';
  b.defense = { attackerRef: robUnit, targetRef: wizUnit, damage: 3, kind: 'attack', step };
  g.pending = { kind: 'battle_defense', forPlayerId: 'wiz' };
  g.activePlayerId = 'wiz';
  return {
    s, forPlayerId: 'wiz', clericRef,
    wouldBe: (o) => {
      if (o.option_id === 'decoy') return { type: 'resolve_battle_defense', defense: { kind: 'decoy' } };
      if (o.option_id === 'mana_shield') return { type: 'resolve_battle_defense', defense: { kind: 'mana_shield', mana: 1 } };
      if (o.option_id === 'cleric_save') return { type: 'resolve_battle_defense', defense: { kind: 'cleric_save', cleric: clericRef, target: wizUnit } };
      return undefined;
    },
  };
}
