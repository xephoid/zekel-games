// Personas: the seeded character sheet every townsperson gets so the GM can
// voice them in free conversation (a TTRPG, not a video game). None of this is
// mechanical and none of it correlates with being the demon or a minion: it is
// drawn independently of the mystery, so it can never leak it.

import type { TaskType } from '../types.js';

export const TEMPERAMENTS: readonly string[] = [
  'warm and motherly', 'gruff but fair', 'nervous, easily startled', 'cheerful to a fault', 'bone-weary', 'suspicious of strangers',
  'pompous and proud of it', 'dreamy and distracted', 'blunt as a hammer', 'an incurable gossip', 'quietly pious', 'sly, always angling for something',
  'kind but forgetful', 'stern, few words', 'curious about everything', 'melancholy, lost in the past',
];

export const MANNERS: readonly string[] = [
  'speaks in short, clipped sentences', 'rambles and circles back', 'answers every question with a question', 'quotes their grandmother constantly',
  'laughs at their own jokes', 'drops to a whisper for anything important', 'will not meet your eye', 'over-explains the obvious',
  'talks in the metaphors of their trade', 'counts things off on their fingers', 'addresses you as "friend" or "stranger" by turns', 'hums between sentences',
];

export const QUIRKS: readonly string[] = [
  'keeps glancing at the door', 'fusses over their pet the whole time', 'mends or sharpens something while talking', 'collects rumours the way others collect coins',
  'gets names slightly wrong', 'is always eating something', 'keeps a little list of everything', 'is afraid of the dark and says so',
  'wants to leave this town and never will', 'never sits down', 'smells faintly of smoke', 'touches the doorframe for luck',
  'has a scar they will not explain', 'knows everyone\'s business but pretends not to', 'is new in town and still learning names', 'wears their best clothes every day',
];

/** Something on their mind besides the demon, for colour. */
export const WORRIES: readonly string[] = [
  'the harvest will fail again', 'their eldest wants to go adventuring', 'the inn is overcharging', 'the well tastes strange this year',
  'nobody visits since the monsters came', 'a debt they cannot pay', 'their roof will not last the winter', 'the mayor is hiding something',
  'the road to the next town is unsafe', 'they have not slept well in weeks', 'their pet has gone off its food', 'the old stories are coming true',
];

/** Why they need their task done, by task type. {target} = the printed target. */
export const TASK_REASONS: Readonly<Record<TaskType, readonly string[]>> = {
  KILL: [
    'the {target} have been getting at the livestock',
    'the {target} block the path they take every week',
    'the {target} frightened their children half to death',
    'a {target} chased them home last month and they want it paid back',
    'they cannot sleep for the {target} rustling outside at night',
  ],
  FIND_PERSON: [
    'that person owes them money and has gone quiet',
    'they have a letter for that person and no way to deliver it',
    'that person is an old friend they lost touch with',
    'they need that person\'s help and are too proud to ask themselves',
    'they heard that person has news of a relative',
  ],
  ESCORT: [
    'they have family there they have not seen in years',
    'they have goods to sell there and the road is too dangerous alone',
    'there is a wedding there they cannot miss',
    'they want to see the place before they are too old to travel',
    'they are not safe here any more and will not say why',
  ],
  FIND_ITEM: [
    'their grandmother swore it was the only thing that could save this land',
    'they want proof the old stories are true before they die',
    'a scholar once promised them a fortune for word of it',
    'they dreamed of it three nights running and cannot let it go',
  ],
};

export interface Persona {
  temperament: string;
  manner: string;
  quirk: string;
  worry: string;
  /** Why their task matters to them, filled in with the target. */
  taskReason: string;
  /** Lore topic ids this person can speak to with some authority. */
  loreHooks: string[];
}

/** Which lore topics a tip or lore line touches (for the person's hooks). */
export function loreHooksFor(tip: string, occupation: string): string[] {
  const hooks = new Set<string>();
  const t = tip.toLowerCase();
  if (/memlax|chineera|wizard|sorceress|bride|wife|deal|bargain|song/.test(t)) hooks.add('memlax-and-chineera');
  if (/rebel|rebellion|symbol|names|coin|ruins|pedestal|doors facing/.test(t)) hooks.add('the-rebellion');
  if (/artifact|boot|doodad|weapons were forged|nothing grows|magical items|pedestals|temples/.test(t)) hooks.add('the-five-artifacts');
  if (/demon|monster|minion|binding/.test(t)) hooks.add('the-demon');
  if (/inn|shuckle|price|bomb|bandit|rock|ore|mushroom|clue book/.test(t)) hooks.add('the-towns');
  if (hooks.size === 0) hooks.add('the-towns');
  if (occupation === 'Soldier' || occupation === 'Farmer') hooks.add('monsters');
  if (occupation === 'Locksmith' || occupation === 'Carpenter') hooks.add('minions-and-bindings');
  if (occupation === 'Mayor' || occupation === 'Merchant') hooks.add('the-towns');
  return Array.from(hooks);
}
