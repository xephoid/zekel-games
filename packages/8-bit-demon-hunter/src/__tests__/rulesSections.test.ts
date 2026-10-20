import { describe, expect, it } from 'vitest';
import { MOVE_TYPES } from '../engine/moves.js';
import { RULES_TEXT } from '../guidance.js';
import { DEMON_HUNTER_RULE_SECTIONS, renderRules } from '../rulesSections.js';

// Post-port §7a: rules text served, sectioned; every move type tagged to at
// least one section; no duplicate ids; the blob derives from the sections.

describe('rules sections', () => {
  it('has unique ids and non-empty text', () => {
    const ids = DEMON_HUNTER_RULE_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of DEMON_HUNTER_RULE_SECTIONS) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.text.length).toBeGreaterThan(40);
      expect(s.id).toMatch(/^[a-z-]+$/);
    }
  });

  it('tags every move type to at least one section, and tags no unknown move type', () => {
    const tagged = new Set(DEMON_HUNTER_RULE_SECTIONS.flatMap((s) => s.tags.move_types ?? []));
    for (const t of MOVE_TYPES) expect(tagged.has(t), `move type ${t} is taught somewhere`).toBe(true);
    for (const t of tagged) expect(MOVE_TYPES as readonly string[], `tag ${t} names a real move`).toContain(t);
  });

  it('derives the get_rules blob from the sections', () => {
    expect(RULES_TEXT).toBe(renderRules(DEMON_HUNTER_RULE_SECTIONS));
    for (const s of DEMON_HUNTER_RULE_SECTIONS) expect(RULES_TEXT).toContain(s.text);
  });
});
