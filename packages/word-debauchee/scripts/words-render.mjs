// Turns rules/words.csv into src/data/words.ts (the deck the server deals
// from) and rules/words.md (the same cards for people to read). Pure
// functions over the CSV text, so a test can check the generated files are
// fresh; build-words.mjs does the file I/O.

const COLUMNS = ['word', 'letters', 'vowels', 'consonants', 'syllables', 'type', 'category', 'grade', 'synonyms'];
const JUDGMENT = ['opposite', 'goes_with', 'rhymes_with', 'register'];
const VOWELS = 'AEIOU';

export function parseWordsCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() !== '');
  const header = lines[0].split(',');
  for (const c of [...COLUMNS, ...JUDGMENT]) {
    if (!header.includes(c)) throw new Error(`words.csv: missing column "${c}"`);
  }
  return lines.slice(1).map((line, i) => {
    const cells = line.split(',');
    if (cells.length !== header.length) throw new Error(`words.csv row ${i + 2}: ${cells.length} cells, expected ${header.length}`);
    const row = Object.fromEntries(header.map((h, j) => [h, cells[j].trim()]));
    const word = row.word.toUpperCase();
    const vowels = [...word].filter((ch) => VOWELS.includes(ch)).length;
    return {
      word,
      letters: word.length,
      vowels,
      consonants: word.length - vowels,
      // The CSV's own counts, kept so the data test can report drift.
      csvLetters: Number(row.letters),
      csvVowels: Number(row.vowels),
      csvConsonants: Number(row.consonants),
      syllables: Number(row.syllables),
      type: row.type,
      category: row.category,
      grade: Number(row.grade),
      synonyms: row.synonyms.split(/\s+/).filter(Boolean).map((s) => s.toLowerCase()),
      opposite: row.opposite === 'none' ? null : row.opposite.toLowerCase(),
      goesWith: row.goes_with.toLowerCase(),
      rhymesWith: row.rhymes_with === 'nothing' ? null : row.rhymes_with.toLowerCase(),
      register: row.register.toLowerCase(),
    };
  });
}

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const qn = (s) => (s === null ? 'null' : q(s));

export function renderWordsTs(csvText) {
  const cards = parseWordsCsv(csvText);
  const out = [
    '// Generated from rules/words.csv by scripts/build-words.mjs. Do not edit:',
    '// change the CSV and run `pnpm --filter @zekel/word-debauchee build:words`.',
    '',
    "import type { WordCard } from './wordCard.js';",
    '',
    'export const WORDS: readonly WordCard[] = [',
  ];
  for (const c of cards) {
    out.push(
      `  { word: ${q(c.word)}, letters: ${c.letters}, vowels: ${c.vowels}, consonants: ${c.consonants}, syllables: ${c.syllables}, ` +
        `type: ${q(c.type)}, category: ${q(c.category)}, grade: ${c.grade}, ` +
        `synonyms: [${c.synonyms.map(q).join(', ')}], ` +
        `opposite: ${qn(c.opposite)}, goesWith: ${q(c.goesWith)}, rhymesWith: ${qn(c.rhymesWith)}, register: ${q(c.register)} },`,
    );
  }
  out.push('];', '');
  return out.join('\n');
}

const CATEGORY_ORDER = ['Feelings', 'Actions', 'People', 'Places', 'Things', 'Nature', 'Body', 'Food', 'Size & Amount', 'Time', 'Speech', 'Qualities'];
const TYPE_ORDER = ['Noun', 'Verb', 'Adjective', 'Adverb'];

function countTable(keys, count) {
  return [`| ${keys.join(' | ')} |`, `|${keys.map(() => '---').join('|')}|`, `| ${keys.map((k) => count(k)).join(' | ')} |`].join('\n');
}

export function renderWordsMd(csvText) {
  const cards = parseWordsCsv(csvText);
  const by = (f) => (k) => cards.filter((c) => f(c) === k).length;
  const grades = [...new Set(cards.map((c) => c.grade))].sort((a, b) => a - b);
  const lengths = [...new Set(cards.map((c) => c.letters))].sort((a, b) => a - b);
  const sorted = [...cards].sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
      a.grade - b.grade ||
      a.word.localeCompare(b.word),
  );
  const lines = [
    '# Word Debauchee — word cards',
    '',
    `${cards.length} words with their facts and synonym lists, generated from [words.csv](words.csv) (edit the CSV, not this file). ` +
      'Counts are computed: A, E, I, O and U are vowels, Y is a consonant. Type, category, grade (US school grade the word is usually taught in), ' +
      'syllables, synonyms and the four judgment-clue answers (opposite, goes with, rhymes with, register) are hand-assigned, so treat them as a first pass to check at the table. ' +
      'Synonyms are single words of 3 to 10 letters, never containing the headword.',
    '',
    '## Spread',
    '',
    'By category',
    '',
    countTable(CATEGORY_ORDER, by((c) => c.category)),
    '',
    'By type',
    '',
    countTable(TYPE_ORDER, by((c) => c.type)),
    '',
    'By grade',
    '',
    countTable(grades, by((c) => c.grade)),
    '',
    'By letters',
    '',
    countTable(lengths, by((c) => c.letters)),
    '',
    '## Cards',
    '',
    'Sorted by category, then grade, then word.',
    '',
    '| Word | L | V | C | Syl | Type | Category | Grade | Synonyms | Opposite | Goes with | Rhymes with | Register |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const c of sorted) {
    lines.push(
      `| ${c.word} | ${c.letters} | ${c.vowels} | ${c.consonants} | ${c.syllables} | ${c.type} | ${c.category} | ${c.grade} | ${c.synonyms.join(', ')} | ` +
        `${c.opposite ?? '—'} | ${c.goesWith} | ${c.rhymesWith ?? 'nothing rhymes'} | ${c.register} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
