// Every listed play that moves a piece says where it lands (LegalMove.landing),
// and the engine, applying that move, puts the piece exactly there. Battles
// keep their dice in the public view (last_battle). The reference data names
// the influence cap. These exist so a client can draw destinations and dice
// without working out a rule itself.

import { describe, expect, it } from 'vitest';
import { createInitialState, applyMove } from '../engine.js';
import { getLegalMoves } from '../legalMoves.js';
import { getPublicView } from '../views.js';
import { sweetlandsImperium } from '../index.js';
import { sameLocation } from '../geometry.js';
import type { PlayerConfig } from '@zekel/game-kit';
import type { SweetlandsState, SweetlandsMove, UnitLocation, IntelCard, UnitType } from '../types.js';

const DIG: PlayerConfig = { player_id: 'a', kind: 'human', table: 'digital' };
const AI: PlayerConfig = { player_id: 'b', kind: 'ai' };

function toPlay(seed: number): SweetlandsState {
  let s = createInitialState([DIG, AI], undefined, seed);
  s = applyMove(s, 'a', { type: 'assign_setup_choices', selections: { a: 'milkshake', b: 'fudge' } } as SweetlandsMove).newState;
  s = applyMove(s, 'a', { type: 'choose_foe', foe: 'orc' } as SweetlandsMove).newState;
  s = applyMove(s, 'a', { type: 'choose_secret_objective', objective: s.setup.secretDeal['a']![0]! } as SweetlandsMove).newState;
  s = applyMove(s, 'a', { type: 'resolve_report' } as SweetlandsMove).newState;
  return s;
}

/** Put seat a in its play step with the given hand and unit places. */
function atPlay(s: SweetlandsState, hand: IntelCard[], units?: Partial<Record<UnitType, UnitLocation>>): SweetlandsState {
  const a = s.players.find((p) => p.playerId === 'a')!;
  a.hand = hand;
  Object.assign(a.units, units ?? {});
  a.turn.step = 'play';
  s.pending = null;
  s.activePlayerId = 'a';
  s.currentPlayerIndex = s.players.indexOf(a);
  return s;
}

const clone = (s: SweetlandsState): SweetlandsState => JSON.parse(JSON.stringify(s)) as SweetlandsState;

describe('where a listed play lands', () => {
  const COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const;
  const PLACES: UnitLocation[] = [
    { zone: 'start', region: 1 },
    { zone: 'ring', region: 1, ringIndex: 3 },
    { zone: 'ring', region: 2, ringIndex: 4 }, // just before a junction
    { zone: 'ring', region: 4, ringIndex: 11 }, // the last ring space before region 1
    { zone: 'road', region: 3, roadIndex: 2 },
    { zone: 'treat', region: 2, slotKind: 'random' },
  ];

  it('moves the piece to the listed landing, by its listed path, for every color, place, piece and route', () => {
    const base = toPlay(11);
    let checked = 0;
    for (const color of COLORS) {
      for (const place of PLACES) {
        const s = atPlay(clone(base), [{ cardId: 'x', kind: 'single', color }], { knight: place, leader: place, ambassador: place });
        for (const m of getLegalMoves(s, 'a')) {
          const mv = m.move as Extract<SweetlandsMove, { type: 'play_intel' }>;
          if (mv.type !== 'play_intel' || mv.takeAction) continue;
          expect(m.landing, m.description).toBeDefined();
          const landing = m.landing!;
          expect(landing.piece).toBe(mv.unit);
          expect(landing.from).toEqual(place);
          const after = applyMove(clone(s), 'a', mv).newState.players.find((p) => p.playerId === 'a')!;
          expect(sameLocation(after.units[mv.unit], landing.to as UnitLocation), m.description).toBe(true);
          if (landing.path.length > 0) expect(landing.path[landing.path.length - 1]).toEqual(landing.to);
          else expect(landing.to).toEqual(place);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('moves a double card twice and lists both stops', () => {
    const s = atPlay(toPlay(12), [{ cardId: 'd', kind: 'double', color: 'blue' }], { ambassador: { zone: 'ring', region: 1, ringIndex: 0 } });
    const m = getLegalMoves(s, 'a').find((x) => (x.move as { unit?: string; takeAction?: boolean }).unit === 'ambassador' && (x.move as { takeAction?: boolean }).takeAction === false)!;
    expect(m.landing!.stops).toEqual([{ zone: 'ring', region: 1, ringIndex: 4 }, { zone: 'ring', region: 1, ringIndex: 10 }]);
    const after = applyMove(clone(s), 'a', m.move).newState.players.find((p) => p.playerId === 'a')!;
    expect(after.units.ambassador).toEqual(m.landing!.to);
    expect(m.landing!.path).toHaveLength(10);
  });

  it('sends a treat card to the slot holding that treat', () => {
    const s = atPlay(toPlay(13), [{ cardId: 't', kind: 'treat', treat: 'fudge' }]);
    for (const m of getLegalMoves(s, 'a').filter((x) => x.move.type === 'play_intel')) {
      expect(m.landing!.to).toEqual({ zone: 'treat', region: 2, slotKind: 'regional' });
      const after = applyMove(clone(s), 'a', m.move).newState.players.find((p) => p.playerId === 'a')!;
      expect(after.units[(m.move as { unit: UnitType }).unit]).toEqual(m.landing!.to);
    }
  });

  it('lists no landing for a move that moves nothing', () => {
    const s = atPlay(toPlay(14), [{ cardId: 'g', kind: 'single', color: 'green' }]);
    const discardGreen = getLegalMoves(s, 'a').find((x) => x.description.startsWith('Discard Green'))!;
    expect(discardGreen.landing).toBeUndefined();
    expect(getLegalMoves(s, 'a').find((x) => x.move.type === 'pass')!.landing).toBeUndefined();
  });
});

describe('the dice of the last battle', () => {
  it('are in the public view, each face a sugar-die face, adding up to the total', () => {
    const s = atPlay(toPlay(15), [{ cardId: 'r', kind: 'single', color: 'red' }], { knight: { zone: 'castle' } });
    expect((getPublicView(s) as { last_battle: unknown }).last_battle).toBeNull();
    const red = getLegalMoves(s, 'a').find((x) => x.description.includes('take the red action') && (x.move as { unit?: string }).unit === 'knight')!;
    const after = applyMove(s, 'a', red.move).newState;
    const lb = (getPublicView(after) as { last_battle: { id: number; kind: string; attacker: { faces: number[]; total: number }; defender: { foe: string; faces: number[]; total: number }; winner: string } }).last_battle;
    expect(lb.id).toBe(1);
    expect(lb.kind).toBe('foe');
    expect(lb.defender.foe).toBe('orc');
    expect(lb.defender.faces).toHaveLength(3);
    for (const side of [lb.attacker, lb.defender]) {
      for (const f of side.faces) expect([0, 1, 2, 3]).toContain(f);
      expect(side.faces.reduce((x, y) => x + y, 0)).toBe(side.total);
    }
    expect(lb.winner).toBe(lb.attacker.total > lb.defender.total ? 'attacker' : 'defender');
  });
});

describe('the reference data', () => {
  it('names the influence cap', () => {
    expect((sweetlandsImperium.getReferenceData() as { influence_cap: number }).influence_cap).toBe(5);
  });
});
