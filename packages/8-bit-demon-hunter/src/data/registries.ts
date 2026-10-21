// Name registries and townsfolk lines, from the original gameConfig. The game
// tips were reworded where they referred to keys or screens; the lore lines
// are verbatim. CLEARING_NAMES is new for the port: the original's clearings
// were unnamed open ground, but a text game needs each node addressable.

export const OCCUPATIONS = [
  'Carpenter',
  'Barber',
  'Soldier',
  'Musician',
  'Farmer',
  'Blacksmith',
  'Merchant',
  'Tailor',
  'Locksmith',
  'Mayor',
] as const;
export type Occupation = (typeof OCCUPATIONS)[number];

export const PETS = [
  'Dog', 'Cat', 'Fish', 'Bird', 'Snake', 'Lizard', 'Hamster', 'Rabbit',
  'Turtle', 'Ferret', 'Horse', 'Cow', 'Sheep', 'Pig', 'Chicken',
] as const;
export type Pet = (typeof PETS)[number];

export const COLORS = ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Pink'] as const;
export type Color = (typeof COLORS)[number];

export const ITEM_NAMES: readonly string[] = [
  'a Sword', 'a Shield', 'an Axe', 'a Bow', 'a Staff', 'a Potion', 'a Scroll', 'a Ring', 'a Helmet', 'Boots',
  'Gloves', 'Shoes', 'a Cloak', 'an Amulet', 'Bracers', 'Greaves', 'Gauntlets', 'a Hat', 'a Cape', 'a Robe',
  'a Spoon', 'a Fork', 'a Knife', 'a Mug', 'a Goblet', 'a Cup', 'a Plate', 'a Bowl', 'a Laddle', 'a Pan',
  'a Guitar', 'a Lute', 'a Flute', 'a Drum', 'a Trumpet', 'a Violin', 'a Cello', 'a Harp', 'a Piano', 'an Organ',
  'an Accordion', 'a Trombone', 'a Tuba', 'a French Horn', 'a Clarinet', 'an Oboe', 'a Bassoon', 'a Saxophone',
  'a Pen', 'a Book', 'a Key', 'a Map', 'a Compass', 'a Watch', 'a Clock', 'a Calendar', 'a Monicle', 'Glasses',
  'Candy', 'a Waterskin', 'a Pennyfarthing', 'a Thingamabob', 'a Whatchamacallit', 'a Plumbus',
];

export interface PersonName {
  name: string;
  gender: 'male' | 'female';
}

export const PERSON_NAMES: readonly PersonName[] = [
  { name: 'Zeke', gender: 'male' }, { name: 'Alexis', gender: 'female' }, { name: 'Lincoln', gender: 'male' },
  { name: 'Victoria', gender: 'female' }, { name: 'Lake', gender: 'male' }, { name: 'Jane', gender: 'female' },
  { name: 'Ren', gender: 'male' }, { name: 'Chris', gender: 'male' }, { name: 'Helen', gender: 'female' },
  { name: 'Ysenia', gender: 'female' }, { name: 'Drew', gender: 'male' }, { name: 'Sam', gender: 'male' },
  { name: 'Molly', gender: 'female' }, { name: 'Cailyn', gender: 'female' }, { name: 'Tiffany', gender: 'female' },
  { name: 'Felix', gender: 'male' }, { name: 'Warren', gender: 'male' }, { name: 'Gabriel', gender: 'male' },
  { name: 'Miguel', gender: 'male' }, { name: 'Fernanda', gender: 'female' }, { name: 'Claire', gender: 'female' },
  { name: 'Allan', gender: 'male' }, { name: 'Andres', gender: 'male' }, { name: 'Will', gender: 'male' },
  { name: 'Rebecca', gender: 'female' }, { name: 'Kaitlyn', gender: 'female' }, { name: 'Lisa', gender: 'female' },
  { name: 'Mik', gender: 'male' }, { name: 'Carola', gender: 'female' }, { name: 'Jamila', gender: 'female' },
  { name: 'Jeanette', gender: 'female' }, { name: 'Melissa', gender: 'female' }, { name: 'Vince', gender: 'male' },
  { name: 'Brooke', gender: 'female' }, { name: 'Trey', gender: 'male' }, { name: 'Korey', gender: 'male' },
  { name: 'Lauren', gender: 'male' }, { name: 'Mark', gender: 'male' }, { name: 'John', gender: 'male' },
  { name: 'Sarah', gender: 'female' }, { name: 'Jessica', gender: 'female' }, { name: 'Martin', gender: 'male' },
  { name: 'David', gender: 'male' }, { name: 'Michael', gender: 'male' }, { name: 'Daniel', gender: 'male' },
  { name: 'Ashley', gender: 'female' }, { name: 'Emily', gender: 'female' }, { name: 'Amanda', gender: 'female' },
  { name: 'Megan', gender: 'female' }, { name: 'Brittany', gender: 'female' }, { name: 'Joshua', gender: 'male' },
  { name: 'Noah', gender: 'male' }, { name: 'Asa', gender: 'male' }, { name: 'Zach', gender: 'male' },
  { name: 'Roberto', gender: 'male' }, { name: 'Aura', gender: 'female' }, { name: 'Lily', gender: 'female' },
  { name: 'Alice', gender: 'female' }, { name: 'Julia', gender: 'female' }, { name: 'Meg', gender: 'female' },
  { name: 'Tess', gender: 'female' }, { name: 'Sage', gender: 'female' }, { name: 'Angela', gender: 'female' },
  { name: 'Bridget', gender: 'female' }, { name: 'Jaime', gender: 'female' }, { name: 'Joan', gender: 'female' },
  { name: 'Anne', gender: 'female' }, { name: 'Jim', gender: 'male' }, { name: 'Derek', gender: 'male' },
  { name: 'Alec', gender: 'male' }, { name: 'Miles', gender: 'male' }, { name: 'Adam', gender: 'male' },
  { name: 'Oscar', gender: 'male' }, { name: 'Leo', gender: 'male' }, { name: 'Oz', gender: 'male' },
  { name: 'Robert', gender: 'male' }, { name: 'Adrian', gender: 'male' }, { name: 'Conor', gender: 'male' },
  { name: 'Phil', gender: 'male' }, { name: 'Dave', gender: 'male' }, { name: 'Larry', gender: 'male' },
  { name: 'Paul', gender: 'male' }, { name: 'Mike', gender: 'male' }, { name: 'Frank', gender: 'male' },
  { name: 'Raymond', gender: 'male' }, { name: 'Tony', gender: 'male' }, { name: 'Hassan', gender: 'male' },
  { name: 'Abdul', gender: 'male' }, { name: 'Jamal', gender: 'male' }, { name: 'Ahmed', gender: 'male' },
  { name: 'Mohamed', gender: 'male' }, { name: 'Sonal', gender: 'female' }, { name: 'Fatima', gender: 'female' },
  { name: 'Jalle', gender: 'female' },
];

