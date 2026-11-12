// Warble Way Galaxy's icons (docs/games/warble-way-galaxy-theme-build.md,
// item 2). Every drawing but the portraits is a game-icons.net shape
// (CC BY 3.0, credited in ATTRIBUTIONS.md) served from
// /art/warble-way/icons/ and drawn as a CSS mask, so it takes whatever
// colour the text around it has. An icon is two stacked copies: a pink ghost
// under the icon in its own colour, both jumping now and then (the glitch
// rules in ww.css). Pictures only; nothing here knows a rule.

import type { CSSProperties } from 'react';

/** The boards' icon classes (`.i-<name>` on every `.dc.html`) and the file each one masks with. */
export const ICON_FILES = {
  alien: 'alien-skull.png', armor: 'metal-scales.png', asteroid: 'asteroid.svg', beam: 'beam-satellite.svg',
  being: 'being-icon.png', blackhole: 'black-hole-bolas.svg', bolt: 'hypersonic-bolt.svg', bubble: 'bubble-field.svg',
  bug: 'alien-bug.svg', chest: 'locked-chest.png', conquest: 'planet-conquest.svg', convince: 'convince.png',
  crack: 'cracked-glass.png', credits: 'credits-currency.png', curiosity: 'mars-curiosity.svg', defsat: 'defense-satellite.svg',
  disintegrate: 'disintegrate.png', distress: 'distress-signal.svg', drink: 'drink-me.png', eclipse: 'eclipse.svg',
  egg: 'alien-egg.svg', evilmoon: 'evil-moon.svg', explplanet: 'exploding-planet.svg', gun: 'bolter-gun.png',
  helmet: 'astronaut-helmet.svg', idcard: 'id-card.png', interceptor: 'interceptor-ship.svg', lunar: 'lunar-module.svg',
  meteor: 'burning-meteor.png', meteorimpact: 'meteor-impact.svg', nightsky: 'night-sky.svg', observ: 'observatory.svg',
  orbrays: 'orbital-rays.svg', pirate: 'pirate-flag.png', radar: 'radar-dish.svg', rays: 'explosion-rays.svg',
  ringed: 'ringed-planet.svg', rings: 'transportation-rings.svg', rocket: 'rocket-flight.png', satcom: 'satellite-communication.svg',
  scout: 'scout-ship.svg', ship: 'spaceship.png', shuttle: 'space-shuttle.svg', silo: 'round-silo.png',
  skills: 'skills.png', skull: 'skull-crossed-bones.png', solar: 'solar-system.svg', spiky: 'spiky-field.svg',
  starcycle: 'star-cycle.svg', starfighter: 'starfighter.svg', strafe: 'strafe.svg', suit: 'space-suit.svg',
  swirl: 'star-swirl.png', tag: 'price-tag.png', talk: 'discussion.png', ufo: 'ufo.svg', vortex: 'vortex.svg', world: 'world.png',
  // In the card-art set but on no board yet.
  rocketship: 'rocket.svg',
} as const;

export type IconName = keyof typeof ICON_FILES;

/** The fixed meanings (item 2): the one icon each thing in the game is always drawn with. */
export const MEANINGS = {
  habitat: 'ringed', ruin: 'silo', recruit: 'being', being: 'being', pirate: 'skull', attacker: 'skull',
  hazard: 'meteorimpact', job: 'satcom', goal: 'swirl', cache: 'chest', deathCheck: 'disintegrate', damage: 'crack', dread: 'pirate',
} as const satisfies Record<string, IconName>;

export type Meaning = keyof typeof MEANINGS;

export function iconUrl(name: IconName): string {
  return `/art/warble-way/icons/${ICON_FILES[name]}`;
}

export interface IconProps {
  name: IconName;
  /** width and height in px; the boards use 18 inline, 52 to 56 on the card kinds */
  size?: number;
  /** what a screen reader says; without one the icon is decoration beside its word */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/** One icon: the ghost, then the icon itself, each the shape as a mask in the current colour. */
export function Icon({ name, size = 18, label, className, style }: IconProps) {
  const url = `url(${iconUrl(name)})`;
  const mask: CSSProperties = { width: size, height: size, WebkitMaskImage: url, maskImage: url };
  return (
    <span
      className={className ? `ww-gx ${className}` : 'ww-gx'}
      style={style}
      data-icon={name}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <span className="ww-ic ww-gh" style={mask} />
      <span className="ww-ic" style={mask} />
    </span>
  );
}

/** The icon for a fixed meaning: habitat, ruin, pirate, and so on. */
export function MeaningIcon({ meaning, ...rest }: Omit<IconProps, 'name'> & { meaning: Meaning }) {
  return <Icon name={MEANINGS[meaning]} {...rest} />;
}
