// The small parts every NGnG screen is drawn from. Four visual states, one
// meaning each (SCREEN-ROUTING §8):
//   grey    — not part of this choice (never hides a label, glyph or piece)
//   dashed  — not on the board yet
//   shut    — struck through in danger red, with the engine's reason
//   solid   — on the board
// Colour says whose, the mark says what, text says which.

import type { ReactNode } from 'react';
import { ICON_ALIASES, ICON_PATHS } from './icons.gen.js';
import { TERRAIN, inkOf, initials } from './factions.js';
import { RESOURCES, type Cost, type RefHero } from './ref.js';

export function hasIcon(name: string): boolean {
  return !!(ICON_PATHS[name] ?? ICON_PATHS[ICON_ALIASES[name] ?? '']);
}

export function Icon({ name, size = 16, stroke = 2 }: { name: string; size?: number; stroke?: number }) {
  const paths = ICON_PATHS[name] ?? ICON_PATHS[ICON_ALIASES[name] ?? ''] ?? [];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="ngg-icon">
      {paths.slice(0, 4).map((d, i) => (d ? <path key={i} d={d} /> : null))}
      {paths[4] ? <path d={paths[4]} strokeDasharray="3 2.4" /> : null}
    </svg>
  );
}

/** A seat's chip: its faction fill with its mark inside. */
export function FactionChip({ faction, size = 22 }: { faction: string | null; size?: number }) {
  const ink = inkOf(faction);
  return (
    <span className="ngg-chip" style={{ width: size, height: size, background: ink.fill, color: ink.on }} aria-hidden="true">
      {ink.mark && <Icon name={ink.mark} size={Math.round(size * 0.62)} stroke={2.2} />}
    </span>
  );
}

export type TokenState = 'solid' | 'dashed';

/** A map token: a unit, a hero, a base or a collector, in its owner's colour. */
export function Token({ kind, faction, name, leader, state = 'solid', size = 22, title }: {
  kind: 'unit' | 'hero' | 'base' | 'collector';
  faction: string | null;
  /** for a unit, the icon; for a hero, the name its initials come from */
  name: string;
  leader?: boolean;
  state?: TokenState;
  size?: number;
  title?: string;
}) {
  const ink = inkOf(faction);
  const glyph = kind === 'hero'
    ? <span className="ngg-token-initials">{leader ? <Icon name="Leader" size={Math.round(size * 0.58)} stroke={2.2} /> : initials(name)}</span>
    : kind === 'base'
      ? <Icon name="Base" size={Math.round(size * 0.6)} stroke={2.2} />
      : hasIcon(name)
        ? <Icon name={name} size={Math.round(size * 0.6)} stroke={2.2} />
        : <span className="ngg-token-initials">{name.slice(0, 1)}</span>;
  return (
    <span
      className={`ngg-token ngg-token-${kind}${state === 'dashed' ? ' dashed' : ''}`}
      style={{ width: size, height: size, background: ink.fill, color: ink.on }}
      title={title ?? name}
    >
      {glyph}
    </span>
  );
}

/** A hero's name as every hero list prints it: the recommended-Leader star
 *  after it when the card carries one. */
export function HeroName({ hero, name }: { hero: RefHero | null; name: string }) {
  return <>{name}{hero?.recommendedLeader ? <span className="ngg-hero-star" title="Recommended Leader"> ★</span> : null}</>;
}

/** What every hero list says about a hero (the Heroes list, the Leader draft,
 *  a milestone claim, the spy): its kind and species limit, its battle stats,
 *  and its printed ability on one line until opened. `liveStats` is the
 *  engine's line for a held hero (a Leader's bonus included); otherwise the
 *  printed stats. */
export function HeroFacts({ hero, liveStats = null, open }: { hero: RefHero | null; liveStats?: string | null; open: boolean }) {
  if (!hero) return liveStats ? <i className="ngg-hero-kind"><span className="ngg-hero-stats">{liveStats}</span></i> : null;
  const kind = [hero.category ? hero.category[0]!.toUpperCase() + hero.category.slice(1) : null, hero.species ? `${hero.species}s only` : null].filter(Boolean).join(' · ');
  const stats = liveStats ?? (hero.stats ? `Init ${hero.stats.init} DMG ${hero.stats.dmg} DEF ${hero.stats.def}` : '');
  return (
    <>
      <i className="ngg-hero-kind">{kind}{stats && <span className="ngg-hero-stats">{stats}</span>}</i>
      {hero.effect && <span className={`ngg-hero-effect${open ? '' : ' clamped'}`}>{hero.effect}</span>}
    </>
  );
}

/** Who is asking, at a glance: their faction's mark, name and colour. */
export function SeatBand({ faction, name, children }: { faction: string | null; name: string; children?: ReactNode }) {
  const ink = inkOf(faction);
  return (
    <div className="ngg-seat-band ngr-proposer" style={{ borderColor: ink.fill }}>
      <FactionChip faction={faction} size={40} />
      <span className="ngr-proposer-name" style={{ color: ink.fill }}>{name}</span>
      {children}
    </div>
  );
}

/** A mark that a seat holds a spy the table has not seen revealed (which hero
 *  carries it stays secret). */
export function SpyMark({ species, count, size = 14 }: { species: string | null; count: number; size?: number }) {
  if (count <= 0) return null;
  const what = species === 'robot' ? 'Infiltrator' : 'Illusionist';
  const title = `${count === 1 ? 'An' : count} unrevealed ${what} spy${count === 1 ? '' : ' assignments'} — which hero carries it is secret`;
  return (
    <span className="ngg-spy-mark" title={title} aria-label={title}>
      <Icon name={what} size={size} stroke={2} />{count > 1 ? <b>{count}</b> : null}
    </span>
  );
}

