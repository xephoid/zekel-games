8-bit demon hunter MCP variant

World represented as a bidirectional graph
Nodes:
Town
Clearing
Temple
Enemy
Resource

Generating a world works similar to the original game except instead of carving out circles on a large grid it builds a random graph. The major nodes are Towns, Clearings and Temples which are connected to each other. Rules for major node connections. Towns and Temples only have one connection. Towns can only be connected to other Towns or Clearings. Temples are only connected to Clearings. Clearings can have up to 3 connections and can connect to anything.
Smaller nodes are enemies and resources. They represent enemies and resources in the immediate vicinity of the major node. Enemy and resource distributions remain the same as the original game. They only ever connect to major nodes and only have one connection. Some enemies can move from one major node to another.

Throughout the game the player can choose to move between nodes to achieve their goals as they would in the original game. They can always “look” to see what is around them.

Interior Towns:
This is where the player may speak to townsfolk, visit the inn and possibly unlock minion houses. Just like the original game.

Enemies:
There are passive enemies and aggressive enemies. Passive Enemies can easily be avoided and will not pursue the player at all (slime, snakes, wizards). Aggressive enemies will attack or give chase when the player leaves their node (mushrooms, bandits, skeletons, undead knight). Keep their stats from the original game. New stat Range is added for some.

Enemy behaviors:
Slime - Passive. Fights if attacked.
Snake - Passive. 50% chance to run away if damaged, but not dead
Mushroom - Aggressive. When the player leaves their node they follow. When there are 5 or more on a node they will attack the player when he/she tries to leave the node.
Bandits - Aggressive. Attack the player if he/she tries to leave their node. The player can speak to a lady bandit to buy bombs if she hasn’t been attacked.
Wizard - Passive. Range 3. Runs away when attacked. 50% chance to teleport to another node when it runs away. Only spawns in clearings.
Skeleton - Aggressive. Range 4. Fights when attacked. Only spawns in clearings
Undead Knight - Aggressive. Fights when attacked. Only spawns in clearings.

Temple Interior
There is no maze like in the original game. Instead there are two ways to complete a temple. Fight through a gauntlet of the temple enemy (one at a time) similar to the original. Or solve a lore-accurate riddle. TODO: come up with riddles.TODO: may need to rebalance so it is doable.

Sky Temple is special and has a ring of stone wall surrounding it so the player must get a bomb and blow a hole in it.

Magic Items
Items you get when you complete a temple.
Winged Boots - Allows you to fly over enemies avoiding fights, except aggressive ranged enemies can still attack you. You can attack enemies while flying, but only if your range is 3 or more. They can’t attack you back unless they have range 3+
Protection Aura - Allows you to become invulnerable, however  you cannot attack in this state
Teleportation Cape - Can teleport to any town the player has been to at will
Eye of Truth - You can tell when an NPC is lying
Fire Bombs - Unlimited bombs

Resources:
Plant fiber and wood can be collected by attacking it, but there is a 10% chance you will attract a nearby aggressive enemy if there are any. Ore deposits must be blown up with bombs and adhere to drop chances from the original game.

Player stats work  mostly the same as the original:
Strength - How much damage the player does when they hit. Starts at 1
Agility - In what order does the player attack in combat. Also, helps with running away. Starts at 1
Range - Higher range means the player gets one free attack at the beginning of combat. Starts at 1
Health - How many times can the player be hit before dying. Starts at 3

Level up:
XP works like the main game with milestones for level ups. Stat increases are by one except for speed which increments by 4. So 1 -> 5 -> 9 -> 13 -> 17

Combat is always one on one. Here is the order of operations:
Does the player have higher range than the enemy? If so they get the first attack
Who has the highest speed? They get to attack or run away. Attacks always hit. If speed is more than double the opponent, go again. Same for triple, quadruple etc.
Next get’s to do the same
If no one has run away and no one is dead repeat starting at step 1

Important notes for the LLM running the game:
Never give the player hints or tell them what to do unless they explicitly ask.
