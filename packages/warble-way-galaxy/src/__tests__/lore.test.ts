import { describe, expect, it } from 'vitest';
import { loadLoreTopics, resolveLoreTopic } from '../lore.js';

describe('Warble Way Galaxy lore repository', () => {
  const topics = loadLoreTopics();

  it('loads every lore file with valid frontmatter and a non-empty body', () => {
    expect(topics.length).toBeGreaterThanOrEqual(5);
    for (const t of topics) {
      expect(t.topic_id).toMatch(/^[a-z0-9-]+$/);
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.summary.length).toBeGreaterThan(0);
      expect(t.body.length).toBeGreaterThan(0);
      // Frontmatter must not leak into the body.
      expect(t.body).not.toContain('---\n');
      expect(t.body).not.toMatch(/^title:/m);
    }
  });

  it('topic ids are unique', () => {
    const ids = topics.map((t) => t.topic_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resolves topics case/spacing/punctuation-tolerantly by id and by title', () => {
    expect(resolveLoreTopic(topics, 'xaxalon-4')?.topic_id).toBe('xaxalon-4');
    expect(resolveLoreTopic(topics, 'Xaxalon 4')?.topic_id).toBe('xaxalon-4');
    expect(resolveLoreTopic(topics, 'XAXALON4')?.topic_id).toBe('xaxalon-4');
    expect(resolveLoreTopic(topics, 'The Ancient Ruins')?.topic_id).toBe('ancient-ruins');
    expect(resolveLoreTopic(topics, 'grull')?.title).toBe('Grull');
  });

  it('returns null (not a guess) for an unknown topic', () => {
    expect(resolveLoreTopic(topics, 'the-thief')).toBeNull();
  });

  it('covers the core canon: all four races, the galaxy, factions, and the ruins', () => {
    const ids = new Set(topics.map((t) => t.topic_id));
    for (const required of [
      'galaxy-overview',
      'humans',
      'kralkin',
      'hexapods',
      'grull',
      'factions',
      'ancient-ruins',
    ]) {
      expect(ids.has(required), `missing lore topic ${required}`).toBe(true);
    }
  });
});
