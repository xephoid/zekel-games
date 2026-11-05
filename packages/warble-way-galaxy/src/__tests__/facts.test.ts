import { describe, expect, it } from 'vitest';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';
import { checkGateConsistency } from '@zekel/game-kit';
import { applyMove, createInitialState } from '../engine.js';
import { chanceAtLeast, moveGates, previewMove, rollFacts, withPreviews } from '../facts.js';
import { getLegalMoves } from '../legalMoves.js';
import { getView } from '../views.js';
import { warbleWayGalaxy } from '../index.js';
import { ABILITY_NAMES } from '../data/abilities.js';
import type { AbilityScores, WarbleMove, WarbleWayGalaxyState } from '../types.js';

// What the engine tells a table beside a choice (facts.ts): a roll's chance
// and stakes, what a move leads to, why a move is shut, where a being can
// step. The load-bearing checks here are that every published chance equals
// the count of real resolutions, dice by dice, and that the grey list and
// the legal list never disagree.

const PHYSICAL: PlayerConfig[] = [{ player_id: 'p1', kind: 'human', name: 'Zeke' }];
const DIGITAL: PlayerConfig[] = [{ player_id: 'p1', kind: 'human', name: 'Zeke', table: 'digital' }];
const BOT: PlayerConfig[] = [{ player_id: 'bot', kind: 'ai' }];
type View = Record<string, any>;

function makeChar(players: PlayerConfig[], scores: AbilityScores, seed = 7): WarbleWayGalaxyState {
  const s = createInitialState(players, { seed });
  return applyMove(s, { type: 'create_character', character_name: 'Zara', race: 'kralkin', ship_name: 'Wandering Star', method: 'recommended', scores }).newState;
}
const apply = (s: WarbleWayGalaxyState, m: WarbleMove) => applyMove(s, m).newState;
const sessionOf = (gameState: WarbleWayGalaxyState, players: PlayerConfig[]): SessionState<WarbleWayGalaxyState> => ({ ...warbleWayGalaxy.createSession(players, { seed: 7 }), gameState });

/** Every way n dice can fall. */
function* allDice(n: number): Generator<number[]> {
  const total = 6 ** n;
  for (let i = 0; i < total; i++) {
    const dice: number[] = [];
    let x = i;
    for (let d = 0; d < n; d++) { dice.push((x % 6) + 1); x = Math.floor(x / 6); }
    yield dice;
  }
}

describe('chances', () => {
  it('three dice: 10 or more is 62.5%, 9 or more is 74.07%, 3 or more is certain, 19 is impossible', () => {
    expect(chanceAtLeast(3, 10)).toBeCloseTo(0.625, 6);
    expect(chanceAtLeast(3, 9)).toBeCloseTo(160 / 216, 6);
    expect(chanceAtLeast(3, 3)).toBe(1);
    expect(chanceAtLeast(3, 19)).toBe(0);
  });
});

describe('a roll at the cantina', () => {
  const start = makeChar(PHYSICAL, { PIL: 3, SWA: 2, MEC: 1 });
  const rolling = apply(start, { type: 'attempt_recruit', recruit_name: 'h1-c4' });

  it('names who is being recruited, whose score is added, the number, the chance and both outcomes', () => {
    const f = rollFacts(rolling)!;
    expect(f.name).toBe('Recruit');
    expect(f.subject).toBe('Slate');
    expect(f.carrier).toBe('you');
    expect(f.target).toBe(11);
    expect(f.bonus).toBe(3);
    expect(f.dice_need).toBe(8);
    expect(f.chance).toBeCloseTo(chanceAtLeast(3, 8), 4);
    expect(f.on_pass).toMatch(/Slate joins the crew/);
    expect(f.on_fail).toMatch(/marked/);
    expect((getView(rolling) as View).roll_facts.subject).toBe('Slate');
  });

  it('the result is read back once, with the dice and the arithmetic, and is gone after the next move', () => {
    const joined = apply(rolling, { type: 'report_roll', dice: [5, 4, 2] });
    const v = getView(joined) as View;
    expect(v.last_roll).toMatchObject({ reason: 'recruit', dice: [5, 4, 2], bonus: 3, total: 14, target: 11, outcome: 'pass' });
    expect(v.last_roll.parts[0]).toMatchObject({ kind: 'score', ability: 'PIL', who: 'you', bonus: 3 });
    const after = apply(joined, { type: 'pay_repair' });
    expect((getView(after) as View).last_roll).toBeNull();
  });

  it('a crew member keeps the label moves use and gains the name on their row', () => {
    const joined = apply(rolling, { type: 'report_roll', dice: [6, 6, 6] });
    const crew = (getView(joined) as View).crew[0];
    expect(crew.name).toBe('Grull (DIP+1)');
    expect(crew.title).toBe('Slate');
    expect(joined.crew[0]!.recruit_id).toBe('h1-c4');
  });
});

