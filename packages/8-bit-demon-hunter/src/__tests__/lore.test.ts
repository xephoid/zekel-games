import { describe, expect, it } from 'vitest';
import { loadLoreTopics, loreIndex, loreTopic } from '../lore.js';
import { RULES_TEXT, SESSION_START_GUIDANCE } from '../guidance.js';

describe('lore and guidance', () => {
  it('loads at least five topics with titles, summaries and bodies', () => {
    const topics = loadLoreTopics();
    expect(topics.length).toBeGreaterThanOrEqual(5);
    for (const t of topics) {
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.summary.length).toBeGreaterThan(0);
      expect(t.body.length).toBeGreaterThan(50);
    }
    expect(loreIndex(topics).topics.map((t) => t.topic_id)).toContain('memlax-and-chineera');
    expect(loreTopic(topics, 'the-demon')?.title).toBe('The Demon');
    expect(loreTopic(topics, 'nope')).toBeNull();
  });

  it('the guidance forbids hints and the rules cover the main systems', () => {
    expect(SESSION_START_GUIDANCE).toMatch(/NEVER GIVE HINTS/);
    expect(SESSION_START_GUIDANCE).toMatch(/get_demon_hunter_lore/);
    for (const word of ['Winged Boots', 'Aura of Protection', 'Cape of Teleportation', 'Eye of Truth', 'Fire Bombs', 'binding', 'gauntlet', 'riddle', 'Lady Bandit', 'arena']) {
      expect(RULES_TEXT).toContain(word);
    }
  });
});