export const TOWN_NAMES: readonly string[] = [
  'Himfergen', 'Walgon', 'Sheeford', 'Malpance', 'Placington', 'Townville', 'Cityberg', 'Villageton', 'Littleburg',
  'Smalltown', 'Bigton', 'Clockford', 'Someplaceville', 'Anyton', 'Locationberg', 'Farmford', 'Bakersburg', 'Smithton',
];

/** New for the port: names for the clearings between towns and temples. */
export const CLEARING_NAMES: readonly string[] = [
  'Mossy Hollow', 'The Old Crossroads', 'Bramble Flats', 'Foggy Meadow', 'Stonefield', 'Windy Rise',
  'The Burnt Glade', 'Cricket Bend', 'Heron Marsh', 'Lantern Heath', 'Thistle Downs', 'Ruin Row',
];

export const BINDING_NAMES: readonly string[] = [
  "Angel's Lock of Hair",
  "God's Breath",
  'Eye of the Cyclops',
  'Rune Engraved Marble',
  'Orb of Flesh',
  'The First Shuckle',
  "King's Goblet",
  'Basalisk Scale',
  'Dragon Blood',
  "Vampire's Fang",
];

/** Said by the starting town's people. Reworded from the original where a line
 *  referred to a key or screen (the clue book line). */
export const GAME_TIPS: readonly string[] = [
  "Someone told me the demon's minions possess special bindings that weaken it, if you weaken it enough it can be killed with one hit!",
  'I heard someone bought a bomb off a Lady Bandit!',
  'Different towns have different prices for resources. If I had more shuckles I would take advantage of that!',
  'Nice clue book you have there! Do you write down everything people tell you?',
  'Rocks can be blown up and sometimes you will find ore inside!',
  'The temples are dangerous, but legend has it there are powerful magic items inside',
  "Heal your wounds at the Inn. Only 5 shuckles, that's a bargin!",
  'The demon has minions everywhere! You might be one!',
  'I heard the demon can mimic my abilities making it harder to find!',
  "You're going out into the world? Watch out for the mushrooms!",
];

