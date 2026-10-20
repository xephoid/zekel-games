import { describe, it, expect } from 'vitest';
import { cybernoir2127 } from '../index.js';
import { CYBERNOIR_RULE_SECTIONS } from '../rulesSections.js';
import { renderRulesText, duplicateSectionIds, validateSectionCoverage } from '@zekel/game-kit';
import { LOCATIONS } from '../data/index.js';

// Lock for the v2.3 sectioned rules (integration gate finding D: the server
// carried no rules text, so assistants invented answers). The standard
// rules-teaching lock: coverage of every runtime move type, no duplicate ids,
// and the blob derives from the sections.

function schemaMoveTypes(): string[] {
  const oneOf = (cybernoir2127.moveSchema as { oneOf: Array<Record<string, unknown>> }).oneOf;
  return oneOf.map((m) => {
    const props = m.properties as { type: { const: string } };
    return props.type.const;
  });
}

describe('Cybernoir 2127 sectioned rules', () => {
  it('every runtime move type is governed by at least one section', () => {
    expect(validateSectionCoverage(CYBERNOIR_RULE_SECTIONS, schemaMoveTypes())).toEqual([]);
  });

  it('section ids are unique', () => {
    expect(duplicateSectionIds(CYBERNOIR_RULE_SECTIONS)).toEqual([]);
  });

  it('getRulesText derives from the sections (one source of truth)', () => {
    expect(cybernoir2127.getRulesText!()).toBe(renderRulesText(CYBERNOIR_RULE_SECTIONS));
    expect(cybernoir2127.getRulesSections!()).toBe(CYBERNOIR_RULE_SECTIONS);
  });

  it('carries the rules the integration runs saw invented: evidence is free, complete trios, jailed contacts drawable', () => {
    const text = cybernoir2127.getRulesText!();
    expect(text).toContain('All Evidence plays are FREE');
    expect(text).toContain('COMPLETE TRIO');
    expect(text).toContain('their Contact card remains');
    // Counts are computed, never stale literals (finding A's lesson).
    expect(text).toContain(`${LOCATIONS.length} locations`);
    expect(text).not.toContain('18 locations');
  });
});
