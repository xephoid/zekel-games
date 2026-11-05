// The engine's sentences are written for a game master holding the
// rulebook: they cite the rule ("WR §12", "amendment A10", "ruling #9") and
// name the move to send next ("attempt_escape", "equip_item"). A player at a
// digital table reads the same sentences on a screen, where a citation is
// noise and a move id is not a word. This takes both out and changes nothing
// else: every number, name and outcome stays exactly as the engine said it.

const CITE = String.raw`(?:WR\s*§+\s*[\d–-]+(?:\s*[–-]\s*§?\d+)?|amendments?\s+A\d+\w*|rulings?\s+#\d+|clarification\s+#\d+|A\d{1,2}[a-z]?|PORT-NOTES|POST-PORT\s*§\d+)`;
const CITE_ONLY = new RegExp(String.raw`^${CITE}(?:\s*/\s*${CITE})*$`, 'i');

/** What a move id is called when a sentence names it. */
const MOVE_WORDS: Record<string, string> = {
  attempt_escape: 'run',
  attempt_hack: 'hack them',
  open_fire: 'an opening volley',
  attempt_intimidate: 'threaten them',
  fight_round: 'exchange fire',
  attempt_evade: 'run silent',
  decline_evade: 'engage',
  use_reroll: 'roll again',
  accept_result: 'take the hit',
  sacrifice_unnamed: 'spend a red shirt',
  decline_sacrifice: 'let it land',
  equip_item: 'the equip action',
  release_crew: 'releasing someone',
  accept_mission: 'accept',
  decline_mission: 'decline',
  decline_recruit: 'fly on',
  enter_ruin: 'enter',
  skip_ruin: 'pass it by',
  depart_for_next_habitat: 'departing',
  setup_encounter: 'the setup',
  report_res_discard: 'discard one',
  skip_res_peek: 'skip the look',
  resolve_report: 'the button',
};

/** Drop the citations inside one pair of brackets; null when nothing is left. */
function cleanBrackets(inner: string): string | null {
  const kept = inner
    .split(/\s*[;,]\s*|\s+—\s+/)
    .map((part) => part.trim())
    .filter((part) => part !== '' && !CITE_ONLY.test(part))
    .map((part) => part.replace(new RegExp(String.raw`\s*[—-]\s*${CITE}$`, 'i'), '').replace(new RegExp(String.raw`^${CITE}\s*[:—-]\s*`, 'i'), ''));
  return kept.length === 0 ? null : kept.join(', ');
}

/** A sentence of the engine's with its rule citations and move ids taken out. */
export function plainWords(text: string): string {
  let out = text.replace(/\(([^()]*)\)/g, (whole, inner: string) => {
    if (!new RegExp(CITE, 'i').test(inner)) return whole;
    const cleaned = cleanBrackets(inner);
    return cleaned === null ? '' : `(${cleaned})`;
  });
  // A citation left bare in running text: "…, amendment A7." or "— ruling #9".
  out = out.replace(new RegExp(String.raw`\s*[,;—-]\s*(?:amendments?\s+A\d+\w*|rulings?\s+#\d+|WR\s*§+\s*[\d–-]+)(?=[\s.,;:)]|$)`, 'gi'), '');
  out = out.replace(/\b[a-z]+(?:_[a-z]+)+\b/g, (id) => MOVE_WORDS[id] ?? id.replace(/_/g, ' '));
  // A seat that presses Roll or Draw has nothing to report.
  out = out.replace(/\s+and report the dice/g, '').replace(/\s+—\s+report the discarded card/g, '');
  // A template's instruction to the game master becomes the player's own choice.
  out = out.replace(/\s*—\s*FILL IN the destination cell like "r5c3";\s*/g, ': choose a square; ');
  out = out.replace(/FILL IN the player's choices:/g, 'you choose:');
  return out.replace(/\s+([.,;:])/g, '$1').replace(/\(\s*\)/g, '').replace(/ {2,}/g, ' ').trim();
}
