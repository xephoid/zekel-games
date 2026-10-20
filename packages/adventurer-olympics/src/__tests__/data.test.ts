// Transcription lock: data.ts against the pinned rules text (RULES.md §2, §10,
// §11), read from the file itself — never against data.ts's own belief. The
// earlier post-port record claimed this test existed; it did not.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BIG_MONSTER_NUMBERS, COMPANION_CARDS, DUNGEON_COMPOSITION, DUNGEON_KIND_NAMES, LITTLE_MONSTER_NUMBERS,
  QUESTS, STARTING_STATS, TILES,
} from '../data.js';

const RULES = readFileSync(fileURLToPath(new URL('../../RULES.md', import.meta.url)), 'utf-8').replace(/\r/g, '');
const section = (start: string, end: string): string => RULES.slice(RULES.indexOf(start), RULES.indexOf(end, RULES.indexOf(start) + start.length));

describe('data.ts matches the rulebook', () => {
  it('companion cards: number and bonus, row by row (§10)', () => {
    const rows = [...section('### Companion cards (16)', '### Little Monster').matchAll(/^\| (\d+) \| (\d+) \| (.+?) \|$/gm)];
    expect(rows).toHaveLength(16);
    for (const [, idx, num, bonus] of rows) {
      const card = COMPANION_CARDS[Number(idx) - 1]!;
      expect(card.number, `companion ${idx}`).toBe(Number(num));
      const want: Record<string, number> = {};
      for (const [, n, statName] of bonus!.matchAll(/\+(\d+) (\w+)/g)) want[statName!.toLowerCase()] = Number(n);
      expect(card.bonus, `companion ${idx}`).toEqual(want);
    }
  });

  it('monster numbers (§10)', () => {
    const nums = (heading: string) => section(heading, '###').match(/Numbers to beat: ([\d, ]+)/)![1]!.split(',').map((x) => Number(x.trim()));
    expect(LITTLE_MONSTER_NUMBERS).toEqual(nums('### Little Monster cards (12)'));
    expect(BIG_MONSTER_NUMBERS).toEqual(nums('### Big Monster cards (12)'));
  });

  it('dungeon card counts (§10)', () => {
    const rows = [...section('### Dungeon cards (24)', '### Artifact cards').matchAll(/^\| (.+?) \| (\d+) \|$/gm)];
    const printed = Object.fromEntries(rows.map(([, name, n]) => [name, Number(n)]));
    const ours = Object.fromEntries(Object.entries(DUNGEON_COMPOSITION).map(([k, n]) => [DUNGEON_KIND_NAMES[k as keyof typeof DUNGEON_KIND_NAMES], n]));
    expect(ours).toEqual(printed);
    expect(Object.values(DUNGEON_COMPOSITION).reduce((a, b) => a + b, 0)).toBe(24);
  });

  it('map tile icons (§11)', () => {
    const rows = [...section('## 11. Map tiles', 'Changes from the PDF').matchAll(/^\| (\d+) \| (.+?) \|$/gm)];
    expect(rows).toHaveLength(10);
    const nameOf: Record<string, string> = {
      City: 'city', Dungeon: 'dungeon', 'Little Monster': 'little_monster', 'Big Monster': 'big_monster',
      Clubs: 'clubs', Hearts: 'hearts', Diamonds: 'diamonds', Spades: 'spades', '**Star**': 'star',
    };
    for (const [, id, cell] of rows) {
      const icons = Object.fromEntries(cell!.split(' · ').map((part) => {
        const [hex, what] = part.split(': ');
        return [hex!.trim(), nameOf[what!.trim()]];
      }));
      expect(TILES.find((t) => t.id === Number(id))!.icons, `Tile ${id}`).toEqual(icons);
    }
  });

  it('quest cards and starting stats (§2, §10)', () => {
    const printed = [...section('### Quest cards (6)', '### Companion').matchAll(/^\d\. (.+?)(?: — end of game)?$/gm)].map((m) => m[1]);
    expect(QUESTS.map((q) => q.name)).toEqual(printed);
    expect(QUESTS.filter((q) => q.endGame).map((q) => q.name)).toEqual(['Most dungeons', 'Most companions', 'Most Little Monsters', 'Most Big Monsters', 'Most artifacts']);
    expect(STARTING_STATS).toEqual({ charisma: 1, strength: 1, movement: 2 });
    expect(RULES).toContain('- **Charisma 1**\n- **Strength 1**\n- **Movement 2**');
  });
});