/** Said by everyone else, one line each, verbatim from the original. */
export const LORE_LINES: readonly string[] = [
  "The world didn't used to be filled with monsters. People say the demon summoned them here.",
  'There is an old story about a powerful wizard that made a deal with a demon to save his dying wife. I wonder if it is the same demon.',
  'Long ago there was a wizard named Memlax, over time he turned evil and ruled the world with an iron fist.',
  'A group of rebels built this town a long time ago. No idea what they were rebeling against.',
  'All the monsters showed up about the same time as rumors of the demon did. Just saying!',
  'The reason some of us can sense the demon is because we are descendants of Chineera. Once the bride of Memlax.',
  'The demon was defeated by Chineera and her followers once a long time ago. Surely one of her ancestors will do it again.',
  // Two casual lines on the demon's weakness (ruling 2026-10-21): the secret
  // way in the lair is discoverable in play, not only through the lore tool.
  'My gran swore the demon fears nothing in this world but love. She was a strange woman, my gran, but she was never wrong about much.',
  "There's a song the old folk sing at weddings about Chineera facing the demon with no sword at all, only her heart. Nobody remembers the second verse.",
  'The champions of Chineera were a rebel group. One of my ancestors was a member!',
  "My grandpa told me the demon was married to Chineera, but that doesn't make sense!",
  'The demon ruled this world a long time ago an has returned!',
  'Some say the evil wizard Memlax was posessed by a demon',
  'Watch yourself around those old ruins to the east. My grandfather said the same thing to my father, and his grandfather said it to him. Nobody remembers why anymore, but we keep saying it.',
  "You look like someone who's been around. You ever hear the name Memlax? Came up in an old book I found in the cellar. Gave me a funny feeling I can't explain.",
  "There was a great evil wizard and then there wasn't and then things were fine for a while and now apparently they aren't again. History, am I right?",
  "I don't know much about the old stories but I know my mother made me memorize the name Chineera before she died. Said it was important. Never told me why. You heard that name before?",
  "You want my advice? Free advice, no charge — if someone offers you a deal that seems too good to be true, you walk away. My gran said that's how the whole world almost ended once.",
  'There were five great magical artifacts forged to fight evil. My cousin says he found one at the bottom of a river. It was a boot.',
  "My boy keeps drawing the same symbol over and over and says he doesn't know where he learned it. Old woman down the road said it's the mark of the ancient rebellion. Kids are strange.",
  "There's an old story about a demon that got beaten by a woman. Or maybe she was a witch. Or a princess? Definitely a woman though. Pretty sure.",
  "Don't laugh, but my family's been keeping a list of names for generations. People who fought in some old rebellion. My father said to never let the names be forgotten. I don't even know who half of them were.",
  "There's five spots in this region where nothing grows. Not a blade of grass, not a weed. Been that way as long as anyone can remember. Some say that's where the magical weapons were forged. I say it's bad soil.",
  "Heard there were some magical doodads made a long, long time ago. Five of them? Maybe seven. Could've been two. Important ones, though.",
  'My gran used to say there was an evil wizard, or maybe it was a warlock, or honestly it might have been a very ambitious baker. The details are fuzzy.',
  "Careful who you trust out there. Old stories say the demon doesn't always show up as a monster. Sometimes it shows up as a very helpful stranger. Again, no offense.",
  "There's an old song my mother used to sing, something about a sorceress and a broken heart. I only remember bits of it now. Always made her cry at the end.",
  "People around here act like the old days are just stories. But stories come from somewhere, don't they? Someone lived through all that. Doesn't that bother you even a little?",
  "My husband says I worry too much. But I've been finding strange markings on the doorframes of empty houses around town. Someone's been making them. I don't know what they mean and that worries me.",
  'You know what nobody talks about? The deal. Everyone talks about the demon, everyone talks about the war. Nobody asks what the wizard actually gave up to save his wife. Must have been something awful.',
  "I had an uncle who was obsessed with the old rebellion. Spent his whole life researching it. Left behind thirty years of notes. My cousin used them to start a fire. I still haven't forgiven her.",
  'There are five old pedestals in the ruins outside town. Empty, all of them. My father said they used to hold something important. Never said what. Said it was better not to know.',
  'The old rebellion against the demon had a symbol — a broken chain, or maybe a flame. You still see it scratched into old walls if you know what to look for.',
  "The old stories say Memlax wasn't always evil, which I actually find more frightening than if he had been. Means it can happen to anyone, doesn't it?",
  "The demon is said to grow stronger the more people forget the old stories. So I'm doing my part by remembering, even if I'm remembering it wrong.",
  'My gran used to say Chineera won because the demon underestimated her. It thought love was a weakness. She proved it was the opposite. My gran was a smart woman.',
  'People in this town have short memories. But some of us remember that the last time things started feeling like this, it got very bad very quickly. Just saying.',
  "You want to know something funny? Half the children born in this town for the last hundred years have been named after people from the old rebellion. Nobody planned it. It just kept happening.",
  "I found an old journal in the wall of my house during renovations. Couldn't read most of it — old language. But one word kept appearing that my neighbor recognized. Means demon, apparently. Sold the house.",
  'You ever notice how the oldest buildings in town all have their doors facing the same direction? Away from the old ruins. Whoever built this town was afraid of something specific.',
  "I don't know you and you don't know me, but you've got that look about you. Like you're heading somewhere dangerous. Just — if you find one of those old artifacts, be careful with it. Last person who used one didn't come back. That's all I know.",
  'My grandmother used to say that Memlax was the kindest wizard who ever lived. Hard to believe, considering what he became.',
  "The tale my grandfather used to tell is that a demon poisoned the wizards wife, but I've met people who say she just got sick. Ah, well, they're just stories.",
  'The five magical items are still out there somewhere. Hidden, lost, or buried with their makers.',
  'They say Chineera loved her husband even after the demon took him. Must have been the hardest thing in the world, fighting someone you love.',
  "I once found an old coin with a woman's face on it. The merchant said it was minted by the rebellion. Sold it before I knew what I had.",
  "The demon doesn't die. That's the scary part. The sorceress didn't kill it — she just pushed it out. And now it's pushing back.",
];