/** A battle card's price: the fixed resources, then "+ either" one of the
 *  others, as resource chips. */
export function BattleCardPrice({ cost, either }: { cost: Cost; either: string[] }) {
  return (
    <span className="ngg-card-price">
      <CostChips cost={cost} />
      {either.length > 0 && (
        <>
          <span className="ngg-card-price-or">+ either</span>
          {either.map((r, i) => (
            <span key={r} className="ngg-card-price-leg">
              {i > 0 && <span className="ngg-card-price-or">or</span>}
              <CostChips cost={{ [r]: 1 } as Cost} />
            </span>
          ))}
        </>
      )}
    </span>
  );
}

/** The printed cost, as resource chips in the order the rules list them. */
export function CostChips({ cost }: { cost: Cost }) {
  const parts = RESOURCES.filter((r) => (cost[r] ?? 0) > 0);
  if (parts.length === 0) return <span className="ngg-cost-free">Free</span>;
  return (
    <span className="ngg-cost">
      {parts.map((r) => (
        <span key={r} className="ngg-res" style={{ background: TERRAIN[r]!.chip }} title={`${cost[r]} ${r}`}>
          <Icon name={TERRAIN[r]!.icon} size={11} stroke={2.4} />
          {(cost[r] ?? 0) > 1 && <span>×{cost[r]}</span>}
        </span>
      ))}
    </span>
  );
}

export function ResourceChip({ resource }: { resource: string | null }) {
  const t = resource ? TERRAIN[resource] : null;
  if (!t) return null;
  return (
    <span className="ngg-res" style={{ background: t.chip }}>
      <Icon name={t.icon} size={11} stroke={2.4} /><span>{t.name}</span>
    </span>
  );
}

/**
 * One option of a decision. Open options are pressable; a shut one is struck
 * through with the engine's own reason and cannot be pressed; a grey one is
 * shown for reading and is not part of this choice.
 */
export function OptionRow({ title, sub, aside, mark, selected, shutReason, grey, disabled, onPress, children }: {
  title: ReactNode;
  sub?: ReactNode;
  aside?: ReactNode;
  mark?: ReactNode;
  selected?: boolean;
  shutReason?: string | null;
  grey?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  children?: ReactNode;
}) {
  const shut = !!shutReason;
  const cls = `ngg-option${selected ? ' selected' : ''}${shut ? ' shut' : ''}${grey ? ' grey' : ''}`;
  const body = (
    <>
      {mark && <span className="ngg-option-mark">{mark}</span>}
      <span className="ngg-option-body">
        <span className="ngg-option-title">{title}</span>
        {sub && <span className="ngg-option-sub">{sub}</span>}
        {shut && <span className="ngg-option-reason"><span aria-hidden="true">✕ </span>{shutReason}</span>}
        {children}
      </span>
      {aside && <span className="ngg-option-aside">{aside}</span>}
      {selected && <span className="ngg-option-check" aria-hidden="true">✓</span>}
    </>
  );
  if (shut || grey || !onPress) {
    return <div className={cls} aria-disabled={shut || grey || undefined}>{body}</div>;
  }
  return (
    <button type="button" className={cls} onClick={onPress} disabled={disabled} aria-pressed={selected}>
      {body}
    </button>
  );
}

export function Panel({ title, kicker, children, tone }: { title?: ReactNode; kicker?: ReactNode; children: ReactNode; tone?: 'hl' | 'urgent' }) {
  return (
    <section className={`ngg-panel${tone ? ` ${tone}` : ''}`}>
      {kicker && <div className="ngg-kicker">{kicker}</div>}
      {title && <h3 className="ngg-panel-title">{title}</h3>}
      {children}
    </section>
  );
}

/** A rules sentence: printed text, set apart so it never reads as advice. */
export function Rule({ children }: { children: ReactNode }) {
  return <p className="ngg-rule">{children}</p>;
}

/** A short how-to line: what pressing does, never why. */
export function HowTo({ children }: { children: ReactNode }) {
  return <p className="ngg-howto">{children}</p>;
}

export function Actions({ children }: { children: ReactNode }) {
  return <div className="ngg-actions">{children}</div>;
}

export function Btn({ kind = 'primary', disabled, onClick, children, title }: {
  kind?: 'primary' | 'secondary' | 'quiet';
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
  title?: string;
}) {
  return <button type="button" className={`ngg-btn ${kind}`} disabled={disabled} onClick={onClick} title={title}>{children}</button>;
}

/** A battle card's face: its printed label and effect. */
export function CardFace({ label, effect, selected, shutReason, count, onPress, disabled, owner }: {
  label: string;
  effect?: string;
  selected?: boolean;
  shutReason?: string | null;
  count?: number;
  onPress?: () => void;
  disabled?: boolean;
  owner?: ReactNode;
}) {
  const shut = !!shutReason;
  const inner = (
    <>
      <span className="ngg-card-type">Battle card{count && count > 1 ? ` · ×${count}` : ''}</span>
      <span className="ngg-card-name">{label}</span>
      {effect && <span className="ngg-card-effect">{effect}</span>}
      {owner && <span className="ngg-card-owner">{owner}</span>}
      {shut && <span className="ngg-option-reason">✕ {shutReason}</span>}
    </>
  );
  const cls = `ngg-card${selected ? ' selected' : ''}${shut ? ' shut' : ''}`;
  if (shut || !onPress) return <div className={cls}>{inner}</div>;
  return <button type="button" className={cls} onClick={onPress} disabled={disabled} aria-pressed={selected}>{inner}</button>;
}

export function CardBack({ size = 'small' }: { size?: 'small' | 'large' }) {
  return <span className={`ngg-card-back ${size}`} aria-label="a battle card, face down"><span aria-hidden="true">✦</span></span>;
}
