import { describe, it, expect } from 'vitest';
import { renderValue } from '@zekel/dev/harness/desyncBot';

// Taxonomy #7 (unfaithful utterance rendering): the human-sim must speak Intel
// cards the way a human would, as countable units. The original jargon joined an
// object's fields with ',' and array elements with ';', so a SINGLE-card report
// ("kind treat, treat chocolate_bar") read as TWO cards and desynced the report.
// The wording comes from Sweetlands' dev hooks, so the game is named.
describe('renderValue — Sweetlands Intel cards as human speech', () => {
  it('renders a single treat report as ONE comma-free unit', () => {
    const out = renderValue([{ kind: 'treat', treat: 'chocolate_bar' }], 'sweetlands-imperium');
    expect(out).toBe('a chocolate bar treat');
    expect(out).not.toContain(','); // no internal comma to miscount on
  });

  it('keeps each card a distinct unit in a multi-card report', () => {
    const out = renderValue([
      { kind: 'single', color: 'red' },
      { kind: 'double', color: 'blue' },
      { kind: 'treat', treat: 'gummy_bear' },
    ], 'sweetlands-imperium');
    expect(out).toBe('a red card; a double blue card; a gummy bear treat');
    expect(out.split(';')).toHaveLength(3); // exactly three countable cards
  });

  it('still renders non-card objects with the generic field rendering', () => {
    expect(renderValue([{ color: 'red', face: 'hit' }, { color: 'black', face: 'blank' }]))
      .toBe('color red, face hit; color black, face blank');
  });
});

describe('renderValue — game wording only applies to its own game', () => {
  it('another game, or no game, gets the generic wording for the same shape', () => {
    expect(renderValue([{ kind: 'treat', treat: 'chocolate_bar' }])).toBe('kind treat, treat chocolate_bar');
    expect(renderValue([{ kind: 'treat', treat: 'chocolate_bar' }], 'fractured-fist')).toBe('kind treat, treat chocolate_bar');
  });
});
