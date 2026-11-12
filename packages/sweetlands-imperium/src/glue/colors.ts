// The six colors' actions in plain words, for the cards and the color guide.
// Teaching copy from docs/games/sweetlands-imperium.md, as the canvas words
// it; what an action actually does in a game is always the engine's move
// description, never this.

export type SlColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple';
export const COLORS: SlColor[] = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];

export const COLOR_ACTION: Record<SlColor, { name: string; who: string; best: string; text: string }> = {
  red: { name: 'Battle', who: 'Knight', best: 'Best with your Knight', text: 'Fight an enemy Knight in this land, capture a Leader or Ambassador, or attack the castle foe.' },
  orange: { name: 'Influence', who: 'Leader', best: 'Best with your Leader', text: 'Gain influence. The farther your Leader is from home, the more you get.' },
  yellow: { name: 'Taxes', who: 'any piece', best: 'Any piece', text: 'Rivals in your home land pay you its tax. Then you may raise the tax.' },
  green: { name: 'Free play', who: 'any piece', best: 'Any piece', text: 'No action. Or discard it without moving to play any number of cards this turn.' },
  blue: { name: 'Intel', who: 'Ambassador', best: 'Best with your Ambassador', text: 'Draw cards. The farther your Ambassador is from home, the more you draw.' },
  purple: { name: 'Castle', who: 'Leader or Knight', best: 'Best with your Leader or Knight', text: 'From a road or junction, step into the Candy Castle.' },
};

export function isColor(c: string): c is SlColor {
  return (COLORS as string[]).includes(c);
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