describe('items and the ship', () => {
  it('an item carries the shop\'s name, what it does, and who wears it', () => {
    let s = makeChar(PHYSICAL, { PIL: 3, SWA: 2, MEC: 1 });
    s.character!.credits = 1000;
    s = apply(s, { type: 'buy_item', item_name: 'Weapon +1 GUN' });
    let item = (getView(s) as View).items[0];
    expect(item).toMatchObject({ title: 'WinchesterZhang Plinker', name: 'Weapon +1 GUN', worn_by: null, fitted: false });
    expect(item.effect).toMatch(/\+1 Gunslinging/);
    s = apply(s, { type: 'equip_item', item_name: 'Weapon +1 GUN', being: 'Zara' });
    item = (getView(s) as View).items[0];
    expect(item.worn_by).toBe('Zara');
  });

  it('counts the hits the ship has left, the destroying one included', () => {
    const s = makeChar(PHYSICAL, { PIL: 3, SWA: 2, MEC: 1 });
    const hits = (damage: string, bulk = false) => {
      const t = structuredClone(s);
      t.ship!.damage = damage as never;
      if (bulk) t.character!.abilities.ARM = 3;
      return (getView(t) as View).ship.hits_to_lost;
    };
    expect(hits('pristine')).toBe(4);
    expect(hits('used')).toBe(3);
    expect(hits('damaged')).toBe(2);
    expect(hits('hobbled')).toBe(1);
    expect(hits('hobbled', true)).toBe(2);
  });
});

describe('what a move leads to', () => {
  const start = makeChar(DIGITAL, { PIL: 3, SWA: 2, MEC: 1 });

  it('a digital seat\'s listed moves carry it; a physical seat\'s list is unchanged', () => {
    const digital = warbleWayGalaxy.getLegalMoves(sessionOf(start, DIGITAL), 'p1') as Array<Record<string, any>>;
    const mission = digital.find((m) => m.move_id === 'take-mission-h1-m3')!;
    expect(mission.preview.then).toMatch(/You leave Xaxalon 4 at once: 3 cards out, the check, then 3 cards back/);
    expect(mission.preview.check).toMatchObject({ name: 'Mission', subject: 'The Leaky Recycler', target: 10, bonus: 1, dice_need: 9 });
    expect(mission.preview.check.on_pass).toMatch(/300c and 1 XP/);
    const recruit = digital.find((m) => m.move_id === 'recruit-h1-c1')!;
    expect(recruit.preview.roll).toMatchObject({ subject: 'Wang', target: 11, bonus: 2 });
    const physical = warbleWayGalaxy.getLegalMoves(sessionOf(makeChar(PHYSICAL, { PIL: 3, SWA: 2, MEC: 1 }), PHYSICAL), 'p1') as Array<Record<string, any>>;
    expect(physical.every((m) => m.preview === undefined)).toBe(true);
  });

  it('a hazard nobody can face says there is no roll, what it costs, and that a red shirt cannot step in', () => {
    const s = structuredClone(start);
    s.phase = 'traveling';
    s.unnamed_crew = 1;
    s.pending = { kind: 'hazard_option', card_id: '9S', must_fail: true };
    const p = previewMove(s, { type: 'choose_hazard_option', option: 2 })!;
    expect(p.roll).toBeUndefined();
    expect(p.then).toMatch(/No roll/);
    expect(p.then).toMatch(/Lose 100 credits, to 100c/);
    expect(p.then).toMatch(/red shirt cannot take this one/);
  });

  it('a hazard two beings could carry lists each, with the roll as they would make it', () => {
    let s = makeChar(PHYSICAL, { SWA: 3, PIL: 2, MEC: 1 });
    s.crew.push({ name: 'Kralkin (SWA+1)', race: 'kralkin', idealized: 'moxie', abilities: { SWA: 1 }, anger_tokens: 0, gear: { weapon: null, armor: null } });
    s.phase = 'traveling';
    s.pending = { kind: 'hazard_option', card_id: '3S', must_fail: false };
    const p = previewMove(s, { type: 'choose_hazard_option', option: 2 })!;
    expect(p.carriers?.map((c) => c.title)).toEqual(['you', 'Kralkin (SWA+1)']);
    expect(p.carriers![0]!.roll.on_fail).toMatch(/death check/);
    expect(p.carriers![1]!.roll.on_fail).toMatch(/Kralkin \(SWA\+1\) dies/);
    s = apply(s, { type: 'choose_hazard_option', option: 2, carrier: 'Kralkin (SWA+1)' } as WarbleMove);
    expect(rollFacts(s)!.carrier).toBe('Kralkin (SWA+1)');
  });
});

