// SPEC-instance-gates.md §6. Inside an open pending, the view publishes every
// option — shut ones included, each with the engine's own refusal sentence.
// Three locks:
//  1. menu and view agree: an open option is on getLegalMoves, a shut one is not;
//  2. one sentence, one home: attempting a shut option throws EXACTLY the
//     blocked_reason the view printed;
//  3. the live bug: a Shared Resources treaty with a collector on the partner's
//     space was offered by the menu and refused by the engine.

import { describe, it, expect } from 'vitest';
import neitherGutsNorGears from '../index.js';
import { checkPendingOptionConsistency } from '@zekel/game-kit';
import type { NGGMove } from '../types.js';
import type { PendingView } from '@zekel/game-kit';
import {
  battleDefense, commitOwnerFirst, commitReserved, counterTarget, deal, extraSelection,
  sharedResourcesBlocked, treatyBreakWindow, type Fixture,
} from './pendingFixtures.js';

function pendingOf(f: Fixture, viewer = f.forPlayerId): PendingView<NGGMove> {
  return (neitherGutsNorGears.getPlayerView(f.s, viewer) as { pending: PendingView<NGGMove> }).pending;
}

function refusal(f: Pick<Fixture, 's' | 'forPlayerId'>, move: NGGMove): string {
  try {
    neitherGutsNorGears.applyMove(f.s, f.forPlayerId, move);
  } catch (e) {
    return (e as Error).message;
  }
  return '(accepted)';
}

const FIXTURES: Array<[string, () => Fixture]> = [
  ['treaty break — Shared Resources held by a collector', sharedResourcesBlocked],
  ['treaty break — Open Borders with allied units together', () => treatyBreakWindow(
    [{ type: 'open-borders', partners: ['wiz', 'rob'] }],
    (g) => { const k = g.bases.find((b) => b.ownerId === 'rob')!.coord; g.units.push({ id: 'u-evoker-wiz-9', typeId: 'evoker', ownerId: 'wiz', coord: k, allocatedCoreId: null }); },
  )],
  ['treaty break — Peace (open)', () => treatyBreakWindow([{ type: 'peace', partners: ['wiz', 'rob'] }])],
  ['treaty break — Culture Treaty (open at end of round)', () => treatyBreakWindow([{ type: 'culture-treaty', partners: ['wiz', 'rob'] }])],
  ['battle commit — partner card, owner decides first', commitOwnerFirst],
  ['battle commit — partner already committed the card', commitReserved],
  ['Counter target', counterTarget],
  ['Extra selection', extraSelection],
  ['battle defense — Decoy step, no spy', () => battleDefense('decoy', 3)],
  ['battle defense — Mana Shield step', () => battleDefense('mana_shield', 3)],
  ['battle defense — Cleric step, short on mana', () => battleDefense('cleric', 2)],
];

describe('instance gates: pending options agree with the menu (SPEC §6)', () => {
  for (const [name, make] of FIXTURES) {
    it(`${name}: every open option is offered, no shut option is`, () => {
      const f = make();
      const pending = pendingOf(f);
      expect(pending.options, 'the pending publishes its option set').toBeDefined();
      const problems = checkPendingOptionConsistency(pending, neitherGutsNorGears.getLegalMoves(f.s, f.forPlayerId), f.wouldBe);
      expect(problems).toEqual([]);
    });

    it(`${name}: a shut option's reason is the engine's refusal, character for character`, () => {
      const f = make();
      for (const o of pendingOf(f).options!.filter((x) => x.blocked_reason !== undefined)) {
        const move = f.wouldBe(o);
        if (!move) continue;
        expect(refusal(f, move), `attempting shut option ${o.option_id}`).toBe(o.blocked_reason);
      }
    });
  }
});

describe('the live bug: Shared Resources offered by the menu, refused by the engine', () => {
  it('is absent from getLegalMoves and present in options with its reason', () => {
    const f = sharedResourcesBlocked();
    const menu = neitherGutsNorGears.getLegalMoves(f.s, 'wiz');
    expect(menu.some((m) => m.move.type === 'break_treaty')).toBe(false);
    const opt = pendingOf(f).options!.find((o) => o.option_id === 'shared-resources:rob')!;
    expect(opt.move).toBeUndefined();
    expect(opt.blocked_reason).toBe("Shared Resources cannot break while a unit is collecting from a partner's space");
    expect(opt.rules_section).toBe('treaties');
    expect(opt.label).toBe('Shared Resources with The Ledger');
    expect(pendingOf(f).repeatable).toBe(true);
  });

  it('opens once the collector is gone', () => {
    const f = sharedResourcesBlocked();
    f.s.gameState.placements = [];
    expect(neitherGutsNorGears.getLegalMoves(f.s, 'wiz').some((m) => m.move.type === 'break_treaty')).toBe(true);
    expect(pendingOf(f).options!.find((o) => o.option_id === 'shared-resources:rob')!.move)
      .toEqual({ type: 'break_treaty', treaty_type: 'Shared Resources', partner: 'rob' });
  });
});

