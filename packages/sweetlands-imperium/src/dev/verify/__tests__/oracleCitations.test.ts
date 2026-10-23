import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { quoteAppearsVerbatim } from '@zekel/dev/verify/lint';
import { SWEETLANDS_ORACLE_RULES } from '../rules.js';

const rulesText = readFileSync(fileURLToPath(new URL('../rules-freeze.txt', import.meta.url)), 'utf-8');

describe('sweetlands oracle rule citations', () => {
  it('every rule id is unique', () => {
    const ids = SWEETLANDS_ORACLE_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const rule of SWEETLANDS_ORACLE_RULES) {
    it(`[${rule.id}] cites the rules freeze verbatim`, () => {
      expect(
        quoteAppearsVerbatim(rule.citation.quote, rulesText),
        `quote not found: "${rule.citation.quote}"`,
      ).toBe(true);
    });
  }
});
