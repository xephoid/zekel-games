import { describe, expect, it } from 'vitest';
import { applyMove, createInitialState } from '../engine.js';
import { getLegalMoves } from '../legalMoves.js';
import type { CNState, CNMove } from '../types.js';
import { PEOPLE, LOCATIONS, getPerson } from '../data/index.js';

// Regression: a HUMAN (opaque) Hacker must be OFFERED its Evidence plays.
// Before 2026-08-17 every Evidence option sat behind `hacker.kind === 'tracked'`
// in legalMoves, so the human Hacker's entire win path was missing from
// get_legal_moves even though the engine accepted the declared move fine —
// the "DON'T MAKE THE MODEL GUESS" rule (CLAUDE.md). Same class of gap as the
// buy_clue one already fixed for opaque Detectives (POST-PORT.md).
//
// v2.4: Witness evidence is an atomic trio like a Motive set, so what the
// opaque seat is offered is ONE declared complete-set prompt per piece.

function humanHackerState(seed = 3): CNState {
  let s = createInitialState(['det', 'hak'], { det: 'tracked', hak: 'opaque' }, undefined, seed);
  // The human Hacker reports their hideout to leave setup.
  s = applyMove(s, 'hak', { type: 'report_hideout', location_name: LOCATIONS[0]!.name }).newState;
  // Detective's turn first — hand it over.
  while (s.activePlayerId !== 'hak') {
    const dm = getLegalMoves(s, 'det');
    const pick = dm.find(m => m.move.type === 'pass_turn') ?? dm[0]!;
    s = applyMove(s, 'det', pick.move).newState;
  }
  return s;
}

function evidenceMoves(s: CNState): CNMove[] {
  return getLegalMoves(s, 'hak').map(m => m.move).filter(m => m.type === 'play_evidence');
}

function ofType(s: CNState, kind: 'weapon' | 'witness' | 'motive'): CNMove[] {
  return evidenceMoves(s).filter(m => m.type === 'play_evidence' && m.evidence_type === kind);
}

describe('opaque (human) Hacker — Evidence plays are offered', () => {
  it('offers the Weapon, a complete Witness set, and a complete Motive set', () => {
    const s = humanHackerState();
    expect(evidenceMoves(s).length).toBeGreaterThan(0);

    expect(ofType(s, 'weapon')).toHaveLength(1);

    // v2.4: ONE atomic witness offer naming all 3 slots, not one per witness.
    const witness = ofType(s, 'witness');
    expect(witness).toHaveLength(1);
    expect((witness[0] as { people: string[] }).people).toHaveLength(3);

    const motive = ofType(s, 'motive');
    expect(motive).toHaveLength(1);
    expect((motive[0] as { people: string[] }).people).toHaveLength(3);
  });

  it('the witness offer names the eligible pool so the model never invents a name', () => {
    const s = humanHackerState();
    const offer = getLegalMoves(s, 'hak').find(m => m.move_id === 'evidence_witnessset')!;
    for (const p of PEOPLE.filter(p => p.is_witness)) {
      expect(offer.description).toContain(p.name);
    }
  });

  it('the offered Weapon and Witness set are accepted by the engine', () => {
    let s = humanHackerState();
    const weapon = ofType(s, 'weapon')[0]!;
    s = applyMove(s, 'hak', weapon).newState;
    expect(s.hacker.evidence.weapon).toBe(true);
    // Once played, it is no longer offered.
    expect(ofType(s, 'weapon')).toHaveLength(0);

    // The opaque offer is a template — the human names their own three cards.
    const trio = PEOPLE.filter(p => p.is_witness && p.ability === 'witness').slice(0, 3);
    s = applyMove(s, 'hak', { type: 'play_evidence', evidence_type: 'witness', people: trio.map(p => p.name) }).newState;
    if (s.pending?.type === 'block_pending') {
      s = applyMove(s, 'det', { type: 'block_decide', block: false }).newState;
    }
    expect(s.hacker.evidence.witnesses).toEqual(trio.map(p => p.id));
    // The piece is complete — no second witness offer.
    expect(ofType(s, 'witness')).toHaveLength(0);
  });

  it('a single witness is never offered and never accepted', () => {
    const s = humanHackerState();
    const witness = PEOPLE.find(p => p.is_witness)!;
    expect(evidenceMoves(s).some(m => m.type === 'play_evidence' && m.person_name === witness.name)).toBe(false);
    expect(() => applyMove(s, 'hak', { type: 'play_evidence', person_name: witness.name, evidence_type: 'witness' }))
      .toThrow(/COMPLETE set/);
  });

  it('withholds the witness offer entirely when fewer than 3 Witnesses are eligible', () => {
    const s = humanHackerState();
    const witnessIds = PEOPLE.filter(p => p.is_witness).map(p => p.id);
    // Jail all but two — the piece cannot be assembled, so nothing is offered.
    const s2: CNState = { ...s, detective: { ...s.detective, jail: [witnessIds.slice(0, witnessIds.length - 2), [], []] } };
    expect(ofType(s2, 'witness')).toHaveLength(0);
  });

  it('withholds jailed / already-used people from the witness pool, and drops the Motive offer when all sets are complete', () => {
    const s = humanHackerState();
    const witnessIds = PEOPLE.filter(p => p.is_witness).map(p => p.id);
    const jailed = witnessIds[0]!;

    const s2: CNState = { ...s, detective: { ...s.detective, jail: [[jailed], [], []] } };
    const offer = getLegalMoves(s2, 'hak').find(m => m.move_id === 'evidence_witnessset')!;
    expect(offer.description).not.toContain(getPerson(jailed)!.name);

    // Three complete Motive sets → no Motive offer left.
    const nonWitness = PEOPLE.filter(p => !p.is_witness);
    const trio = (n: number) => nonWitness.slice(n * 3, n * 3 + 3).map(p => p.id);
    const s3: CNState = {
      ...s,
      hacker: {
        ...s.hacker,
        evidence: { ...s.hacker.evidence, motive_set_1: trio(0), motive_set_2: trio(1), motive_set_3: trio(2) },
      },
    };
    expect(ofType(s3, 'motive')).toHaveLength(0);
  });
});