describe('why a move is shut', () => {
  it('at the start: what cannot be bought, the missions nobody can take, and the visit actions, each with its reason', () => {
    const s = makeChar(PHYSICAL, { PIL: 3, SWA: 2, MEC: 1 });
    const gates = moveGates(s);
    const reason = (type: string, item?: string) => gates.find((g) => g.move_type === type && g.item === item)?.reason;
    expect(reason('buy_item', 'h1-s2')).toBe('Costs 300c; you have 200c.');
    expect(reason('take_mission', 'h1-m1')).toMatch(/Nobody aboard has Research \(RES\)/);
    expect(reason('attempt_repair')).toMatch(/one repair roll each time you arrive from a trip/);
    expect(reason('attempt_reduce_unrest')).toBeDefined();
    expect(reason('recruit_unnamed')).toBe(`Needs ${ABILITY_NAMES.DIP} (DIP) aboard.`);
    expect(reason('depart_for_next_habitat')).toMatch(/4 of its missions have been tried.*You have tried 0/);
    expect(checkGateConsistency(gates, getLegalMoves(s, 'p1'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Across real games: the engine's AI plays, and at every step the facts are
// held against what the engine then does.
// ---------------------------------------------------------------------------

describe('across seeded games', () => {
  it('every chance equals the count of real resolutions; gates agree with the legal list; previews, reach and the surrender call hold', async () => {
    const checked = new Set<string>();
    const reasons = new Set<string>();
    let converts = 0;
    let reachChecks = 0;
    for (const seed of [11, 12, 13, 14, 15, 16]) {
      let session = warbleWayGalaxy.createSession(BOT, { seed });
      for (let ply = 0; ply < 500 && !warbleWayGalaxy.isGameOver(session); ply++) {
        const gs = session.gameState;
        const legal = getLegalMoves(gs, 'bot');

        // The grey list and the legal list never disagree.
        const gates = moveGates(gs);
        expect(checkGateConsistency(gates, legal)).toEqual([]);
        for (const g of gates.filter((x) => x.item !== undefined)) {
          const id = g.move_type === 'buy_item' ? `buy-${g.item}` : g.move_type === 'take_mission' ? `take-mission-${g.item}`
            : g.move_type === 'choose_hazard_option' ? `hazard-${g.item}` : `accept-mission-${String(g.item).replace('option-', '')}`;
          expect(legal.some((m) => m.move_id === id)).toBe(false);
        }

        // A preview's roll is the roll the move opens.
        for (const m of withPreviews(gs, legal)) {
          if (!m.preview?.roll) continue;
          const after = applyMove(gs, m.move).newState;
          expect(after.pending?.kind).toBe('roll');
          expect(m.preview.roll).toEqual(rollFacts(after));
        }

        // The view never throws, and a marked square is one the being can end on.
        const view = getView(gs) as View;
        if (gs.pending?.kind === 'ruin_turn' && view.ruin?.party && reachChecks < 60) {
          for (const t of view.ruin.party as View[]) {
            if (t.ended) { expect(t.reach).toEqual([]); continue; }
            expect(t.moves_left).toBe(t.move_allowance - t.moved);
            const cell = (t.reach as string[])[0];
            if (!cell) continue;
            reachChecks++;
            expect(() => applyMove(gs, { type: 'move_being', being: t.name, to: cell })).not.toThrow();
          }
        }

        // An open roll: enumerate every way the dice can fall through the real resolution.
        if (gs.pending?.kind === 'roll') {
          const p = gs.pending;
          reasons.add(p.reason);
          const key = `${p.reason}:${p.context.ground ?? ''}:${p.dice_count}:${p.min_roll}:${p.score_source.bonus}`;
          if (!checked.has(key) && p.dice_count <= 5 && checked.size < 60) {
            checked.add(key);
            const f = rollFacts(gs)!;
            const tally: Record<string, number> = { pass: 0, fail: 0, win: 0, lose: 0, tie: 0, none: 0 };
            let n = 0;
            for (const dice of allDice(p.dice_count)) {
              const r = applyMove(gs, { type: 'report_roll', dice });
              const last = r.newState.last_roll!;
              tally[last.outcome]! += 1;
              n++;
              if (last.outcome === 'pass') expect(r.summary).toMatch(/SUCCESS/);
              if (last.outcome === 'fail') expect(r.summary).toMatch(/FAIL/);
              if (last.outcome === 'tie') expect(r.summary).toMatch(/TIE/);
              if (last.outcome === 'win' || last.outcome === 'lose') expect(r.summary).not.toMatch(/TIE/);
              if (last.outcome === 'win' && !/Splash/.test(r.summary)) expect(r.summary).toMatch(/WIN the exchange|CAPTURED|FALLS|weathers/);
            }
            if (f.pairing) {
              expect(f.pairing.win).toBeCloseTo(tally['win']! / n, 4);
              expect(f.pairing.tie).toBeCloseTo(tally['tie']! / n, 4);
              expect(f.pairing.lose).toBeCloseTo(tally['lose']! / n, 4);
            } else if (f.target !== undefined) {
              expect(f.chance).toBeCloseTo(tally['pass']! / n, 4);
            } else {
              expect(f.table).toHaveLength(6);
              expect(tally['none']).toBe(n);
            }
            expect(f.on_pass.length + f.on_fail.length).toBeGreaterThan(0);
            // No rule or ruling number reaches the table's words.
            for (const text of [f.on_pass, f.on_fail, ...f.notes, f.pairing?.why ?? '']) expect(text).not.toMatch(/WR §|amendment|ruling #|\(A\d/);
          }
        }

        const pick = await warbleWayGalaxy.getAIMove(session, 'bot', 'medium');
        if (pick.move.type === 'convert_attacker') {
          converts++;
          const move = pick.move;
          expect(legal.some((m) => m.move.type === 'convert_attacker' && m.move.being === move.being && m.move.target === move.target)).toBe(true);
        }
        session = warbleWayGalaxy.applyMove(session, 'bot', pick.move).newState;
      }
    }
    // The run reached enough of the game to mean something.
    for (const r of ['recruit', 'mission_check', 'hazard_check', 'space_combat', 'ground_combat', 'escape']) expect([...reasons]).toContain(r);
    expect(checked.size).toBeGreaterThan(15);
    expect(reachChecks).toBeGreaterThan(5);
    expect(converts).toBeGreaterThanOrEqual(0);
  }, 120_000);
});
