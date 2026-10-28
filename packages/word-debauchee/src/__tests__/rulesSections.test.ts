import { describe, expect, it } from 'vitest';
import { MOVE_TYPES } from '../engine/moves.js';
import { renderRules, WORD_DEBAUCHEE_RULE_SECTIONS } from '../rulesSections.js';

describe('rules sections', () => {
  it('tag every move type to at least one section', () => {
    const tagged = new Set(WORD_DEBAUCHEE_RULE_SECTIONS.flatMap((s) => s.tags.move_types ?? []));
    for (const t of MOVE_TYPES) expect(tagged.has(t), t).toBe(true);
  });

  it('have unique ids and real prose', () => {
    const ids = WORD_DEBAUCHEE_RULE_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of WORD_DEBAUCHEE_RULE_SECTIONS) expect(s.text.length, s.id).toBeGreaterThan(60);
  });

  it('render the scoring example and the tile counts', () => {
    const text = renderRules();
    expect(text).toContain('cracked with GLAD after four reveals pays 1');
    expect(text).toContain('E 18');
    expect(text).toContain('Shortest synonym (1)');
  });
});
