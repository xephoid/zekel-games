// The 25 people's portraits (docs/games/cybernoir-2127-theme-build.md, item
// 4): face crops of the owner's DreamShaper 8 portraits, credited in
// ATTRIBUTIONS.md, served from /art/cybernoir/ under the engine's person ids.
// `<id>.jpg` is square, `<id>-tall.jpg` is 3:4. The crops are plain; the
// camera-grab look (blur, drained colour, green cast, scanlines) is the
// theme's, applied when drawn (cn.css).
//
// The engine's reference data names people by their printed name, and its
// ids are those names in snake case ("Gus the Noodle Guy" is
// gus_the_noodle_guy). A name with no portrait here gets none, rather than a
// guess.

const FACES = new Set([
  'eddie_the_doorman', 'marisol_the_janitor', 'gus_the_noodle_guy', 'dot_the_birdwatcher', 'felix_the_concierge',
  'ma_kettle', 'zero_kelvin', 'permafrost', 'blackice', 'sleet', 'frostbyte', 'hoarfrost', 'mother_carmine', 'rust',
  'little_garnet', 'manticore', 'basilisk', 'wyrm', 'deckard_voss', 'priya_nakamura_smith', 'bradford_chase_xvi',
  'kenji_watanabe', 'yumi_sato', 'hana_mori', 'anansi_the_spider',
]);

/** Each faction's mark (column A of Logos.dc.html), and the Witnesses' eye. */
const MARKS = new Set(['corp_1', 'corp_2', 'gang_1', 'gang_2', 'gang_3', 'witness']);

export function markUrl(key: string): string | undefined {
  return MARKS.has(key) ? `/art/cybernoir/logos/${key}.svg` : undefined;
}

export function faceUrl(name: string, shape: 'square' | 'tall' = 'tall'): string | undefined {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (!FACES.has(id)) return undefined;
  return `/art/cybernoir/${id}${shape === 'tall' ? '-tall' : ''}.jpg`;
}