describe('what each pending publishes', () => {
  it('battle commit counts copies and names the owner-first reason', () => {
    const f = commitOwnerFirst();
    const opts = pendingOf(f).options!;
    const retreat = opts.find((o) => o.option_id === 'retreat')!;
    expect(retreat.detail?.['count']).toBe(1);
    expect(retreat.move).toEqual({ type: 'commit_battle_card', card: retreat.label });
    const bonus = opts.find((o) => o.option_id === 'bonus-dmg-plus')!;
    expect(bonus.move).toBeUndefined();
    expect(bonus.blocked_reason).toMatch(/The Ledger is in this battle and has not committed yet/);
  });

  it('Counter options cover every committed card, grouped by batch', () => {
    const f = counterTarget();
    const p = pendingOf(f);
    expect(p.options!.map((o) => [o.option_id, o.move !== undefined])).toEqual([
      ['card-0', false], ['card-1', false], ['card-2', true], ['card-3', true],
    ]);
    expect(p.options![0]!.blocked_reason).toBe('A Counter cannot target itself');
    expect(p.options![1]!.blocked_reason).toMatch(/already resolved/);
    expect(p.context?.['batches']).toEqual([
      { batch: 0, option_ids: ['card-0', 'card-1', 'card-2'] },
      { batch: 1, option_ids: ['card-3'] },
    ]);
  });

  it('Extra selection says how many cards may be added', () => {
    const p = pendingOf(extraSelection());
    expect(p.context?.['max']).toBe(2);
    expect(p.options!.filter((o) => o.move).map((o) => o.option_id)).toEqual(['none', 'retreat', 'bonus-dmg-plus']);
  });

  it('Extra offers two copies of one card when two are playable, and plays both', () => {
    const f = extraSelection();
    deal(f.s.gameState, 'wiz', 'retreat'); // wiz now holds two Retreats
    const pair = { type: 'select_extra_cards', cards: ['Retreat', 'Retreat'] } as const;
    expect(neitherGutsNorGears.getLegalMoves(f.s, 'wiz').some((m) => JSON.stringify(m.move) === JSON.stringify(pair))).toBe(true);
    expect(pendingOf(f).options!.find((o) => o.option_id === 'retreat')!.detail?.['count']).toBe(2);
    const g = neitherGutsNorGears.applyMove(f.s, 'wiz', pair).newState.gameState;
    const retreatsLeft = g.players.find((p) => p.playerId === 'wiz')!.hand.filter((id) => id.startsWith('retreat')).length;
    expect(retreatsLeft).toBe(0);
  });

  it('Extra does not offer two copies of a card held once', () => {
    const f = extraSelection();
    const menu = neitherGutsNorGears.getLegalMoves(f.s, 'wiz').map((m) => JSON.stringify(m.move));
    expect(menu).not.toContain(JSON.stringify({ type: 'select_extra_cards', cards: ['Retreat', 'Retreat'] }));
  });

  it('battle defense lists the open step\'s choices and shuts the others with why', () => {
    const p = pendingOf(battleDefense('mana_shield', 3));
    const ids = p.options!.map((o) => o.option_id);
    expect(ids).toEqual(['none', 'decoy', 'mana_shield:1', 'mana_shield:2', 'mana_shield:3', 'cleric_save']);
    expect(p.options!.find((o) => o.option_id === 'decoy')!.blocked_reason).toBe('The Decoy window is not open on this attack');
    expect(p.context).toMatchObject({ step: 'mana_shield', damage: 3, your_mana: 3 });
  });

  it('a Cleric save without 5 mana is refused (it used to drive mana negative)', () => {
    const f = battleDefense('cleric', 2);
    const opt = pendingOf(f).options!.find((o) => o.option_id === 'cleric_save')!;
    expect(opt.blocked_reason).toBe('A Cleric save costs 5 mana — you hold 2');
    expect(f.s.gameState.players.find((p) => p.playerId === 'wiz')!.manaCurrent).toBe(2);
  });

  it('a Cleric save that names no Cleric is refused, not guessed', () => {
    const f = battleDefense('cleric', 6);
    const move = { type: 'resolve_battle_defense', defense: { kind: 'cleric_save' } } as unknown as NGGMove;
    expect(refusal(f, move)).toBe('Name your own unused Cleric in this battle');
    expect(f.s.gameState.players.find((p) => p.playerId === 'wiz')!.manaCurrent).toBe(6);
    // Named, it works: 5 mana spent.
    const named = neitherGutsNorGears.applyMove(f.s, 'wiz', { type: 'resolve_battle_defense', defense: { kind: 'cleric_save', cleric: f.clericRef, target: f.s.gameState.battle!.defense!.targetRef } });
    expect(named.newState.gameState.players.find((p) => p.playerId === 'wiz')!.manaCurrent).toBe(1);
  });
});

describe('privacy: options that expose a hand or a spy go only to the deciding seat', () => {
  for (const [name, make] of [
    ['battle commit', commitOwnerFirst], ['Extra selection', extraSelection], ['battle defense', () => battleDefense('mana_shield', 3)],
  ] as Array<[string, () => Fixture]>) {
    it(name, () => {
      const f = make();
      const other = f.forPlayerId === 'wiz' ? 'rob' : 'wiz';
      expect(pendingOf(f, other).options).toBeUndefined();
      expect(pendingOf(f, other).question).toBe(pendingOf(f).question);
      const pub = (neitherGutsNorGears.getPublicView(f.s) as { pending: PendingView<NGGMove> }).pending;
      expect(pub.options).toBeUndefined();
      expect(pub.context).toBeUndefined();
    });
  }
});
