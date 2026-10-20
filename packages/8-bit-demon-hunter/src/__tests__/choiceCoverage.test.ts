import { describe, expect, it } from 'vitest';
import { DEMON_HUNTER_CHOICES } from '../choices.js';
import { MOVE_TYPES } from '../engine/moves.js';
import { getLegalMoves } from '../legalMoves.js';
import type { DemonHunterState } from '../types.js';
import { apply, clearAllEnemies, fresh, outsideStart, place } from './support.js';

// Post-port §5: every `player` row's moves are actually OFFERED to the human
// seat in some reachable situation, and every move type a row names exists.
// (The repo-wide choiceCoverage check plays with the real server; this is the
// same question asked of the engine directly, with staged situations because
// the harness bot never visits temples or uses the magic items.)

function stage(name: string): DemonHunterState {
  switch (name) {
    case 'town': {
      let s = fresh(1);
      s.player.lockpicks = 1;
      s.player.magicItems.push('space');
      s.player.visitedTowns.push(s.towns[1]!.id);
      s.player.xp = 4;
      s = apply(s, { type: 'talk', person: s.towns[0]!.people[0]!.id });
      s = apply(s, { type: 'goodbye' });
      s = apply(s, { type: 'talk', person: s.towns[0]!.people[1]!.id });
      s = apply(s, { type: 'goodbye' });
      return apply(s, { type: 'mark_suspect', person: s.towns[0]!.people[0]!.id }); // one marked, one not
    }
    case 'offer': {
      const s = fresh(1);
      return apply(s, { type: 'talk', person: s.towns[0]!.people[0]!.id });
    }
    case 'reward': {
      let s = fresh(1);
      const holder = s.towns[0]!.people.find((p) => p.clues.good)!;
      s = apply(s, { type: 'talk', person: holder.id });
      s = apply(s, { type: 'accept_task' });
      s = apply(s, { type: 'goodbye' });
      s.towns[0]!.people.find((p) => p.id === holder.id)!.task.isCompleted = true;
      return apply(s, { type: 'talk', person: holder.id });
    }
    case 'found': {
      let s = fresh(1);
      const giver = s.towns[0]!.people[0]!;
      const target = s.towns[0]!.people[1]!;
      giver.task = { ...giver.task, type: 'FIND_PERSON', targetId: target.attributes.pet, targetName: target.attributes.pet, amount: 1, currentAmount: 0, description: 'Find', isCompleted: false };
      s = apply(s, { type: 'talk', person: giver.id });
      s = apply(s, { type: 'accept_task' });
      s = apply(s, { type: 'goodbye' });
      return apply(s, { type: 'talk', person: target.id });
    }
    case 'inn': {
      const s = fresh(1);
      s.player.shuckles = 100;
      s.player.hp = 1;
      s.player.resources.wood = 1;
      return apply(s, { type: 'inn' });
    }
    case 'outdoors': {
      const s = outsideStart(1);
      clearAllEnemies(s);
      place(s, 'slime', s.player.at, 'slime_a');
      place(s, 'lady_bandit', s.player.at, 'lady_a');
      s.player.bombs = 1;
      s.player.magicItems.push('sky', 'earth');
      s.resources['ore_a'] = { id: 'ore_a', kind: 'ore', at: s.player.at, hp: 0 };
      return s;
    }
    case 'flying': {
      let s = outsideStart(1);
      s.player.magicItems.push('sky');
      s = apply(s, { type: 'fly' });
      return s;
    }
    case 'combat': {
      let s = outsideStart(1);
      s.player.maxHp = 10;
      s.player.hp = 10;
      s.player.magicItems.push('earth');
      place(s, 'skeleton', s.player.at, 'skel_a');
      return apply(s, { type: 'attack', target: 'skel_a' });
    }
    case 'temple-choice': {
      const s = outsideStart(1);
      clearAllEnemies(s);
      s.player.at = 'temple_earth';
      return apply(s, { type: 'enter' });
    }
    case 'gauntlet': {
      return apply(stage('temple-choice'), { type: 'gauntlet' });
    }
    case 'riddle': {
      return apply(stage('temple-choice'), { type: 'riddle' });
    }
    case 'dead': {
      const s = outsideStart(1);
      s.player.agility = 1;
      place(s, 'undead_knight', s.player.at, 'knight_a');
      return apply(s, { type: 'attack', target: 'knight_a' });
    }
    default:
      throw new Error(name);
  }
}

const STAGES = ['town', 'offer', 'reward', 'found', 'inn', 'outdoors', 'flying', 'combat', 'temple-choice', 'gauntlet', 'riddle', 'dead'];

describe('choice catalog coverage', () => {
  it('names only real move types (or session options)', () => {
    for (const row of DEMON_HUNTER_CHOICES) {
      for (const m of row.resolvedBy) {
        if (m.startsWith('options.')) continue;
        expect(MOVE_TYPES as readonly string[], `${row.id} → ${m}`).toContain(m);
      }
    }
    expect(new Set(DEMON_HUNTER_CHOICES.map((r) => r.id)).size).toBe(DEMON_HUNTER_CHOICES.length);
  });

  it('offers every player-owned move (with its distinguishing field) in some staged situation', () => {
    const offered = new Map<string, Set<string>>(); // move type → fields seen set
    for (const name of STAGES) {
      for (const lm of getLegalMoves(stage(name))) {
        const set = offered.get(lm.move.type) ?? new Set<string>();
        for (const [k, val] of Object.entries(lm.move)) if (k !== 'type' && val !== undefined && val !== '') set.add(k);
        offered.set(lm.move.type, set);
      }
    }
    for (const row of DEMON_HUNTER_CHOICES.filter((r) => r.owner === 'player')) {
      const moves = row.resolvedBy.filter((m) => !m.startsWith('options.'));
      for (const m of moves) expect(offered.has(m), `${row.id}: ${m} is offered somewhere`).toBe(true);
      if (row.distinguishedBy && !moves.includes('answer_riddle')) {
        const carried = moves.some((m) => offered.get(m)!.has(row.distinguishedBy!));
        expect(carried, `${row.id}: some offered move carries ${row.distinguishedBy}`).toBe(true);
      }
    }
  });

  it('explains every auto-resolved decision', () => {
    for (const row of DEMON_HUNTER_CHOICES.filter((r) => r.owner === 'auto')) {
      expect(row.why, row.id).toBeDefined();
      expect(row.why!.length).toBeGreaterThan(20);
    }
  });
});
