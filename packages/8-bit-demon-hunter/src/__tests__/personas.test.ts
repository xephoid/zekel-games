import { describe, expect, it } from 'vitest';
import { loadLoreTopics } from '../lore.js';
import { SESSION_START_GUIDANCE } from '../guidance.js';
import { applyText, fresh } from './support.js';

// Conversations are played, not read: every person carries a persona for the
// GM, the talk response carries a GM brief, and the lore covers what the
// persona points at.

describe('personas and the GM brief', () => {
  it('gives everyone a persona with a task reason and lore hooks that exist', () => {
    const topics = new Set(loadLoreTopics().map((t) => t.topic_id));
    for (let seed = 1; seed <= 20; seed++) {
      const s = fresh(seed);
      for (const p of s.towns.flatMap((t) => t.people)) {
        for (const k of ['temperament', 'manner', 'quirk', 'worry', 'taskReason'] as const) expect(p.persona[k].length, `${p.id} ${k}`).toBeGreaterThan(3);
        expect(p.persona.taskReason).not.toContain('{target}');
        expect(p.persona.loreHooks.length).toBeGreaterThan(0);
        for (const h of p.persona.loreHooks) expect(topics.has(h), `lore topic ${h}`).toBe(true);
      }
    }
  });

  it('personas are deterministic per seed and vary across people', () => {
    const a = fresh(3);
    const b = fresh(3);
    expect(a.towns[0]!.people.map((p) => p.persona)).toEqual(b.towns[0]!.people.map((p) => p.persona));
    const temperaments = new Set(a.towns.flatMap((t) => t.people).map((p) => p.persona.temperament));
    expect(temperaments.size).toBeGreaterThan(5);
  });

  it('talking yields a GM brief with the facts, the story, the reason and the rumour, marked not to be read out', () => {
    const s = fresh(2);
    const p = s.towns[0]!.people[0]!;
    const r = applyText(s, { type: 'talk', person: p.id });
    expect(r.summary).toContain('GM BRIEF');
    expect(r.summary).toContain('do not read it out');
    expect(r.summary).toContain(p.persona.temperament);
    expect(r.summary).toContain(p.tip);
    expect(r.summary).toContain(p.persona.taskReason);
    expect(r.summary).toContain(p.clues.bad?.text ?? 'I know the truth!');
    expect(r.summary).toContain('Gist:');
  });

  it('the guidance tells the GM to play conversations, and the GM topics exist', () => {
    expect(SESSION_START_GUIDANCE).toContain('CONVERSATIONS ARE PLAYED, NOT READ');
    const ids = loadLoreTopics().map((t) => t.topic_id);
    for (const id of ['running-a-conversation', 'what-nobody-knows', 'the-temples', 'monsters', 'minions-and-bindings', 'the-clearings', 'the-towns']) expect(ids).toContain(id);
    expect(ids.length).toBeGreaterThanOrEqual(11);
  });
});
