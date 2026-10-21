import { describe, expect, it } from 'vitest';
import { ENEMY_BY_ID } from '../data/enemies.js';
import { RIDDLES } from '../data/riddles.js';
import { getView } from '../views.js';
import { getLegalMoves } from '../legalMoves.js';
import { describeNextStep } from '../nextStep.js';
import { apply, fresh, outsideStart } from './support.js';
import { SESSION_START_GUIDANCE } from '../guidance.js';
import { DEMON_HUNTER_RULE_SECTIONS, renderRules } from '../rulesSections.js';

// Nothing hidden may reach the player view, the legal moves or next_step:
// the demon's identity, minion flags, unearned secrets, riddle answers.

function serialised(seed: number): { text: string; state: ReturnType<typeof fresh> } {
  let s = fresh(seed);
  // meet everyone in the first town so their cards are in the view
  for (const p of s.towns[0]!.people) {
    s = apply(s, { type: 'talk', person: p.id });
    s = apply(s, { type: 'goodbye' });
  }
  const text = JSON.stringify([getView(s), getLegalMoves(s), describeNextStep(s, 'p1')]);
  return { text, state: s };
}

describe('the player view hides the mystery', () => {
  it('never contains the demon id, isDemon/isMinion, or an unearned secret, over 30 seeds', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { text, state } = serialised(seed);
      expect(text).not.toContain('isDemon');
      expect(text).not.toContain('isMinion');
      expect(text).not.toContain('demonId');
      expect(text).not.toContain('"lying"'); // no Eye of Truth yet
      for (const p of state.towns.flatMap((t) => t.people)) {
        if (p.clues.good) expect(text, `${p.id}'s secret ${p.clues.good.text}`).not.toContain(p.clues.good.text);
      }
      // the demon id appears only as an ordinary person id (talk/stab targets), never flagged
      const demon = state.towns.flatMap((t) => t.people).find((p) => p.id === state.demonId)!;
      const view = getView(state) as { here: { people: { id: string; name: string }[] } };
      const card = view.here.people.find((x) => x.id === demon.id) as Record<string, unknown> | undefined;
      if (card) {
        expect(card.isDemon).toBeUndefined();
        expect(card.isMinion).toBeUndefined();
        expect(card.lying).toBeUndefined();
      }
    }
  });

  it('shows an earned secret in the clue book and nowhere else', () => {
    let s = fresh(2);
    const holder = s.towns[0]!.people.find((p) => p.clues.good)!;
    s = apply(s, { type: 'talk', person: holder.id });
    s = apply(s, { type: 'accept_task' });
    s = apply(s, { type: 'goodbye' });
    s.towns[0]!.people.find((p) => p.id === holder.id)!.task.isCompleted = true;
    s = apply(s, { type: 'talk', person: holder.id });
    s = apply(s, { type: 'claim_reward', reward: 'clue' });
    const view = getView(s) as { clue_book: { clues: { text: string; kind: string }[] } };
    expect(view.clue_book.clues.some((c) => c.text === holder.clues.good!.text && c.kind === 'secret')).toBe(true);
  });

  it('never contains a riddle answer, even inside the temple', () => {
    let s = outsideStart(3);
    s.player.at = 'temple_earth';
    s = apply(s, { type: 'enter' });
    s = apply(s, { type: 'riddle' });
    const text = JSON.stringify([getView(s), getLegalMoves(s), describeNextStep(s, 'p1')]);
    expect(text).toContain(RIDDLES.earth.text);
    for (const a of RIDDLES.earth.answers) expect(text.toLowerCase()).not.toContain(a.toLowerCase());
  });

  it('with the Eye of Truth the lying flag appears only on liars', () => {
    const s = fresh(4);
    s.player.magicItems.push('light');
    for (const p of s.towns[0]!.people) p.hasMet = true;
    const view = getView(s) as { here: { people: { id: string; lying?: boolean }[] } };
    for (const card of view.here.people) {
      const p = s.towns[0]!.people.find((x) => x.id === card.id)!;
      expect(card.lying).toBe(p.isDemon || p.isMinion);
    }
  });

  it('unmet people show only name and occupation', () => {
    const s = fresh(5);
    const view = getView(s) as { here: { people: Record<string, unknown>[] } };
    for (const card of view.here.people) {
      expect(card.met).toBe(false);
      expect(card.pet).toBeUndefined();
      expect(card.rumour).toBeUndefined();
      expect(card.knows_the_truth).toBeUndefined();
    }
  });

  it('an unconfessed minion is never marked; the demon reads as "the Demon" in combat', () => {
    const s = fresh(6);
    for (const p of s.towns[0]!.people) p.hasMet = true;
    const text = JSON.stringify(getView(s));
    expect(text).not.toContain('confessed_minion');
    expect(text).not.toContain('isMinion');
    expect(ENEMY_BY_ID.demon.name).toBe('Demon');
  });

  it('nothing GM-facing names the word that undoes the demon', () => {
    let s = fresh(2);
    const d = s.towns.flatMap((t) => t.people).find((x) => x.id === s.demonId)!;
    s.player.at = s.towns.find((t) => t.id === d.attributes.townId)!.nodeId;
    s.player.inside = 'town';
    s.player.maxHp = 10;
    s.player.hp = 10;
    s.player.bindings = ['a'];
    s = apply(s, { type: 'stab', person: d.id });
    const text = JSON.stringify([getLegalMoves(s), describeNextStep(s, 'p1'), SESSION_START_GUIDANCE, renderRules(DEMON_HUNTER_RULE_SECTIONS)]);
    expect(text.toLowerCase()).not.toMatch(/\blove\b/);
  });
});
